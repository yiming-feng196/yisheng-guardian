Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    expanded: Boolean,
    messages: Array,
    value: String,
    focused: Boolean,
    sending: Boolean,
    scrollTarget: String,
    mode: String
  },
  methods: {
    toggle() {
      this.triggerEvent(this.properties.expanded ? 'collapse' : 'expand');
    },
    input(event) {
      this.triggerEvent('input', { value: event.detail.value });
    },
    focus(event) {
      this.triggerEvent('focus', event.detail);
    },
    blur(event) {
      this.triggerEvent('blur', event.detail);
    },
    keyboard(event) {
      this.triggerEvent('keyboard', event.detail);
    },
    send() {
      this.triggerEvent('send');
    }
  }
});
