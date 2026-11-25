const { getSettings, environmentKey } = require('../../config/env');
const { chat } = require('../../services/api');

Page({
  data: { mode: 'demo', largeText: false, input: '', messages: [], sending: false, scrollTarget: '' },
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
      this.setData({ messages, input: '', sending: false, scrollTarget: '' });
    }
  },
  onUnload() { this._requestId = (this._requestId || 0) + 1; },
  onInput(event) { this.setData({ input: event.detail.value }); },
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
    this.setData({ messages, input: '', sending: true, scrollTarget: id });
    try {
      const result = await chat(value);
      if (requestId !== this._requestId || key !== environmentKey()) return;
      const replyId = id + '-reply';
      const next = messages.concat({ id: replyId, role: 'assistant', content: result.answer });
      this.setData({ messages: next, scrollTarget: replyId });
      getApp().globalData.chat = { key, messages: next };
    } catch (error) {
      if (requestId !== this._requestId || key !== environmentKey()) return;
      this.setData({ messages: messages.concat({ id: id + '-error', role: 'assistant', error: true, content: error.message }), input: value });
    } finally {
      if (requestId === this._requestId && key === environmentKey()) this.setData({ sending: false });
    }
  },
  showVoicePlan() {
    wx.showModal({ title: '语音功能接入位置', content: '当前是公共骨架，尚未调用麦克风或播放语音。队友 A 在此接入录音、转写和朗读；现阶段可以使用文字问答。', showCancel: false });
  }
});
