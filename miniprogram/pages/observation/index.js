const { getSettings, environmentKey } = require('../../config/env');

Page({
  data: { mode: 'demo', largeText: false, step: 0, consent: false, sampleReady: false, steps: ['准备', '看图讲述', '确认录音', '查看结果'] },
  onShow() {
    const config = getSettings();
    const key = environmentKey();
    if (this._environment !== key) {
      this._environment = key;
      this.setData({ step: 0, consent: false, sampleReady: false });
    }
    this.setData({ mode: config.mode, largeText: config.largeText });
  },
  onConsentChange(event) { this.setData({ consent: event.detail.value.indexOf('consent') !== -1 }); },
  prepareSample() {
    if (this.data.mode !== 'demo') {
      wx.showModal({ title: '录音与上传待接入', content: '本骨架未实现真实录音、上传或观察任务。队友 B 可从本页接入现有后端接口；当前不会生成观察报告。', showCancel: false });
      return;
    }
    this.setData({ sampleReady: true });
  },
  nextStep() {
    if (this.data.step === 0 && !this.data.consent) return;
    if (this.data.step === 1 && !this.data.sampleReady) {
      wx.showToast({ title: '请先选择流程示例', icon: 'none' }); return;
    }
    this.setData({ step: Math.min(3, this.data.step + 1) });
  },
  previousStep() { this.setData({ step: Math.max(0, this.data.step - 1) }); },
  restart() { this.setData({ step: 0, consent: false, sampleReady: false }); },
  openRecords() { wx.switchTab({ url: '/pages/records/index' }); }
});
