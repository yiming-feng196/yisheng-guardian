// Stage one is an image viewport. No blinking, lip sync or 3D is claimed.
// A future renderer can implement mount/setState/pause/resume/dispose.
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    src: { type: String, value: '/assets/avatar-companion.png' },
    state: {
      type: String,
      value: 'idle',
      observer(value) {
        if (this._renderer && this._renderer.setState) this._renderer.setState(value);
      }
    },
    active: { type: Boolean, value: true },
    compact: Boolean
  },
  data: { imageFailed: false },
  lifetimes: {
    detached() {
      this.detachRenderer();
    }
  },
  pageLifetimes: {
    hide() {
      if (this._renderer && this._renderer.pause) this._renderer.pause();
    },
    show() {
      if (this._renderer && this._renderer.resume) this._renderer.resume();
    }
  },
  methods: {
    imageError() {
      this.setData({ imageFailed: true });
    },
    attachRenderer(adapter) {
      this.detachRenderer();
      this._renderer = adapter;
      if (adapter && adapter.mount) adapter.mount(this);
      if (adapter && adapter.setState) adapter.setState(this.properties.state);
    },
    detachRenderer() {
      if (this._renderer && this._renderer.dispose) this._renderer.dispose();
      this._renderer = null;
    }
  }
});
