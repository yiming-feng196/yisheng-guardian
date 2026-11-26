Component({
  data: {
    selected: 0,
    hidden: false,
    largeText: false,
    safeBottom: 0,
    tabs: [
      { text: '陪伴', icon: 'companion', url: '/pages/companion/index' },
      { text: '观察', icon: 'observation', url: '/pages/observation/index' },
      { text: '记录', icon: 'records', url: '/pages/records/index' },
      { text: '我的', icon: 'profile', url: '/pages/profile/index' }
    ]
  },
  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (!this.data.tabs[index] || index === this.data.selected || this._navigating) return;
      this._navigating = true;
      wx.switchTab({
        url: this.data.tabs[index].url,
        success: () => {
          this.setData({ selected: index });
        },
        fail: () => {
          wx.showToast({ title: '暂时无法切换页面，请重试', icon: 'none' });
        },
        complete: () => {
          this._navigating = false;
        }
      });
    }
  }
});
