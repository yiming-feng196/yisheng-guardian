Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    voiceState: String,
    voiceLabel: String,
    voiceSeconds: Number,
    expanded: Boolean,
    messages: Array,
    value: String,
    sending: Boolean,
    scrollTarget: String,
    mode: String
  },
  methods: {
    voice() {
      this.triggerEvent('voice');
    },
    speak(event) {
      this.triggerEvent('speak', { id: event.currentTarget.dataset.id });
    },
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
