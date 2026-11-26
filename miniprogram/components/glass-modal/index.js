Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    visible: Boolean,
    title: String,
    content: String,
    caption: String,
    footnote: String,
    confirmText: { type: String, value: '知道了' },
    cancelText: { type: String, value: '取消' },
    showCancel: Boolean,
    danger: Boolean
  },
  methods: {
    blockTouch() {},
    close() {
      this.triggerEvent('close');
    },
    confirm() {
      this.triggerEvent('confirm');
    }
  }
});
