Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    title: String,
    message: String,
    icon: { type: String, value: 'document' },
    action: String,
    error: Boolean
  },
  methods: {
    act() {
      this.triggerEvent('action');
    }
  }
});
