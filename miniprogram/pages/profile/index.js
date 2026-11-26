const { getSettings, saveSettings, environmentKey } = require('../../config/env');
const { getBackendStatus, login } = require('../../services/api');
const { getSession, clearSession } = require('../../services/session');

Page({
  data: { mode: 'demo', largeText: false, apiBaseUrl: '', username: '', password: '', loggedInUser: '', status: '', statusError: false, busy: false, connectionExpanded: false },
  onShow() {
    const config = getSettings();
    const session = config.mode === 'live' ? getSession() : null;
    this.setData({ mode: config.mode, largeText: config.largeText, apiBaseUrl: config.apiBaseUrl, loggedInUser: session ? session.username : '', password: '', status: '', connectionExpanded: !config.apiBaseUrl });
  },
  toggleConnection() { this.setData({ connectionExpanded: !this.data.connectionExpanded }); },
  showAbout() { wx.showModal({ title: '忆声陪伴', content: 'V0.1.0 · 支持文字陪伴与记录查询。语音、数字人视频和真实录音观察尚未开放。', showCancel: false }); },
  onBaseUrl(event) { this.setData({ apiBaseUrl: event.detail.value }); },
  onUsername(event) { this.setData({ username: event.detail.value }); },
  onPassword(event) { this.setData({ password: event.detail.value }); },
  onModeChange(event) { this.setData({ mode: event.detail.value ? 'live' : 'demo', status: '' }); },
  onTextChange(event) {
    const largeText = event.detail.value;
    // Apply a reading preference immediately without saving unfinished connection fields.
    saveSettings(Object.assign({}, getSettings(), { largeText }));
    this.setData({ largeText });
  },
  saveConfig() {
    if (this.data.busy) return false;
    try {
      const before = environmentKey();
      const config = saveSettings(this.data);
      if (before !== environmentKey()) getApp().globalData.chat = null;
      const session = config.mode === 'live' ? getSession() : null;
      this.setData({ apiBaseUrl: config.apiBaseUrl, loggedInUser: session ? session.username : '', password: '', status: '设置已保存', statusError: false });
      return true;
    } catch (error) {
      this.setData({ status: error.message, statusError: true }); return false;
    }
  },
  async testConnection() {
    if (!this.saveConfig()) return;
    this.setData({ busy: true, status: '正在检测后端连接…', statusError: false });
    try {
      const result = await getBackendStatus();
      this.setData({ status: result.modelConfigured ? '后端连接正常，已配置对话模型。' : '后端连接正常。当前使用本地知识库，自由聊天需要在后端配置模型密钥。', statusError: false });
    } catch (error) { this.setData({ status: error.message, statusError: true }); }
    finally { this.setData({ busy: false }); }
  },
  async signIn() {
    const username = this.data.username;
    const password = this.data.password;
    if (!this.saveConfig()) return;
    this.setData({ busy: true, status: '正在登录…', statusError: false });
    try {
      const session = await login(username, password);
      this.setData({ loggedInUser: session.username, password: '', status: '登录成功，可以在“记录”查看已有观察任务。' });
    } catch (error) { this.setData({ password: '', status: error.message, statusError: true }); }
    finally { this.setData({ busy: false }); }
  },
  signOut() {
    if (this.data.busy) return;
    clearSession();
    this.setData({ loggedInUser: '', password: '', status: '已退出登录', statusError: false });
  }
});
