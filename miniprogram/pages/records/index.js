const { getSettings, environmentKey } = require('../../config/env');
const { listRecords } = require('../../services/api');
const { getSession } = require('../../services/session');
const { syncTab } = require('../../utils/ui');
const { presentRecord } = require('../../utils/records');
Page({
  data: {
    mode: 'demo',
    largeText: false,
    records: [],
    loading: false,
    error: '',
    needsLogin: false,
    navSpace: 82,
    reportVisible: false,
    selectedRecord: null
  },
  onShow() {
    const config = getSettings();
    this.setData({ mode: config.mode, largeText: config.largeText, reportVisible: false });
    syncTab(this, 2);
    this.loadRecords();
  },
  onUnload() {
    this._version = (this._version || 0) + 1;
  },
  onPullDownRefresh() {
    this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },
  async loadRecords() {
    const version = (this._version || 0) + 1;
    this._version = version;
    const key = environmentKey();
    const needsLogin = getSettings().mode === 'live' && !getSession();
    this.setData({
      loading: !needsLogin,
      error: '',
      records: [],
      needsLogin,
      reportVisible: false,
      selectedRecord: null
    });
    if (needsLogin) return;
    try {
      const records = await listRecords();
      if (this._version === version && key === environmentKey())
        this.setData({ records: records.map(presentRecord) });
    } catch (error) {
      if (this._version === version && key === environmentKey())
        this.setData({
          error: error.message,
          needsLogin: getSettings().mode === 'live' && !getSession()
        });
    } finally {
      if (this._version === version && key === environmentKey()) this.setData({ loading: false });
    }
  },
  showRecord(event) {
    const record = this.data.records[event.currentTarget.dataset.index];
    if (!record) return;
    this.setData({
      selectedRecord: Object.assign({}, record, {
        content: record.report || record.description || '该任务尚无可展示的报告。'
      }),
      reportVisible: true
    });
  },
  closeReport() {
    this.setData({ reportVisible: false, selectedRecord: null });
  },
  openProfile() {
    getApp().globalData.profileAction = 'login';
    wx.switchTab({ url: '/pages/profile/index' });
  },
  openObservation() {
    wx.switchTab({ url: '/pages/observation/index' });
  }
});
