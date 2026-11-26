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
      wx.showModal({ title: '录音与上传尚未开放', content: '当前仅提供观察流程体验，不会调用麦克风、上传音频或生成观察报告。您可以先返回演示模式，了解完整步骤。', showCancel: false });
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
