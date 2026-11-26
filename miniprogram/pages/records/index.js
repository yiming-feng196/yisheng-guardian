const { getSettings, environmentKey } = require('../../config/env');
const { listRecords } = require('../../services/api');

Page({
  data: { mode: 'demo', largeText: false, records: [], loading: false, error: '' },
  onShow() {
    const config = getSettings();
    this.setData({ mode: config.mode, largeText: config.largeText });
    this.loadRecords();
  },
  onUnload() { this._version = (this._version || 0) + 1; },
  onPullDownRefresh() { this.loadRecords().finally(() => wx.stopPullDownRefresh()); },
  async loadRecords() {
    const version = (this._version || 0) + 1;
    this._version = version;
    const key = environmentKey();
    this.setData({ loading: true, error: '', records: [] });
    try {
      const records = await listRecords();
      if (this._version === version && key === environmentKey()) this.setData({ records });
    } catch (error) {
      if (this._version === version && key === environmentKey()) this.setData({ error: error.message });
    } finally {
      if (this._version === version && key === environmentKey()) this.setData({ loading: false });
    }
  },
  showRecord(event) {
    const record = this.data.records[event.currentTarget.dataset.index];
    if (!record) return;
    wx.showModal({ title: record.title, content: record.report || record.description || '该任务尚无可展示的报告。', showCancel: false });
  },
  openProfile() { wx.switchTab({ url: '/pages/profile/index' }); },
  openObservation() { wx.switchTab({ url: '/pages/observation/index' }); }
});
