const { getSettings, environmentKey } = require('../../config/env');
const { chat, getBackendStatus } = require('../../services/api');
const { syncTab, windowInfo, keyboardInset } = require('../../utils/ui');

Page({
  data: {
    mode: 'demo',
    largeText: false,
    input: '',
    messages: [],
    sending: false,
    scrollTarget: '',
    chatOpen: false,
    chatWasOpened: false,
    inputFocused: false,
    connection: 'demo',
    connectionLabel: '演示模式',
    modelConfigured: null,
    navSpace: 82,
    keyboardHeight: 0,
    keyboardInset: 0,
    pageActive: true,
    replyPresented: false
  },
  onShow() {
    const config = getSettings();
    const key = environmentKey();
    const patch = { mode: config.mode, largeText: config.largeText, pageActive: true };
    if (key !== this._environment) {
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
      Object.assign(patch, {
        messages,
        input: '',
        sending: false,
        scrollTarget: '',
        chatOpen: false,
        chatWasOpened: false,
        inputFocused: false
      });
    }
    this._baselineHeight = windowInfo().windowHeight;
    if (Object.keys(patch).some((key) => this.data[key] !== patch[key])) this.setData(patch);
    syncTab(this, 0);
    if (wx.onKeyboardHeightChange && wx.offKeyboardHeightChange && !this._keyboardListener) {
      this._keyboardListener = (detail) => this.onKeyboardHeight({ detail });
      wx.onKeyboardHeightChange(this._keyboardListener);
    }
    this.refreshConnection();
  },
  onHide() {
    this.stopKeyboardListener();
    this.setData({ pageActive: false });
    this.dismissKeyboard();
  },
  onResize(event) {
    if (!this.data.pageActive) return;
    const height = (event && event.size && event.size.windowHeight) || windowInfo().windowHeight;
    if (!this.data.inputFocused) this._baselineHeight = height;
    this.updateKeyboard(this.data.keyboardHeight, height);
  },
  onKeyboardHeight({ detail }) {
    if (!this.data.pageActive || !this.data.inputFocused) return;
    const height = Math.max(0, Number(detail.height) || 0);
    if (!height && this.data.keyboardHeight) {
      this.dismissKeyboard(false);
      return;
    }
    this.updateKeyboard(height, windowInfo().windowHeight);
  },
  updateKeyboard(height, windowHeight, focused = this.data.inputFocused) {
    const inset = keyboardInset(height, this._baselineHeight || windowHeight, windowHeight);
    const wasOpen = this.data.keyboardHeight > 0;
    if (height !== this.data.keyboardHeight || inset !== this.data.keyboardInset ||
        focused !== this.data.inputFocused) {
      this.setData({ keyboardHeight: height, keyboardInset: inset, inputFocused: focused });
    }
    if (wasOpen !== (height > 0)) syncTab(this, 0, height > 0);
  },
  dismissKeyboard(hideNative = true) {
    const wasFocused = this.data.inputFocused;
    this.updateKeyboard(0, windowInfo().windowHeight, false);
    if (hideNative && wasFocused && wx.hideKeyboard) wx.hideKeyboard();
  },
  stopKeyboardListener() {
    if (!this._keyboardListener) return;
    wx.offKeyboardHeightChange(this._keyboardListener);
    this._keyboardListener = null;
  },
  openObservation() {
    wx.switchTab({ url: '/pages/observation/index' });
  },
  onUnload() {
    this.stopKeyboardListener();
    this._requestId = (this._requestId || 0) + 1;
    this._connectionVersion = (this._connectionVersion || 0) + 1;
  },
  async refreshConnection() {
    const key = environmentKey();
    if (this._connectionCheck && this._connectionCheck.key === key) return this._connectionCheck.promise;
    if (this._connectionKey === key && this._connectionResult && this._connectionResult.key === key &&
        Date.now() < this._connectionResult.expires) return;
    const version = (this._connectionVersion || 0) + 1;
    this._connectionVersion = version;
    if (this.data.mode !== 'live') {
      this._connectionResult = null;
      this._connectionKey = null;
      this._connectionCheck = null;
      if (this.data.connection !== 'demo')
        this.setData({ connection: 'demo', connectionLabel: '演示模式', modelConfigured: null });
      return;
    }
    if (this._connectionKey !== key) {
      this._connectionKey = key;
      this.setData({ connection: 'checking', connectionLabel: '连接中', modelConfigured: null });
    }
    const promise = this.checkConnection(key, version);
    this._connectionCheck = { key, promise };
    try {
      await promise;
    } finally {
      if (this._connectionCheck && this._connectionCheck.promise === promise) this._connectionCheck = null;
    }
  },
  async checkConnection(key, version) {
    try {
      const result = await getBackendStatus();
      if (version !== this._connectionVersion || key !== environmentKey()) return;
      this._connectionResult = { key, expires: Date.now() + 30000 };
      const patch = {
        connection: 'connected',
        connectionLabel: result.modelConfigured ? '服务已连接' : '知识库已连接',
        modelConfigured: result.modelConfigured
      };
      if (
        !result.modelConfigured &&
        this.data.messages.length === 1 &&
        this.data.messages[0].id === 'greeting'
      ) {
        patch.messages = [{
          id: 'greeting',
          role: 'assistant',
          content: '本机后端已连接。当前可查询认知健康知识；自由聊天需要在后端配置模型服务。'
        }];
      }
      this.setData(patch);
    } catch (_) {
      if (version === this._connectionVersion && key === environmentKey()) {
        this._connectionResult = { key, expires: Date.now() + 5000 };
        this.setData({ connection: 'unavailable', connectionLabel: '未连接', modelConfigured: null });
      }
    }
  },
  onInput(event) {
    this.setData({ input: event.detail.value });
  },
  openChat() {
    this.setData({ chatOpen: true, chatWasOpened: true });
  },
  closeChat() {
    this.dismissKeyboard();
    this.setData({ chatOpen: false });
  },
  onInputFocus(event) {
    if (!this.data.pageActive) return;
    if (!this.data.inputFocused)
      this.setData({ chatOpen: true, chatWasOpened: true, inputFocused: true, replyPresented: false });
    const height = event && event.detail && event.detail.height;
    if (height > 0) this.onKeyboardHeight({ detail: { height } });
  },
  onInputBlur() {
    this.dismissKeyboard(false);
  },
  openProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },
  onQuickTopic(event) {
    if (this.data.sending) return;
    this.setData({ input: event.currentTarget.dataset.message });
    this.sendMessage();
  },
  async sendMessage() {
    const value = this.data.input.trim();
    if (!value || this.data.sending) return;
    if (value.length > 500) {
      wx.showToast({ title: '最多输入 500 字', icon: 'none' });
      return;
    }
    this.dismissKeyboard();
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
      chatWasOpened: true,
      replyPresented: false
    });
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
  }
});
