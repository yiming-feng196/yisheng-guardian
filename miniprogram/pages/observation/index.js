const { getSettings, environmentKey } = require('../../config/env');
const { syncTab } = require('../../utils/ui');

const { getSession } = require('../../services/session');
const { uploadObservation, listAudios } = require('../../services/api');
const recorder = require('../../services/recorder');

const CAPTURING = ['starting', 'recording', 'pausing', 'paused', 'resuming', 'stopping'];
const LABELS = {
  idle: '未开始', authorizing: '等待麦克风授权', starting: '正在启动麦克风',
  recording: '正在录音', pausing: '正在暂停', paused: '已暂停', resuming: '正在继续',
  stopping: '正在结束录音', checking: '正在检查录音',
  ready: '录音已完成', reconciling: '正在核对服务器记录', uploading: '正在上传', failed: '上传失败',
  uncertain: '上传结果待确认', uploaded: '上传成功'
};

function clockText(ms) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
}

Page({
  data: {
    mode: 'demo',
    largeText: false,
    step: 0,
    consent: false,
    sampleReady: false,
    navSpace: 82,
    signedIn: false,
    phase: 'idle', status: LABELS.idle, clock: '00:00', progress: 0,
    playing: false, error: '', needsSettings: false,
    steps: ['准备说明', '看图讲述', '确认录音', '查看结果']
  },
  onShow() {
    const config = getSettings();
    this._visible = true;
    const key = environmentKey();
    const token = config.mode === 'live' ? getSession()?.token : undefined;
    if (this._environment !== key || this._token !== token) {
      this.resetRecording();
      this._environment = key;
      this._token = token;
      this.setData({ step: 0, consent: false, sampleReady: false });
    }
    this.setData({
      mode: config.mode, largeText: config.largeText, signedIn: Boolean(token),
      steps: ['准备说明', '看图讲述', '确认录音', config.mode === 'live' ? '上传完成' : '查看结果']
    });
    syncTab(this, 1);
  },
  onHide() {
    this._visible = false;
    this.stopPlayback();
    if (CAPTURING.includes(this.data.phase) || ['authorizing', 'checking'].includes(this.data.phase))
      this.resetRecording();
  },
  onUnload() {
    this._visible = false;
    this.resetRecording();
  },
  cancelRecording() {
    this.resetRecording();
  },
  openProfile() {
    getApp().globalData.profileAction = 'login';
    wx.switchTab({ url: '/pages/profile/index' });
  },
  setPhase(phase, extra) { this.setData({ phase, status: LABELS[phase], ...extra }); },
  resetRecording() {
    this._attempt = (this._attempt || 0) + 1;
    if (CAPTURING.includes(this.data.phase)) recorder.cancel();
    this.stopTimer();
    this.stopPlayback();
    if (this._file !== this._uploadFile) recorder.discardFile(this._file);
    this._file = '';
    this._beforeUpload = null;
    this._duration = 0;
    this._elapsed = 0;
    this.setPhase('idle', { clock: '00:00', error: '', progress: 0, needsSettings: false });
  },
  startTimer() {
    this._startedAt = Date.now();
    this._timer = setInterval(() => {
      this.setData({ clock: clockText(Math.min(300000, this._elapsed + Date.now() - this._startedAt)) });
    }, 250);
  },
  stopTimer() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
    this._elapsed += Date.now() - this._startedAt;
    this.setData({ clock: clockText(this._elapsed) });
  },
  async startRecording() {
    if (!this._visible || this.data.mode !== 'live' || !this.data.signedIn || !this.data.consent
        || this.data.step !== 1 || this.data.phase !== 'idle') return;
    const attempt = ++this._attempt;
    this.setPhase('authorizing', { error: '', needsSettings: false });
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      const agreed = await new Promise((resolve) => {
        wx.requirePrivacyAuthorize({ success() { resolve(true); }, fail() { resolve(false); } });
      });
      if (attempt !== this._attempt || !this._visible) return;
      if (!agreed) {
        this.setPhase('idle', { error: '需先同意微信小程序隐私保护指引，才能使用麦克风。' });
        return;
      }
    }
    const granted = await new Promise((resolve) => {
      wx.authorize({ scope: 'scope.record', success() { resolve(true); }, fail() { resolve(false); } });
    });
    if (attempt !== this._attempt || !this._visible) return;
    if (!granted) {
      this.setPhase('idle', { error: '麦克风授权未完成。请确认微信隐私授权和录音权限后重试。', needsSettings: true });
      return;
    }
    const failed = (message) => {
      if (attempt !== this._attempt) return;
      this.setPhase('idle');
      this.resetRecording();
      this.setData({ error: message });
    };
    this.setPhase('starting');
    try {
      recorder.start({
        started: () => { this.setPhase('recording'); this.startTimer(); },
        paused: () => { this.stopTimer(); if (this.data.phase === 'pausing') this.setPhase('paused'); },
        resumed: () => { if (this.data.phase === 'resuming') { this.setPhase('recording'); this.startTimer(); } },
        stopped: (result) => this.finishRecording(result, attempt),
        failed
      });
    } catch (error) {
      failed(error.message || '无法启动录音');
    }
  },
  openMicSettings() { wx.openSetting({ fail: () => this.setData({ error: '请在微信的小程序设置中检查录音权限。' }) }); },
  pauseRecording() {
    if (this.data.phase !== 'recording') return;
    this.setPhase('pausing');
    recorder.pause();
  },
  resumeRecording() {
    if (this.data.phase !== 'paused') return;
    this.setPhase('resuming');
    recorder.resume();
  },
  stopRecording() {
    if (!['recording', 'pausing', 'paused', 'resuming'].includes(this.data.phase)) return;
    this.stopTimer();
    this.setPhase('stopping');
    recorder.stop();
  },
  async finishRecording(result, attempt) {
    this.stopTimer();
    this.setPhase('checking');
    try {
      const file = await recorder.inspectRecording(result);
      if (file.path !== result.tempFilePath) recorder.discardFile(result.tempFilePath);
      if (attempt !== this._attempt) { recorder.discardFile(file.path); return; }
      this._file = file.path;
      this._duration = Math.round(file.duration / 1000);
      this.setPhase('ready', { clock: clockText(file.duration), step: 2 });
    } catch (error) {
      recorder.discardFile(result.tempFilePath);
      if (attempt === this._attempt) {
        this.resetRecording();
        this.setData({ error: error.message });
      }
    }
  },
  togglePlayback() {
    if (this._playback) { this.stopPlayback(); return; }
    if (!this._file || ['uploading', 'reconciling'].includes(this.data.phase)) return;
    const audio = wx.createInnerAudioContext();
    this._playback = audio;
    audio.src = this._file;
    audio.onEnded(() => { if (this._playback === audio) this.stopPlayback(); });
    audio.onError(() => {
      if (this._playback !== audio) return;
      this.stopPlayback();
      this.setData({ error: '无法试听这段录音，可重新录制。' });
    });
    this.setData({ playing: true });
    audio.play();
  },
  stopPlayback() {
    const audio = this._playback;
    if (!audio) return;
    this._playback = null;
    audio.destroy();
    this.setData({ playing: false });
  },
  removeRecording() {
    if (!this._file || ['uploading', 'reconciling'].includes(this.data.phase)) return;
    this.resetRecording();
    this.setData({ step: 1 });
  },
  async submitRecording() {
    if (!this._file || !['ready', 'failed'].includes(this.data.phase)
        || this.data.mode !== 'live' || !this.data.consent || !getSession()) return;
    const file = this._file;
    const attempt = this._attempt;
    this.stopPlayback();
    this.setPhase('uploading', { progress: 0, error: '' });
    const owner = getSession().token;
    try {
      if (!this._beforeUpload) this._beforeUpload = new Set((await listAudios()).map((audio) => audio.id));
    } catch (error) {
      if (attempt === this._attempt) this.setPhase('failed', { signedIn: Boolean(getSession()), error: error.message });
      return;
    }
    if (attempt !== this._attempt || getSession()?.token !== owner) return;
    if (!this._visible) { this.setPhase('ready'); return; }
    this._uploadFile = file;
    try {
      await uploadObservation(file, this.data.consent, (progress) => {
        if (attempt === this._attempt && this.data.phase === 'uploading') this.setData({ progress });
      }, () => attempt === this._attempt && getSession()?.token === owner);
      if (attempt !== this._attempt || getSession()?.token !== owner) return;
      let match;
      try {
        const audios = await listAudios();
        if (attempt !== this._attempt) return;
        const candidates = this.newAudioCandidates(audios);
        if (candidates.length === 1) match = candidates[0];
      } catch (_) { /* The upload response already confirmed storage. */ }
      if (attempt !== this._attempt) return;
      this._file = '';
      this.setPhase('uploaded', {
        step: 3, progress: 100, uploadedTime: match?.time || '', uploadedAudioId: match?.id || 0
      });
    } catch (error) {
      if (attempt !== this._attempt) return;
      const rejected = [400, 401, 403, 404, 413, 415, 422].includes(error.statusCode);
      const signedIn = Boolean(getSession());
      this.setPhase(rejected ? 'failed' : 'uncertain', {
        signedIn,
        error: signedIn ? error.message : '登录已失效，请登录后重试。'
      });
    } finally {
      if (this._uploadFile === file) this._uploadFile = '';
      if (attempt !== this._attempt || this.data.phase === 'uploaded') recorder.discardFile(file);
    }
  },
  newAudioCandidates(audios) {
    return audios.filter((audio) => !this._beforeUpload.has(audio.id) && audio.canAnalyze
      && Math.abs(audio.duration - this._duration) <= 1);
  },
  async confirmRetry() {
    if (this.data.phase !== 'uncertain' || !this._file || !getSession()) return;
    const attempt = this._attempt;
    const owner = getSession().token;
    this.setPhase('reconciling', { error: '' });
    try {
      const audios = await listAudios();
      if (attempt !== this._attempt) return;
      const candidates = this.newAudioCandidates(audios);
      this.setPhase('uncertain');
      if (candidates.length) {
        this.setData({ error: '服务器已有可能对应的录音。请在记录页核对，避免重复上传。' });
        return;
      }
      if (!this._visible || getSession()?.token !== owner) return;
      wx.showModal({
        title: '确认重新上传',
        content: '服务器暂未显示可能对应的录音。确认后将再次核对并重试。',
        confirmText: '确认重试',
        success: async ({ confirm }) => {
          if (!confirm || attempt !== this._attempt || !this._visible || this.data.phase !== 'uncertain'
              || getSession()?.token !== owner) return;
          this.setPhase('reconciling');
          try {
            const audios = await listAudios();
            if (attempt !== this._attempt) return;
            const candidates = this.newAudioCandidates(audios);
            if (candidates.length || !this._visible || getSession()?.token !== owner) {
              this.setPhase('uncertain', { error: '请先在记录页核对最新上传状态。' });
              return;
            }
            this.setPhase('failed');
            await this.submitRecording();
          } catch (error) {
            if (attempt === this._attempt) this.setPhase('uncertain', { error: error.message });
          }
        }
      });
    } catch (error) {
      if (attempt === this._attempt) this.setPhase('uncertain', { signedIn: Boolean(getSession()), error: error.message });
    }
  },
  onConsentChange(event) {
    this.setData({ consent: event.detail.value.indexOf('consent') !== -1 });
  },
  prepareSample() {
    if (this.data.mode !== 'demo') return;
    this.setData({ sampleReady: true });
  },
  nextStep() {
    if (this.data.mode === 'live') {
      if (!this.data.step && this.data.consent && getSession()) this.setData({ step: 1 });
      return;
    }
    if (this.data.step === 0 && !this.data.consent) return;
    if (this.data.step === 1 && !this.data.sampleReady) {
      wx.showToast({ title: '请先选择流程示例', icon: 'none' });
      return;
    }
    this.setData({ step: Math.min(3, this.data.step + 1) });
  },
  previousStep() {
    if (this.data.mode === 'live' && (this.data.step !== 1 || this.data.phase !== 'idle')) return;
    this.setData({ step: Math.max(0, this.data.step - 1) });
  },
  restart() {
    this.resetRecording();
    this.setData({ step: 0, consent: false, sampleReady: false });
  },
  openCompanion() {
    wx.switchTab({ url: '/pages/companion/index' });
  },
  openRecords() {
    wx.switchTab({ url: '/pages/records/index' });
  }
});
