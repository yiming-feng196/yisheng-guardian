const { getSettings, environmentKey } = require('../../config/env');
const { chat } = require('../../services/api');

Page({
  data: { mode: 'demo', largeText: false, input: '', messages: [], sending: false, scrollTarget: '', chatOpen: false, inputFocused: false },
  onShow() {
    const config = getSettings();
    const key = environmentKey();
    this.setData({ mode: config.mode, largeText: config.largeText });
    if (key !== this._environment) {
      this._environment = key;
      this._requestId = (this._requestId || 0) + 1;
      const cached = getApp().globalData.chat;
      const messages = cached && cached.key === key ? cached.messages : [{
        id: 'greeting', role: 'assistant', content: '今天想聊些什么？可以聊聊生活、心情，也可以从一个小故事开始。'
      }];
      this.setData({ messages, input: '', sending: false, scrollTarget: '', chatOpen: false, inputFocused: false });
    }
  },
  onUnload() { this._requestId = (this._requestId || 0) + 1; },
  onInput(event) { this.setData({ input: event.detail.value }); },
  openChat() { this.setData({ chatOpen: true }); },
  closeChat() {
    this.setData({ chatOpen: false, inputFocused: false });
    if (wx.hideKeyboard) wx.hideKeyboard();
  },
  onInputFocus() { this.setData({ chatOpen: true, inputFocused: true }); },
  onInputBlur() { this.setData({ inputFocused: false }); },
  openProfile() { wx.switchTab({ url: '/pages/profile/index' }); },
  onQuickTopic(event) {
    if (this.data.sending) return;
    this.setData({ input: event.currentTarget.dataset.message });
    this.sendMessage();
  },
  async sendMessage() {
    const value = this.data.input.trim();
    if (!value || this.data.sending) return;
    if (value.length > 500) { wx.showToast({ title: '最多输入 500 字', icon: 'none' }); return; }
    const key = environmentKey();
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    const id = 'message-' + Date.now() + '-' + requestId;
    const messages = this.data.messages.concat({ id, role: 'user', content: value }).slice(-39);
    this.setData({ messages, input: '', sending: true, scrollTarget: id, chatOpen: true });
    try {
      const result = await chat(value);
      if (requestId !== this._requestId || key !== environmentKey()) return;
      const replyId = id + '-reply';
      const next = messages.concat({ id: replyId, role: 'assistant', content: result.answer });
      this.setData({ messages: next, scrollTarget: replyId });
      getApp().globalData.chat = { key, messages: next };
    } catch (error) {
      if (requestId !== this._requestId || key !== environmentKey()) return;
      this.setData({ messages: messages.concat({ id: id + '-error', role: 'assistant', error: true, content: error.message }), input: value, scrollTarget: id + '-error' });
    } finally {
      if (requestId === this._requestId && key === environmentKey()) this.setData({ sending: false });
    }
  },
  showVoicePlan() {
    wx.showModal({ title: '语音交流尚未开放', content: '您可以先输入文字，或点选“聊聊今天”和“听个故事”。当前不会使用麦克风或播放数字人视频。', showCancel: false });
  }
});
