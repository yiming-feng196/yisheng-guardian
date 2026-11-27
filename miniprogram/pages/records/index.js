const { getSettings, environmentKey } = require('../../config/env');
const { listRecords, listAudios, startAnalysis, removeAudio, downloadAudio } = require('../../services/api');
const { getSession } = require('../../services/session');
const { syncTab } = require('../../utils/ui');
const { discardFile } = require('../../services/recorder');
const { presentRecord } = require('../../utils/records');
Page({
  data: {
    mode: 'demo',
    largeText: false,
    records: [],
    audios: [],
    audioError: '',
    audioLoading: false,
    activeAudioId: 0,
    audioActionId: 0,
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
    this.loadAudios();
  },
  onHide() {
    this.stopAudio();
  },
  onUnload() {
    this.stopAudio();
    this._audioListVersion = (this._audioListVersion || 0) + 1;
    this._version = (this._version || 0) + 1;
  },
  onPullDownRefresh() {
    Promise.all([this.loadRecords(), this.loadAudios()]).finally(() => wx.stopPullDownRefresh());
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
    if (this.data.reportVisible) syncTab(this, 2);
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
  async loadAudios() {
    const key = environmentKey();
    const token = getSettings().mode === 'live' && getSession()?.token;
    const version = (this._audioListVersion || 0) + 1;
    this._audioListVersion = version;
    if (this._audioKey !== key || this._audioToken !== token) {
      this.stopAudio();
      this.setData({ audios: [], audioActionId: 0 });
    }
    this._audioKey = key;
    this._audioToken = token;
    const current = () => this._audioListVersion === version && key === environmentKey()
      && token === getSession()?.token;
    this.setData({ audioLoading: Boolean(token), audioError: '' });
    if (!token) return;
    try {
      const audios = await listAudios();
      if (current()) this.setData({ audios });
    } catch (error) {
      if (current()) this.setData({ audioError: error.message });
    } finally {
      if (this._audioListVersion === version) this.setData({ audioLoading: false });
    }
  },
  stopAudio() {
    this._audioVersion = (this._audioVersion || 0) + 1;
    this._download?.abort?.();
    this._download = null;
    this._audio?.destroy();
    this._audio = null;
    discardFile(this._audioFile);
    this._audioFile = '';
    if (this.data.activeAudioId) this.setData({ activeAudioId: 0 });
  },
  async playAudio(event) {
    const item = this.data.audios[event.currentTarget.dataset.index];
    if (!item) return;
    const stop = item.id === this.data.activeAudioId;
    this.stopAudio();
    if (stop) return;
    if (this._audioToken !== getSession()?.token || this._audioKey !== environmentKey()) return;
    const version = this._audioVersion;
    this.setData({ activeAudioId: item.id, audioError: '' });
    const fail = () => {
      if (version !== this._audioVersion) return;
      this.stopAudio();
      this.setData({ audioError: '无法播放录音，请检查登录状态和网络后重试。' });
    };
    try {
      const file = await downloadAudio(item.name, (task) => { this._download = task; });
      if (version !== this._audioVersion) { discardFile(file); return; }
      this._download = null;
      this._audioFile = file;
      const audio = wx.createInnerAudioContext();
      this._audio = audio;
      audio.onEnded(() => { if (version === this._audioVersion) this.stopAudio(); });
      audio.onError(fail);
      audio.src = file;
      audio.play();
    } catch (_) { fail(); }
  },
  async analyzeAudio(event) {
    const item = this.data.audios[event.currentTarget.dataset.index];
    if (!item?.canAnalyze) return;
    await this.runAudioAction(item, async () => {
      await startAnalysis(item.id);
      wx.showToast({ title: '已发起观察分析', icon: 'success' });
      await this.loadRecords();
    });
  },
  async deleteAudio(event) {
    const item = this.data.audios[event.currentTarget.dataset.index];
    if (!item || this.data.audioActionId) return;
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: '删除录音', content: '删除后将无法再试听这段录音，是否继续？',
      success: ({ confirm }) => resolve(confirm), fail: () => resolve(false)
    }));
    if (!confirmed) return;
    await this.runAudioAction(item, async () => {
      if (item.id === this.data.activeAudioId) this.stopAudio();
      await removeAudio(item.name);
      await this.loadAudios();
    });
  },
  async runAudioAction(item, action) {
    if (this.data.audioActionId || this._audioToken !== getSession()?.token
        || this._audioKey !== environmentKey() || !this.data.audios.includes(item)) return;
    const token = this._audioToken;
    const key = this._audioKey;
    this.setData({ audioActionId: item.id, audioError: '' });
    try {
      await action();
    } catch (error) {
      if (key === environmentKey() && token === getSession()?.token)
        this.setData({ audioError: error.message });
    } finally {
      if (key === this._audioKey && token === this._audioToken) this.setData({ audioActionId: 0 });
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
    syncTab(this, 2, true);
  },
  closeReport() {
    this.setData({ reportVisible: false, selectedRecord: null });
    syncTab(this, 2);
  },
  openProfile() {
    getApp().globalData.profileAction = 'login';
    wx.switchTab({ url: '/pages/profile/index' });
  },
  openObservation() {
    wx.switchTab({ url: '/pages/observation/index' });
  }
});
