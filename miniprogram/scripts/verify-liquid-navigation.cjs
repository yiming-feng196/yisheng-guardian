const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const out = path.resolve(process.env.UI_QA_OUTPUT || 'ui-qa/liquid-navigation');
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mp = await automator.connect({
    wsEndpoint: process.env.WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420'
  });
  const original = await mp.currentPage();
  const report = {
    runtime: 'WeChat DevTools native simulator',
    project: path.resolve(__dirname, '..'),
    gestureInput: 'synthetic native component touch events; no physical phone verification',
    checks: [],
    screens: [],
    errors: []
  };
  mp.on('exception', (e) => report.errors.push(String(e.message || e.text || e)));
  const inspect = () =>
    mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1],
        b = p.getTabBar();
      const state = {
        route: p.route,
        data: b.data,
        rect: b._rect,
        canvas: !!b._canvas,
        context: !!b._context,
        frame: b._frame == null ? null : 'active',
        reduced: b._reduced
      };
      if (b._context) {
        try {
          const w = b._canvas.width,
            h = b._canvas.height,
            pixels = b._context.getImageData(0, 0, w, h).data;
          let left = w,
            right = -1,
            top = h,
            bottom = -1,
            count = 0;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
              if (pixels[(y * w + x) * 4 + 3] > 12) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
                count++;
              }
          state.pixels = {
            left,
            right,
            top,
            bottom,
            count,
            width: right - left + 1,
            canvasWidth: w
          };
        } catch (e) {
          state.pixelError = String(e.message || e);
        }
      }
      return state;
    });
  const invoke = (method, ...args) =>
    mp.evaluate(
      (method, args) => {
        getCurrentPages()
          [getCurrentPages().length - 1].getTabBar()
          [method].apply(getCurrentPages()[getCurrentPages().length - 1].getTabBar(), args);
        return true;
      },
      method,
      args
    );
  const snap = async (name) => {
    await mp.screenshot({ path: path.join(out, name + '.png') });
    report.screens.push(name + '.png');
  };
  try {
    await mp.callWxMethod('switchTab', { url: '/pages/companion/index' });
    await invoke('onTouchCancel');
    await wait(1500);
    const resting = await inspect();
    console.log('Resting', JSON.stringify(resting));
    assert.equal(resting.data.liquidReady, true);
    assert(resting.context);
    assert(resting.pixels && resting.pixels.width > 30);
    await snap('companion-rest');
    await mp.evaluate(() => {
      const b = getCurrentPages()[getCurrentPages().length - 1].getTabBar(),
        r = b._rect,
        slot = r.width / 4,
        y = r.top + r.height / 2;
      const e = (x) => ({
        currentTarget: { dataset: { index: 0 } },
        touches: [{ identifier: 1, clientX: x, clientY: y }],
        changedTouches: [{ identifier: 1, clientX: x, clientY: y }]
      });
      b.onTouchStart(e(r.left + slot / 2));
      b.onTouchMove(e(r.left + slot / 2 + 8));
      b.onTouchMove(e(r.left + slot * 3.5));
      b._stopFrame();
      return true;
    });
    console.log('drag dispatched');
    await wait(80);
    const stretched = await inspect();
    console.log('stretched', JSON.stringify(stretched.pixels));
    assert(stretched.pixels.width > resting.pixels.width * 1.7);
    await snap('water-connection');
    report.checks.push({
      name: 'native canvas renders a stretched connected surface',
      restWidth: resting.pixels.width,
      stretchedWidth: stretched.pixels.width
    });
    await invoke('_animate');
    await wait(1000);
    const held = await inspect();
    assert(held.pixels.width < resting.pixels.width * 1.12);
    await mp.evaluate(() => {
      const b = getCurrentPages()[getCurrentPages().length - 1].getTabBar(),
        r = b._rect;
      b.onTouchEnd({
        changedTouches: [
          { identifier: 1, clientX: r.left + r.width * 0.875, clientY: r.top + r.height / 2 }
        ]
      });
      return true;
    });
    await wait(1200);
    const destination = await inspect();
    assert.equal(destination.route, 'pages/profile/index');
    assert.equal(destination.data.selected, 3);
    assert.equal(destination.data.liquidReady, true);
    assert.equal(destination.frame, null);
    await snap('profile-settled');
    report.checks.push({ name: 'touch release switches page and destination animation settles' });
    await mp.evaluate(() => {
      const b = getCurrentPages()[getCurrentPages().length - 1].getTabBar(),
        r = b._rect,
        y = r.top + r.height / 2;
      const e = (x, yy = y) => ({
        currentTarget: { dataset: { index: 3 } },
        touches: [{ identifier: 2, clientX: x, clientY: yy }],
        changedTouches: [{ identifier: 2, clientX: x, clientY: yy }]
      });
      b.onTouchStart(e(r.left + r.width * 0.875));
      b.onTouchMove(e(r.left + r.width * 0.875 - 8));
      b.onTouchMove(e(r.left + r.width * 0.25));
      b.onTouchEnd(e(r.left + r.width * 0.25, r.top - 100));
      return true;
    });
    await wait(1100);
    assert.equal((await inspect()).route, 'pages/profile/index');
    report.checks.push({ name: 'dragging outside cancels page change' });
    for (const [index, name] of ['companion', 'observation', 'records', 'profile'].entries()) {
      await invoke('switchTab', { currentTarget: { dataset: { index } } });
      await wait(1200);
      const state = await inspect();
      assert.equal(state.route, 'pages/' + name + '/index');
      assert.equal(state.data.selected, index);
      assert.equal(state.data.liquidReady, true);
      assert.equal(state.frame, null);
      if (name === 'observation' || name === 'records') await snap(name);
    }
    report.checks.push({ name: 'all four native routes work and stop drawing at rest' });
    await invoke('syncPage', {
      selected: 3,
      hidden: false,
      largeText: true,
      safeBottom: destination.data.safeBottom
    });
    await wait(500);
    const large = await inspect();
    assert(large.rect.height > destination.rect.height);
    await snap('profile-large');
    await invoke('syncPage', {
      selected: 3,
      hidden: true,
      largeText: true,
      safeBottom: destination.data.safeBottom
    });
    await wait(80);
    assert.equal((await inspect()).frame, null);
    await invoke('syncPage', {
      selected: 3,
      hidden: false,
      largeText: false,
      safeBottom: destination.data.safeBottom
    });
    await wait(500);
    report.checks.push({ name: 'large text remeasures canvas and keyboard hide stops frames' });
  } finally {
    await invoke('onTouchCancel');
    await mp.callWxMethod('switchTab', { url: '/' + original.path });
    await wait(200);
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
    await mp.disconnect();
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
