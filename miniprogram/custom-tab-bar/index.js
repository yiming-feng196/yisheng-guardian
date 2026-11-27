const liquid = require('./liquid');
// Each page owns a separate custom tab bar. Transfer motion, never DOM nodes.
const shared = { motion: null, owner: null, navigating: false, updatedAt: 0 };
Component({
  data: {
    selected: 0,
    hidden: false,
    largeText: false,
    safeBottom: 0,
    visualIndex: 0,
    pressedIndex: -1,
    liquidReady: false,
    tabs: [
      { text: '陪伴', icon: 'companion', url: '/pages/companion/index' },
      { text: '观察', icon: 'observation', url: '/pages/observation/index' },
      { text: '记录', icon: 'records', url: '/pages/records/index' },
      { text: '我的', icon: 'profile', url: '/pages/profile/index' }
    ]
  },
  lifetimes: {
    attached() {
      this._visible = true;
      this._reduced = false;
      try {
        const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
        this._reduced = info.benchmarkLevel > 0 && info.benchmarkLevel < 10;
      } catch (_) {
        /* Device info is optional; static navigation still works. */
      }
    },
    ready() {
      this._ready = true;
      this._activate();
    },
    detached() {
      this._detached = true;
      this._suspend();
      this._canvas = this._context = null;
    }
  },
  pageLifetimes: {
    show() {
      this._visible = true;
    },
    hide() {
      this._visible = false;
      this._suspend();
    },
    resize() {
      this._suspend();
      this._surfaceKey = '';
      this._activate();
    }
  },
  methods: {
    syncPage(patch) {
      this._visible = true;
      const changed = {};
      Object.keys(patch).forEach((key) => {
        if (this.data[key] !== patch[key]) changed[key] = patch[key];
      });
      const needsLayout =
        !this._context || 'largeText' in changed || 'safeBottom' in changed || 'hidden' in changed;
      if (Object.keys(changed).length) {
        this.setData(changed, needsLayout ? () => this._activate() : undefined);
        if (!needsLayout) this._activate();
      } else this._activate();
    },
    _activate() {
      if (!this._ready || this._detached || !this._visible) return;
      if (this.data.hidden) {
        this._suspend();
        if (shared.motion && !shared.owner) liquid.settle(shared.motion, this.data.selected);
        return;
      }
      if (shared.owner && shared.owner !== this) shared.owner._suspend();
      shared.owner = this;
      if (!shared.motion) {
        shared.motion = liquid.createMotion(this.data.selected);
        shared.updatedAt = Date.now();
      }
      if (shared.motion.target !== this.data.selected) {
        shared.motion.target = this.data.selected;
        shared.updatedAt = Date.now();
      } else this._advanceClock(false);
      shared.motion.pressureTarget = 0;
      this._preview(this.data.selected);
      let info = {};
      try {
        info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      } catch (_) {}
      const key = [
        info.windowWidth,
        info.windowHeight,
        this.data.largeText,
        this.data.safeBottom
      ].join(':');
      // Cached pages retain their canvas. Re-querying and resetting its bitmap
      // here would put a blank frame in every tab switch.
      if (this._context && this._surfaceKey === key) {
        this._draw();
        this._animate();
      } else this._measure(key);
    },
    _measure(key) {
      const ticket = (this._measureTicket || 0) + 1;
      this._measureTicket = ticket;
      try {
        const query = this.createSelectorQuery();
        query.select('.tab-liquid').fields({ node: true, size: true });
        query.select('.tab-track').boundingClientRect();
        query.exec((result) => {
          if (
            this._detached ||
            ticket !== this._measureTicket ||
            shared.owner !== this ||
            this.data.hidden
          )
            return;
          const surface = result && result[0],
            rect = result && result[1];
          if (rect && rect.width > 0) this._rect = rect;
          if (!surface || !surface.node || !rect || !rect.width || !rect.height) {
            this._fallback();
            return;
          }
          try {
            this._stopFrame();
            const canvas = surface.node,
              info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
            // Only the soft glass surface is capped at 2x; text/icons stay at
            // native resolution. This avoids clearing a 3x bitmap each frame.
            const ratio = Math.min(Number(info.pixelRatio) || 1, 2);
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
            this._canvas = canvas;
            this._context = canvas.getContext('2d');
            this._context.scale(ratio, ratio);
            this._width = rect.width;
            this._height = rect.height;
            this._surfaceKey = key;
            this._fill = this._context.createLinearGradient(0, 0, rect.width * 0.6, rect.height);
            this._fill.addColorStop(0, 'rgba(211,242,232,0.76)');
            this._fill.addColorStop(0.5, 'rgba(179,228,214,0.59)');
            this._fill.addColorStop(1, 'rgba(214,242,233,0.54)');
            this._edge = this._context.createLinearGradient(0, 0, rect.width * 0.35, rect.height);
            this._edge.addColorStop(0, 'rgba(255,255,255,0.92)');
            this._edge.addColorStop(0.5, 'rgba(255,255,255,0.3)');
            this._edge.addColorStop(1, 'rgba(255,255,255,0.68)');
            if (!this.data.liquidReady) this.setData({ liquidReady: true });
            this._advanceClock(false);
            this._draw();
            this._animate();
          } catch (_) {
            this._fallback();
          }
        });
      } catch (_) {
        this._fallback();
      }
    },
    _fallback() {
      this._stopFrame();
      this._canvas = this._context = this._fill = this._edge = null;
      this._surfaceKey = '';
      if (this.data.liquidReady) this.setData({ liquidReady: false });
    },
    _draw() {
      if (!this._context || !shared.motion || !this._width) return;
      try {
        const ctx = this._context,
          w = this._width,
          h = this._height;
        ctx.clearRect(0, 0, w, h);
        liquid.trace(ctx, liquid.contour(shared.motion, w, h));
        ctx.fillStyle = this._fill;
        ctx.fill();
        ctx.strokeStyle = this._edge;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } catch (_) {
        this._fallback();
      }
    },
    _stopFrame() {
      this._frameToken = (this._frameToken || 0) + 1;
      if (this._watchdog != null) clearTimeout(this._watchdog);
      this._watchdog = null;
      if (this._frame != null) {
        if (this._frameCanvas && this._frameCanvas.cancelAnimationFrame)
          this._frameCanvas.cancelAnimationFrame(this._frame);
        else clearTimeout(this._frame);
      }
      this._frame = this._frameCanvas = null;
      this._lastFrame = 0;
    },
    _advanceClock(dragging) {
      const now = Date.now();
      let elapsed = Math.min(Math.max((now - shared.updatedAt) / 1000, 0), 0.32);
      let moving = liquid.advance(shared.motion, 0, dragging);
      // Catch up through the navigation interval, rather than freezing the
      // shape and restarting the clock when the destination page appears.
      while (elapsed > 0) {
        const step = Math.min(elapsed, 0.016);
        moving = liquid.advance(shared.motion, step, dragging);
        elapsed -= step;
      }
      shared.updatedAt = now;
      return moving;
    },
    _animate() {
      if (
        shared.owner !== this ||
        this._detached ||
        !this._visible ||
        this.data.hidden ||
        !this._context
      )
        return;
      if (this._reduced) {
        if (this._gesture && this._gesture.dragging) shared.motion.tail = shared.motion.x;
        else liquid.settle(shared.motion, shared.motion.target);
        this._draw();
        return;
      }
      if (this._frame != null) return;
      const token = (this._frameToken || 0) + 1;
      this._frameToken = token;
      const frame = () => {
        if (this._frameToken !== token) return;
        this._frameToken++;
        if (this._watchdog != null) clearTimeout(this._watchdog);
        this._watchdog = null;
        this._frame = this._frameCanvas = null;
        if (shared.owner !== this || !this._visible || this._detached || this.data.hidden) return;
        const moving = this._advanceClock(!!(this._gesture && this._gesture.dragging));
        this._draw();
        if (moving) this._animate();
        else this._lastFrame = 0;
      };
      if (this._canvas && this._canvas.requestAnimationFrame && !this._timerClock) {
        this._frameCanvas = this._canvas;
        this._frame = this._canvas.requestAnimationFrame(frame);
        // Some clients delay a previously hidden canvas's RAF after switchTab.
        // A bounded watchdog keeps one animation clock alive without allowing
        // a late native callback to render a second time.
        this._watchdog = setTimeout(() => {
          if (this._frameToken !== token) return;
          if (this._frameCanvas && this._frameCanvas.cancelAnimationFrame)
            this._frameCanvas.cancelAnimationFrame(this._frame);
          this._timerClock = true;
          frame();
        }, 34);
      } else this._frame = setTimeout(frame, 16);
    },
    _suspend() {
      this._measureTicket = (this._measureTicket || 0) + 1;
      this._stopFrame();
      this._gesture = null;
      if (shared.owner === this) {
        shared.owner = null;
        if (shared.motion) shared.motion.pressureTarget = 0;
      }
      if (!this._detached && this.data.pressedIndex !== -1) this.setData({ pressedIndex: -1 });
    },
    _preview(index) {
      if (index !== this.data.visualIndex) this.setData({ visualIndex: index });
    },
    _point(event, ended) {
      const points = ended ? event.changedTouches : event.touches;
      if (!points || !points.length) return null;
      const p = this._gesture
        ? Array.prototype.find.call(points, (p) => p.identifier === this._gesture.id)
        : points[0];
      if (!p) return null;
      return {
        x: Number(p.clientX == null ? p.pageX : p.clientX),
        y: Number(p.clientY == null ? p.pageY : p.clientY),
        id: p.identifier
      };
    },
    onTouchStart(event) {
      if (shared.navigating || this._gesture || shared.owner !== this || !this._rect) return;
      const p = this._point(event, false),
        index = Number(event.currentTarget.dataset.index);
      if (!p || !Number.isFinite(index) || !this.data.tabs[index]) return;
      this._gesture = {
        id: p.id,
        index,
        startX: p.x,
        lastX: p.x,
        lastTime: Date.now(),
        anchor: shared.motion.x,
        dragging: false,
        velocity: 0
      };
      shared.motion.target = index;
      shared.motion.pressureTarget = 1;
      shared.updatedAt = Date.now();
      this.setData({ pressedIndex: index });
      this._preview(index);
      this._animate();
    },
    onTouchMove(event) {
      if (!this._gesture) return;
      const p = this._point(event, false);
      if (!p) return;
      const g = this._gesture,
        dx = p.x - g.startX,
        now = Date.now(),
        slot = this._rect.width / 4;
      if (!g.dragging && Math.abs(dx) > 6) {
        g.dragging = true;
        g.anchor = shared.motion.x - dx / slot;
      }
      if (g.dragging) {
        shared.motion.x = liquid.rubberband(g.anchor + dx / slot);
        g.velocity = liquid.clamp(
          (p.x - g.lastX) / Math.max((now - g.lastTime) / 1000, 0.008) / slot,
          -16,
          16
        );
        shared.motion.velocity = g.velocity;
        shared.updatedAt = now;
        this._preview(liquid.clamp(Math.round(shared.motion.x), 0, 3));
        this._draw();
        this._animate();
      }
      g.lastX = p.x;
      g.lastTime = now;
    },
    onTouchEnd(event) {
      const p = this._point(event, true);
      if (!this._gesture || !p) return;
      const g = this._gesture;
      this._gesture = null;
      this._ignoreTapUntil = Date.now() + 400;
      this.setData({ pressedIndex: -1 });
      shared.motion.pressureTarget = 0;
      shared.motion.velocity = g.velocity * Math.exp(-(Date.now() - g.lastTime) / 90);
      if (p.y < this._rect.top - 32 || p.y > this._rect.bottom + 32) {
        this._returnToSelected();
        return;
      }
      const projected =
        (p.x - this._rect.left) / (this._rect.width / 4) +
        (g.dragging ? shared.motion.velocity * 0.025 : 0);
      this._navigate(g.dragging ? liquid.clamp(Math.floor(projected), 0, 3) : g.index);
    },
    onTouchCancel() {
      if (!this._gesture) return;
      this._gesture = null;
      this._ignoreTapUntil = Date.now() + 400;
      this.setData({ pressedIndex: -1 });
      this._returnToSelected();
    },
    _returnToSelected() {
      shared.motion.target = this.data.selected;
      shared.motion.pressureTarget = 0;
      this._preview(this.data.selected);
      this._animate();
    },
    switchTab(event) {
      if (Date.now() < (this._ignoreTapUntil || 0)) return;
      const index = Number(event.currentTarget.dataset.index);
      if (Number.isFinite(index) && this.data.tabs[index]) this._navigate(index);
    },
    _navigate(index) {
      if (!this.data.tabs[index] || shared.navigating) return;
      if (!shared.motion) shared.motion = liquid.createMotion(this.data.selected);
      shared.motion.target = index;
      shared.motion.pressureTarget = 0;
      this._preview(index);
      this._animate();
      shared.updatedAt = Date.now();
      if (index === this.data.selected) return;
      shared.navigating = true;
      wx.switchTab({
        url: this.data.tabs[index].url,
        success: () => {
          if (!this._detached) this.setData({ selected: index });
        },
        fail: () => {
          if (shared.owner === this) this._returnToSelected();
          else if (shared.motion) liquid.settle(shared.motion, this.data.selected);
          this._preview(this.data.selected);
          wx.showToast({ title: '暂时无法切换页面，请重试', icon: 'none' });
        },
        complete: () => {
          shared.navigating = false;
        }
      });
    }
  }
});
