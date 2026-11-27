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
    this.loadRecords(false);
  },
  onUnload() {
    this._version = (this._version || 0) + 1;
  },
  onPullDownRefresh() {
    this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },
  async loadRecords(force = true) {
    const key = environmentKey();
    const live = getSettings().mode === 'live';
    const session = live && getSession();
    const token = session ? session.token : null;
    const scope = this._scope;
    const changed = !scope || scope.key !== key || scope.token !== token;
    if (!changed && this._loadingRecords) return this._loadingRecords;
    if (!changed && force === false && Date.now() < this._freshUntil) return;
    const version = (this._version || 0) + 1;
    this._version = version;
    this._scope = { key, token };
    this._freshUntil = 0;
    this._loadingRecords = null;
    const needsLogin = live && !session;
    const patch = {
      loading: !needsLogin && (changed || !this.data.records.length),
      error: '',
      needsLogin,
      reportVisible: false,
      selectedRecord: null
    };
    if (changed || needsLogin) patch.records = [];
    this.setData(patch);
    if (needsLogin) return;
    const promise = this.fetchRecords(version, key, token);
    this._loadingRecords = promise;
    try {
      await promise;
    } finally {
      if (this._loadingRecords === promise) this._loadingRecords = null;
    }
  },
  async fetchRecords(version, key, token) {
    const isCurrent = () => this._version === version && key === environmentKey();
    try {
      const records = await listRecords();
      if (!isCurrent()) return;
      const session = token && getSession();
      if (token && (!session || session.token !== token)) {
        this.setData({ records: [], needsLogin: !session });
        return;
      }
      this._freshUntil = Date.now() + 15000;
      this.setData({ records: records.map(presentRecord), loading: false });
    } catch (error) {
      if (isCurrent()) {
        const session = token && getSession();
        const patch = { error: error.message, needsLogin: !!token && !session };
        if (token && (!session || session.token !== token)) patch.records = [];
        this.setData(patch);
      }
    } finally {
      if (isCurrent() && this.data.loading) this.setData({ loading: false });
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
