const { VoiceSession } = require('../../services/voice');
const { getSettings, environmentKey } = require('../../config/env');
const { chat, getBackendStatus } = require('../../services/api');
const { syncTab, windowInfo, keyboardInset } = require('../../utils/ui');
const { getAutoRead, saveAutoRead } = require('../../config/voice');

Page({
  data: {
    voiceState: 'idle',
    voiceLabel: '',
    voiceSeconds: 0,
    autoRead: true,
    speakingId: '',
    mode: 'demo',
    largeText: false,
    input: '',
    messages: [],
    sending: false,
    scrollTarget: '',
    chatOpen: false,
    inputFocused: false,
    connection: 'demo',
    connectionLabel: '演示模式',
    modelConfigured: null,
    safeBottom: 0,
    navSpace: 82,
    keyboardHeight: 0,
    keyboardInset: 0,
    pageActive: true,
    replyPresented: false
  },
  onShow() {
    if (!this._voice)
      this._voice = new VoiceSession((patch) => {
        this.setData(
          patch.voiceState === 'idle' ? Object.assign({ speakingId: '' }, patch) : patch
        );
      });
    const config = getSettings();
    const key = environmentKey();
    this.setData({ mode: config.mode, largeText: config.largeText, autoRead: getAutoRead() });
    if (key !== this._environment) {
      this._voice.cancel();
      this._environment = key;
      this._requestId = (this._requestId || 0) + 1;
      const cached = getApp().globalData.chat;
      const messages =
        cached && cached.key === key
          ? cached.messages
          : [
              {
                id: 'greeting',
                role: 'assistant',
                content: '今天想聊些什么？可以聊聊生活、心情，也可以从一个小故事开始。'
              }
            ];
      this.setData({
        messages,
        input: '',
        sending: false,
        scrollTarget: '',
        chatOpen: false,
        inputFocused: false
      });
    }
    this._baselineHeight = windowInfo().windowHeight;
    this.setData({ pageActive: true, keyboardHeight: 0, keyboardInset: 0 });
    syncTab(this, 0);
    this.refreshConnection();
  },
  onHide() {
    if (this._voice) this._voice.cancel();
    this.setData({ pageActive: false });
  },
  onResize() {
    if (!this.data.keyboardHeight) this._baselineHeight = windowInfo().windowHeight;
    this.onKeyboardHeight({ detail: { height: this.data.keyboardHeight } });
  },
  onKeyboardHeight(event) {
    const height = Math.max(0, Number(event.detail.height) || 0);
    const info = windowInfo();
    this.setData({
      keyboardHeight: height,
      keyboardInset: keyboardInset(
        height,
        this._baselineHeight || info.windowHeight,
        info.windowHeight
      )
    });
    syncTab(this, 0, height > 0);
  },
  openObservation() {
    wx.switchTab({ url: '/pages/observation/index' });
  },
  onUnload() {
    if (this._voice) this._voice.cancel();
    this._requestId = (this._requestId || 0) + 1;
    this._connectionVersion = (this._connectionVersion || 0) + 1;
  },
  async refreshConnection() {
    const version = (this._connectionVersion || 0) + 1;
    this._connectionVersion = version;
    const key = environmentKey();
    if (this.data.mode !== 'live') {
      this.setData({
        connection: 'demo',
        connectionLabel: '演示模式',
        modelConfigured: null
      });
      return;
    }
    this.setData({
      connection: 'checking',
      connectionLabel: '连接中',
      modelConfigured: null
    });
    try {
      const result = await getBackendStatus();
      if (version !== this._connectionVersion || key !== environmentKey()) return;
      this.setData({
        connection: 'connected',
        connectionLabel: result.modelConfigured ? '服务已连接' : '知识库已连接',
        modelConfigured: result.modelConfigured
      });
      if (
        !result.modelConfigured &&
        this.data.messages.length === 1 &&
        this.data.messages[0].id === 'greeting'
      ) {
        this.setData({
          messages: [
            {
              id: 'greeting',
              role: 'assistant',
              content: '本机后端已连接。当前可查询认知健康知识；自由聊天需要在后端配置模型服务。'
            }
          ]
        });
      }
    } catch (_) {
      if (version === this._connectionVersion && key === environmentKey())
        this.setData({ connection: 'unavailable', connectionLabel: '未连接' });
    }
  },
  onInput(event) {
    this.setData({ input: event.detail.value });
  },
  openChat() {
    this.setData({ chatOpen: true });
  },
  closeChat() {
    if (this._voice) this._voice.cancel();
    this.setData({
      chatOpen: false,
      inputFocused: false,
      keyboardHeight: 0,
      keyboardInset: 0
    });
    syncTab(this, 0);
    if (wx.hideKeyboard) wx.hideKeyboard();
  },
  onInputFocus() {
    this.setData({ chatOpen: true, inputFocused: true, replyPresented: false });
  },
  onInputBlur() {
    this.setData({ inputFocused: false });
  },
  openProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },
  onQuickTopic(event) {
    if (this.data.sending) return;
    this.setData({ input: event.currentTarget.dataset.message });
    this.sendMessage();
  },
  onVoice() {
    if (this.data.sending) return;
    if (this.data.voiceState === 'recording') {
      this._voice.stopRecording();
      return;
    }
    if (this.data.voiceState !== 'idle') {
      this._voice.cancel();
      return;
    }
    this.setData({ chatOpen: true });
    if (wx.hideKeyboard) wx.hideKeyboard();
    this._voice
      .start((text) => {
        const draft = [this.data.input.trim(), text].filter(Boolean).join(' ');
        if (draft.length > 500) {
          wx.showToast({
            title: '合并后超过 500 字，请先发送当前内容',
            icon: 'none'
          });
          return;
        }
        this.setData({ input: draft, chatOpen: true });
      })
      .catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },
  onSpeak(event) {
    if (this.data.sending) return;
    const message = this.data.messages.find((item) => item.id === event.detail.id);
    if (!message || message.role !== 'assistant' || message.error) return;
    if (
      this.data.speakingId === message.id &&
      ['synthesizing', 'playing'].includes(this.data.voiceState)
    ) {
      this._voice.cancel();
      return;
    }
    if (!['idle', 'synthesizing', 'playing'].includes(this.data.voiceState)) return;
    this.readReply(message);
  },
  onAutoReadChange(event) {
    const autoRead = event.detail.value === true;
    saveAutoRead(autoRead);
    this.setData({ autoRead });
    if (!autoRead && this._voice && ['synthesizing', 'playing'].includes(this.data.voiceState))
      this._voice.cancel();
  },
  readReply(message) {
    if (!this._voice || !this.data.pageActive) return;
    const pending = this._voice.speak(message.content).catch((error) => {
      this.setData({ speakingId: '' });
      wx.showToast({ title: error.message, icon: 'none' });
    });
    if (this._voice.state === 'synthesizing' || this._voice.state === 'playing')
      this.setData({ speakingId: message.id });
    return pending;
  },
  async sendMessage() {
    if (this.data.sending) return;
    if (
      this.data.voiceState &&
      !['idle', 'synthesizing', 'playing'].includes(this.data.voiceState)
    ) {
      wx.showToast({ title: '请先结束语音操作', icon: 'none' });
      return;
    }
    const value = this.data.input.trim();
    if (!value || this.data.sending) return;
    if (value.length > 500) {
      wx.showToast({ title: '最多输入 500 字', icon: 'none' });
      return;
    }
    if (this._voice && ['synthesizing', 'playing'].includes(this.data.voiceState))
      this._voice.cancel();
    const key = environmentKey();
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    const id = 'message-' + Date.now() + '-' + requestId;
    const messages = this.data.messages.concat({ id, role: 'user', content: value }).slice(-39);
    this.setData({
      messages,
      input: '',
      sending: true,
      scrollTarget: id,
      chatOpen: true,
      replyPresented: false
    });
    let replyToRead;
    try {
      const result = await chat(value);
      if (requestId !== this._requestId || key !== environmentKey()) return;
      const replyId = id + '-reply';
      const next = messages.concat({
        id: replyId,
        role: 'assistant',
        content: result.answer,
        notice: result.medicalDisclaimer || ''
      });
      this._connectionVersion = (this._connectionVersion || 0) + 1;
      this.setData({
        messages: next,
        scrollTarget: replyId,
        replyPresented: true,
        connection: this.data.mode === 'demo' ? 'demo' : 'connected',
        connectionLabel:
          this.data.mode === 'demo'
            ? '演示模式'
            : this.data.modelConfigured === false
              ? '知识库已连接'
              : '服务已连接'
      });
      getApp().globalData.chat = { key, messages: next };
      replyToRead = next[next.length - 1];
    } catch (error) {
      if (requestId !== this._requestId || key !== environmentKey()) return;
      this.setData({
        messages: messages.concat({
          id: id + '-error',
          role: 'assistant',
          error: true,
          content: error.message
        }),
        input: value,
        scrollTarget: id + '-error'
      });
    } finally {
      if (requestId === this._requestId && key === environmentKey())
        this.setData({ sending: false });
    }
    if (
      replyToRead &&
      requestId === this._requestId &&
      key === environmentKey() &&
      this.data.mode === 'live' &&
      this.data.autoRead &&
      this.data.pageActive &&
      this.data.chatOpen &&
      this.data.voiceState === 'idle'
    )
      this.readReply(replyToRead);
  }
});
