const { getSettings, saveSettings, environmentKey } = require('../../config/env');
const { getBackendStatus, login } = require('../../services/api');
const { getSession, clearSession } = require('../../services/session');
const { syncTab } = require('../../utils/ui');
const { version } = require('../../config/product');

Page({
  data: {
    mode: 'demo',
    largeText: false,
    apiBaseUrl: '',
    username: '',
    password: '',
    loggedInUser: '',
    status: '',
    statusError: false,
    busy: false,
    connectionExpanded: false,
    connectionSummary: '尚未配置服务器',
    connectionTestLabel: '未测试 · 点击检测服务器',
    savedMode: 'demo',
    hasChanges: false,
    passwordVisible: false,
    logoutVisible: false,
    aboutVisible: false,
    loginExpanded: false,
    navSpace: 82,
    version
  },
  onShow() {
    const config = getSettings();
    const session = config.mode === 'live' ? getSession() : null;
    this.setData({
      mode: config.mode,
      largeText: config.largeText,
      apiBaseUrl: config.apiBaseUrl,
      loggedInUser: session ? session.username : '',
      password: '',
      status: '',
      connectionExpanded: !config.apiBaseUrl,
      savedMode: config.mode,
      hasChanges: false,
      passwordVisible: false,
      logoutVisible: false,
      aboutVisible: false,
      connectionTestLabel: '未测试 · 点击检测服务器',
      connectionSummary:
        config.mode === 'demo'
          ? '演示服务 · 不调用服务器'
          : config.apiBaseUrl
            ? '已配置服务器'
            : '尚未配置服务器'
    });
    syncTab(this, 3);
    this.setData({ loginExpanded: getApp().globalData.profileAction === 'login' });
    getApp().globalData.profileAction = '';
  },
  toggleConnection() {
    this.setData({ connectionExpanded: !this.data.connectionExpanded });
  },
  showAbout() {
    this.setData({ aboutVisible: true });
  },
  closeAbout() {
    this.setData({ aboutVisible: false });
  },
  toggleLogin() {
    this.setData({ loginExpanded: !this.data.loginExpanded });
  },
  togglePassword() {
    this.setData({ passwordVisible: !this.data.passwordVisible });
  },
  onModeSelect(event) {
    this.onModeChange({ detail: { value: event.currentTarget.dataset.mode === 'live' } });
  },
  onBaseUrl(event) {
    this.setData({ apiBaseUrl: event.detail.value, hasChanges: true });
  },
  onUsername(event) {
    this.setData({ username: event.detail.value });
  },
  onPassword(event) {
    this.setData({ password: event.detail.value });
  },
  onModeChange(event) {
    this.setData({
      mode: event.detail.value ? 'live' : 'demo',
      hasChanges: true,
      connectionExpanded: true,
      status: '请选择服务环境并保存设置。',
      statusError: false
    });
  },
  onTextChange(event) {
    const largeText = event.detail.value;
    // Apply a reading preference immediately without saving unfinished connection fields.
    saveSettings(Object.assign({}, getSettings(), { largeText }));
    this.setData({ largeText });
    syncTab(this, 3);
  },
  saveConfig() {
    if (this.data.busy) return false;
    try {
      const before = environmentKey();
      const config = saveSettings(this.data);
      if (before !== environmentKey()) getApp().globalData.chat = null;
      const session = config.mode === 'live' ? getSession() : null;
      this.setData({
        apiBaseUrl: config.apiBaseUrl,
        loggedInUser: session ? session.username : '',
        password: '',
        status: '设置已保存',
        statusError: false,
        savedMode: config.mode,
        hasChanges: false,
        connectionTestLabel: '未测试 · 点击检测服务器',
        connectionSummary: config.mode === 'demo' ? '演示服务 · 不调用服务器' : '已配置服务器'
      });
      return true;
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
      return false;
    }
  },
  async testConnection() {
    if (!this.saveConfig()) return;
    if (this.data.mode === 'demo') {
      this.setData({
        status: '当前为演示服务，不调用服务器。请保存真实服务设置后测试。',
        connectionTestLabel: '演示服务 · 未进行网络测试'
      });
      return;
    }
    this.setData({
      busy: true,
      connectionTestLabel: '测试中…',
      status: '正在检测后端连接…',
      statusError: false
    });
    try {
      const result = await getBackendStatus();
      this.setData({
        status: result.modelConfigured
          ? '连接成功，文字对话服务已就绪。'
          : '后端连接正常。当前使用本地知识库，自由聊天需要在后端配置模型密钥。',
        statusError: false,
        connectionTestLabel: '连接成功',
        connectionSummary: '服务已连接'
      });
    } catch (error) {
      this.setData({
        status: error.message,
        statusError: true,
        connectionTestLabel: '连接失败 · 点击重试',
        connectionSummary: '连接失败'
      });
    } finally {
      this.setData({ busy: false });
    }
  },
  async signIn() {
    const username = this.data.username;
    const password = this.data.password;
    if (!this.saveConfig()) return;
    this.setData({ busy: true, status: '正在登录…', statusError: false });
    try {
      const session = await login(username, password);
      this.setData({
        loggedInUser: session.username,
        password: '',
        passwordVisible: false,
        loginExpanded: false,
        status: '登录成功，可以在“记录”查看已有观察任务。'
      });
    } catch (error) {
      this.setData({ password: '', status: error.message, statusError: true });
    } finally {
      this.setData({ busy: false });
    }
  },
  signOut() {
    if (!this.data.busy) this.setData({ logoutVisible: true });
  },
  cancelSignOut() {
    this.setData({ logoutVisible: false });
  },
  confirmSignOut() {
    if (this.data.busy) return;
    clearSession();
    this.setData({
      loggedInUser: '',
      password: '',
      passwordVisible: false,
      logoutVisible: false,
      status: '已退出登录',
      statusError: false
    });
  }
});
