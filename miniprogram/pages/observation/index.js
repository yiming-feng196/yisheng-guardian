const { getSettings, environmentKey } = require('../../config/env');
const { syncTab } = require('../../utils/ui');

Page({
  data: {
    mode: 'demo',
    largeText: false,
    step: 0,
    consent: false,
    sampleReady: false,
    navSpace: 82,
    noticeVisible: false,
    steps: ['准备说明', '看图讲述', '确认录音', '查看结果']
  },
  onShow() {
    const config = getSettings();
    const key = environmentKey();
    if (this._environment !== key) {
      this._environment = key;
      this.setData({ step: 0, consent: false, sampleReady: false });
    }
    this.setData({ mode: config.mode, largeText: config.largeText });
    syncTab(this, 1, this.data.noticeVisible);
  },
  onConsentChange(event) {
    this.setData({ consent: event.detail.value.indexOf('consent') !== -1 });
  },
  prepareSample() {
    if (this.data.mode !== 'demo') {
      this.setData({ noticeVisible: true });
      syncTab(this, 1, true);
      return;
    }
    this.setData({ sampleReady: true });
  },
  nextStep() {
    if (this.data.step === 0 && !this.data.consent) return;
    if (this.data.step === 1 && !this.data.sampleReady) {
      wx.showToast({ title: '请先选择流程示例', icon: 'none' });
      return;
    }
    this.setData({ step: Math.min(3, this.data.step + 1) });
  },
  previousStep() {
    this.setData({ step: Math.max(0, this.data.step - 1) });
  },
  restart() {
    this.setData({ step: 0, consent: false, sampleReady: false });
  },
  closeNotice() {
    this.setData({ noticeVisible: false });
    syncTab(this, 1);
  },
  openCompanion() {
    wx.switchTab({ url: '/pages/companion/index' });
  },
  openRecords() {
    wx.switchTab({ url: '/pages/records/index' });
  }
});
