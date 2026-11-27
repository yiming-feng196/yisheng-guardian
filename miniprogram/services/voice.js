const { getSettings, environmentKey } = require('../config/env');
const recorder = require('./recorder');
const { transcribe, synthesizeSpeech } = require('./api');
const { platform, isLoopback } = require('../utils/connection');

// One page owns the recorder; lifecycle cancellation also invalidates pending callbacks.
class VoiceSession {
  constructor(update) {
    this.update = update;
    this.version = 0;
    this.state = 'idle';
  }
  set(state, label) {
    this.state = state;
    this.update({
      voiceState: state,
      voiceLabel: label || '',
      voiceSeconds: 0
    });
  }
  valid(version, key) {
    return version === this.version && key === environmentKey();
  }
  config() {
    const config = getSettings();
    if (config.mode !== 'live') throw new Error('请先在“我的”连接真实服务后使用语音');
    if (!config.apiBaseUrl) throw new Error('请先配置后端地址');
    if (platform() && platform() !== 'devtools' && isLoopback(config.apiBaseUrl))
      throw new Error('手机需要填写电脑的 Wi-Fi 地址');
    return config;
  }
  async start(onText) {
    if (this.state !== 'idle') return;
    if (recorder.isBusy()) {
      this.toast('麦克风正在关闭，请稍后重试');
      return;
    }
    this.config();
    const version = ++this.version,
      key = environmentKey();
    this.set('authorizing', '正在申请麦克风权限');
    try {
      if (!this.recordingExplained) {
        const confirmed = await new Promise((resolve) => wx.showModal({
          title: '语音转写',
          content: '结束录音后将上传到当前后端转写。确认文字后可编辑并发送。',
          success: ({ confirm }) => resolve(confirm),
          fail: () => resolve(false)
        }));
        if (!this.valid(version, key)) return;
        if (!confirmed) { this.set('idle'); return; }
        this.recordingExplained = true;
      }
      if (wx.requirePrivacyAuthorize)
        await new Promise((resolve, reject) =>
          wx.requirePrivacyAuthorize({ success: resolve, fail: reject })
        );
      if (!this.valid(version, key)) return;
      await new Promise((resolve, reject) =>
        wx.authorize({ scope: 'scope.record', success: resolve, fail: reject })
      );
      if (!this.valid(version, key)) return;
      this.set('starting', '正在打开麦克风');
      recorder.start({
        started: () => {
          if (!this.valid(version, key)) return;
          this.set('recording', '正在录音 · 点击结束');
          let seconds = 0;
          this.timer = setInterval(() => this.update({ voiceSeconds: ++seconds }), 1000);
        },
        paused() {},
        resumed() {},
        failed: (message) => {
          clearInterval(this.timer);
          if (!this.valid(version, key)) return;
          this.set('idle');
          this.toast(message);
        },
        stopped: async (result) => {
          clearInterval(this.timer);
          let inspectedPath;
          try {
            if (!this.valid(version, key)) return;
            this.set('transcribing', '正在转成文字 · 可取消');
            const file = await recorder.inspectRecording(result, { allowDevtoolsWebm: true });
            inspectedPath = file.path;
            const current = () => this.valid(version, key);
            if (!current()) return;
            const text = await transcribe(file, (task) => { this.task = task; }, current);
            if (!current()) return;
            if (text.length > 500) throw new Error('识别内容超过 500 字，请分段录音');
            this.set('idle');
            onText(text);
          } catch (error) {
            if (this.valid(version, key)) {
              this.set('idle');
              this.toast(error.message);
            }
          } finally {
            recorder.discardFile(result.tempFilePath);
            if (inspectedPath !== result.tempFilePath) recorder.discardFile(inspectedPath);
            if (version === this.version) this.task = null;
          }
        }
      }, { duration: 60000 });
    } catch (error) {
      if (!this.valid(version, key)) return;
      const permissionDenied = this.state === 'authorizing';
      this.set('idle');
      if (!permissionDenied) {
        this.toast(error.message);
        return;
      }
      wx.showModal({
        title: '需要麦克风权限',
        content: '请允许录音。录音结束后会上传到您配置的服务器转成文字，确认后再发送。',
        confirmText: '打开设置',
        success: (res) => {
          if (res.confirm && wx.openSetting) wx.openSetting({});
        }
      });
    }
  }
  stopRecording() {
    if (this.state === 'recording') {
      this.set('stopping', '正在结束录音');
      recorder.stop();
    }
  }
  toast(title) {
    wx.showToast({
      title: title || '语音服务暂不可用',
      icon: 'none',
      duration: 3000
    });
  }
  cancel() {
    ++this.version;
    clearInterval(this.timer);
    if (this.task) {
      this.task.abort?.();
      this.task = null;
    }
    if (['recording', 'starting', 'stopping'].includes(this.state)) recorder.cancel();
    if (this.audio) {
      this.audio.stop();
      this.audio.destroy();
      this.audio = null;
    }
    recorder.discardFile(this.audioPath);
    this.audioPath = null;
    // Pending callbacks are invalidated before stopping native resources.
    this.set('idle');
  }
  togglePlayback() {
    if (this.state === 'playing') {
      this.audio.pause();
      this.set('paused', '朗读已暂停');
    } else if (this.state === 'paused') {
      this.audio.play();
    }
  }
  async speak(text) {
    this.cancel();
    this.config();
    if (typeof text !== 'string' || !text.trim() || text.length > 3000)
      throw new Error('朗读内容需要 1–3000 字');
    const version = ++this.version,
      key = environmentKey();
    this.set('synthesizing', '正在准备朗读 · 可取消');
    try {
      const bytes = await synthesizeSpeech(text, (task) => { this.task = task; });
      if (version === this.version) this.task = null;
      if (!this.valid(version, key)) return;
      const path = wx.env.USER_DATA_PATH + '/xiaoyi-voice-' + Date.now() + '-' + version + '.mp3';
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath: path,
          data: bytes,
          success: resolve,
          fail: (error) => { recorder.discardFile(path); reject(error); }
        })
      );
      if (!this.valid(version, key)) {
        recorder.discardFile(path);
        return;
      }
      this.audioPath = path;
      const audio = wx.createInnerAudioContext();
      this.audio = audio;
      audio.onPlay(() => {
        if (this.valid(version, key)) this.set('playing', '正在朗读 · 点击停止');
      });
      audio.onEnded(() => {
        if (this.valid(version, key)) this.cancel();
      });
      audio.onError(() => {
        if (this.valid(version, key)) {
          this.cancel();
          this.toast('音频播放失败，请检查设备音量后重试');
        }
      });
      audio.src = path;
      audio.play();
    } catch (error) {
      if (this.valid(version, key)) {
        this.cancel();
        this.toast(error.message);
      }
    }
  }
}
module.exports = { VoiceSession };
