const { getSettings, environmentKey } = require('../config/env');
const { networkError, platform, isLoopback } = require('../utils/connection');

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
    if (this.stopPending) {
      this.toast('麦克风正在关闭，请稍后重试');
      return;
    }
    const config = this.config();
    const version = ++this.version,
      key = environmentKey();
    this.set('authorizing', '正在申请麦克风权限');
    try {
      if (wx.requirePrivacyAuthorize)
        await new Promise((resolve, reject) =>
          wx.requirePrivacyAuthorize({ success: resolve, fail: reject })
        );
      await new Promise((resolve, reject) =>
        wx.authorize({ scope: 'scope.record', success: resolve, fail: reject })
      );
      if (!this.valid(version, key)) return;
      const recorder = wx.getRecorderManager();
      this.recorder = recorder;
      this.onStart = () => {
        if (!this.valid(version, key)) {
          recorder.stop();
          return;
        }
        this.set('recording', '正在录音 · 点击结束');
        let seconds = 0;
        this.timer = setInterval(() => this.update({ voiceSeconds: ++seconds }), 1000);
      };
      this.onStop = async (result) => {
        clearInterval(this.timer);
        this.detach();
        if (!this.valid(version, key)) {
          this.remove(result.tempFilePath);
          return;
        }
        if (!result.tempFilePath || result.duration < 600) {
          this.remove(result.tempFilePath);
          this.set('idle');
          this.toast('录音太短，请说完一句话再结束');
          return;
        }
        this.set('transcribing', '正在转成文字 · 可取消');
        try {
          const text = await new Promise((resolve, reject) => {
            this.task = wx.uploadFile({
              url: config.apiBaseUrl + '/assistant/speech/transcribe',
              filePath: result.tempFilePath,
              name: 'file',
              timeout: 120000,
              success: (response) => {
                try {
                  const data = JSON.parse(response.data);
                  if (response.statusCode < 200 || response.statusCode >= 300)
                    throw new Error(data.message || '语音识别失败，请稍后重试');
                  if (typeof data.transcription !== 'string' || !data.transcription.trim())
                    throw new Error('没有听清，请重试');
                  if (data.transcription.trim().length > 500)
                    throw new Error('识别内容超过 500 字，请分段录音');
                  resolve(data.transcription.trim());
                } catch (error) {
                  reject(error);
                }
              },
              fail: (error) => reject(networkError(error))
            });
          });
          if (this.valid(version, key)) {
            this.set('idle');
            onText(text);
          }
        } catch (error) {
          if (this.valid(version, key)) {
            this.set('idle');
            this.toast(error.message);
          }
        } finally {
          this.remove(result.tempFilePath);
        }
      };
      this.onError = () => {
        clearInterval(this.timer);
        this.detach();
        if (this.valid(version, key)) {
          this.set('idle');
          this.toast('录音未成功，请检查麦克风权限后重试');
        }
      };
      this.onInterrupt = () => {
        this.cancel();
        this.toast('录音已中断，本段不会上传，请重新录制');
      };
      if (recorder.onInterruptionBegin) recorder.onInterruptionBegin(this.onInterrupt);
      recorder.onStart(this.onStart);
      recorder.onStop(this.onStop);
      recorder.onError(this.onError);
      this.set('starting', '正在打开麦克风');
      recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      });
    } catch (error) {
      if (!this.valid(version, key)) return;
      this.detach();
      this.set('idle');
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
      this.recorder.stop();
    }
  }
  detach() {
    if (!this.recorder) return;
    if (this.onInterrupt && this.recorder.offInterruptionBegin)
      this.recorder.offInterruptionBegin(this.onInterrupt);
    for (const type of ['Start', 'Stop', 'Error'])
      if (this['on' + type] && this.recorder['off' + type])
        this.recorder['off' + type](this['on' + type]);
  }
  remove(path) {
    if (path && wx.getFileSystemManager)
      wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
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
      this.task.abort();
      this.task = null;
    }
    if (this.recorder && ['recording', 'starting', 'stopping'].includes(this.state)) {
      const recorder = this.recorder;
      this.detach();
      this.stopPending = true;
      const release = (result) => {
        this.stopPending = false;
        this.remove(result && result.tempFilePath);
        if (recorder.offStop) recorder.offStop(release);
        if (recorder.offError) recorder.offError(release);
      };
      recorder.onStop(release);
      recorder.onError(release);
      recorder.stop();
    }
    if (this.audio) {
      this.audio.stop();
      this.audio.destroy();
      this.audio = null;
    }
    this.remove(this.audioPath);
    this.audioPath = null;
    // Pending callbacks are invalidated before stopping native resources.
    this.set('idle');
  }
  async speak(text) {
    this.cancel();
    const config = this.config();
    if (typeof text !== 'string' || !text.trim() || text.length > 3000)
      throw new Error('朗读内容需要 1–3000 字');
    const version = ++this.version,
      key = environmentKey();
    this.set('synthesizing', '正在准备朗读 · 可取消');
    try {
      const bytes = await new Promise((resolve, reject) => {
        this.task = wx.request({
          url: config.apiBaseUrl + '/assistant/voice/synthesize',
          method: 'POST',
          data: { text },
          header: { 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 120000,
          success: (r) =>
            r.statusCode === 200 && r.data.byteLength > 100
              ? resolve(r.data)
              : reject(new Error('朗读服务暂不可用，请稍后重试')),
          fail: (e) => reject(networkError(e))
        });
      });
      if (!this.valid(version, key)) return;
      const path = wx.env.USER_DATA_PATH + '/xiaoyi-voice-' + Date.now() + '.mp3';
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath: path,
          data: bytes,
          success: resolve,
          fail: reject
        })
      );
      if (!this.valid(version, key)) {
        this.remove(path);
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
