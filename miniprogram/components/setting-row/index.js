Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    icon: String,
    label: String,
    detail: String,
    arrow: Boolean,
    expanded: Boolean,
    disabled: Boolean
  },
  methods: {
    select() {
      if (!this.properties.disabled) this.triggerEvent('select');
    }
  }
});
