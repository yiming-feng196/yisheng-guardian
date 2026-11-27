const { getSettings, saveSettings, normalizeBaseUrl, environmentKey } = require('../../config/env');
const { getBackendStatus, login, register } = require('../../services/api');
const { getSession, clearSession } = require('../../services/session');
const { syncTab } = require('../../utils/ui');
const { connectionHint, isLoopback } = require('../../utils/connection');
const deployment = require('../../config/deployment');
const { version } = require('../../config/product');

Page({
  data: {
    mode: 'demo',
    largeText: false,
    apiBaseUrl: '',
    username: '',
    password: '',
    confirmPassword: '',
    authMode: 'login',
    loggedInUser: '',
    status: '',
    statusArea: '',
    statusError: false,
    busy: false,
    connectionExpanded: false,
    connectionSummary: '尚未配置服务器',
    connectionTestLabel: '未测试 · 点击检测服务器',
    connectionHint: '',
    connectionErrorDetail: '',
    deviceBaseUrl: '',
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
    this._operation = (this._operation || 0) + 1;
    const config = getSettings();
    const session = config.mode === 'live' ? getSession() : null;
    const deviceBaseUrl =
      deployment.deviceBaseUrl && !isLoopback(deployment.deviceBaseUrl)
        ? deployment.deviceBaseUrl
        : '';
    this.setData({
      mode: config.mode,
      largeText: config.largeText,
      apiBaseUrl: config.apiBaseUrl,
      loggedInUser: session ? session.username : '',
      password: '',
      confirmPassword: '',
      authMode: 'login',
      status: '',
      statusArea: '',
      statusError: false,
      busy: false,
      connectionExpanded: !config.apiBaseUrl,
      savedMode: config.mode,
      hasChanges: false,
      passwordVisible: false,
      logoutVisible: false,
      aboutVisible: false,
      connectionTestLabel: '未测试 · 点击检测服务器',
      connectionErrorDetail: '',
      connectionHint: connectionHint(config.apiBaseUrl),
      deviceBaseUrl,
      connectionSummary:
        config.mode === 'demo'
          ? '演示服务 · 不调用服务器'
          : config.apiBaseUrl
            ? '已配置服务器'
            : '尚未配置服务器',
      loginExpanded: getApp().globalData.profileAction === 'login'
    });
    getApp().globalData.profileAction = '';
    syncTab(this, 3);
  },
  onUnload() {
    this._operation = (this._operation || 0) + 1;
  },
  toggleConnection() {
    if (!this.data.busy) this.setData({ connectionExpanded: !this.data.connectionExpanded });
  },
  openConnection() {
    this.setData({ connectionExpanded: true });
    if (wx.pageScrollTo) wx.pageScrollTo({ selector: '#connection-settings', duration: 180 });
  },
  showAbout() {
    this.setData({ aboutVisible: true });
    syncTab(this, 3, true);
  },
  closeAbout() {
    this.setData({ aboutVisible: false });
    syncTab(this, 3, this.data.logoutVisible);
  },
  toggleLogin() {
    if (!this.data.busy) this.setData({ loginExpanded: !this.data.loginExpanded });
  },
  togglePassword() {
    this.setData({ passwordVisible: !this.data.passwordVisible });
  },
  onAuthMode(event) {
    if (this.data.busy) return;
    this.setData({
      authMode: event.currentTarget.dataset.mode === 'register' ? 'register' : 'login',
      password: '',
      confirmPassword: '',
      passwordVisible: false,
      status: '',
      statusError: false
    });
  },
  onModeSelect(event) {
    this.onModeChange({ detail: { value: event.currentTarget.dataset.mode === 'live' } });
  },
  onBaseUrl(event) {
    this.setData({
      apiBaseUrl: event.detail.value,
      hasChanges: true,
      connectionHint: connectionHint(event.detail.value),
      connectionErrorDetail: ''
    });
  },
  onUsername(event) {
    this.setData({ username: event.detail.value });
  },
  onPassword(event) {
    this.setData({ password: event.detail.value });
  },
  onConfirmPassword(event) {
    this.setData({ confirmPassword: event.detail.value });
  },
  onModeChange(event) {
    if (this.data.busy) return;
    this.setData({
      mode: event.detail.value ? 'live' : 'demo',
      hasChanges: true,
      connectionExpanded: true,
      status: '请选择服务环境并保存设置。',
      statusArea: 'connection',
      statusError: false
    });
  },
  onTextChange(event) {
    const largeText = event.detail.value;
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
        confirmPassword: '',
        status: '设置已保存',
        statusArea: 'connection',
        statusError: false,
        savedMode: config.mode,
        hasChanges: false,
        connectionTestLabel: '未测试 · 点击检测服务器',
        connectionErrorDetail: '',
        connectionHint: connectionHint(config.apiBaseUrl),
        connectionSummary: config.mode === 'demo' ? '演示服务 · 不调用服务器' : '已配置服务器'
      });
      return true;
    } catch (error) {
      this.setData({
        status: error.message,
        statusArea: 'connection',
        statusError: true,
        connectionExpanded: true
      });
      return false;
    }
  },
  async useDeviceAddress() {
    if (this.data.busy || !this.data.deviceBaseUrl) return;
    this.setData({
      apiBaseUrl: this.data.deviceBaseUrl,
      mode: 'live',
      hasChanges: true,
      connectionExpanded: true
    });
    return this.testConnection();
  },
  copyHealthUrl() {
    try {
      const base = normalizeBaseUrl(this.data.apiBaseUrl);
      if (!base) throw new Error('请先填写服务地址');
      if (!wx.setClipboardData)
        throw new Error('当前客户端无法复制，请手动在服务地址后添加 /actuator/health');
      wx.setClipboardData({
        data: base + '/actuator/health',
        success: () => {
          this.setData({
            status:
              '健康检查地址已复制，请在手机浏览器打开。若返回 UP，说明网络可达，可继续检查微信调试与域名设置。',
            statusArea: 'connection',
            statusError: false
          });
        }
      });
    } catch (error) {
      this.setData({ status: error.message, statusArea: 'connection', statusError: true });
    }
  },
  async testConnection() {
    if (!this.saveConfig()) return;
    if (this.data.mode === 'demo') {
      this.setData({
        status: '当前为演示服务，不调用服务器。请保存真实服务设置后测试。',
        statusArea: 'connection',
        connectionTestLabel: '演示服务 · 未进行网络测试'
      });
      return;
    }
    const operation = (this._operation = (this._operation || 0) + 1);
    const key = environmentKey();
    this.setData({
      busy: true,
      connectionTestLabel: '测试中…',
      status: '正在检测后端连接…',
      statusArea: 'connection',
      statusError: false,
      connectionErrorDetail: ''
    });
    try {
      const result = await getBackendStatus();
      if (operation !== this._operation || key !== environmentKey()) return;
      this.setData({
        status: result.modelConfigured
          ? '连接成功，文字对话服务已就绪。'
          : '后端已连接，当前使用本地知识库，对话模型尚未配置。',
        statusError: false,
        connectionTestLabel: '连接成功',
        connectionSummary: '服务已连接'
      });
    } catch (error) {
      if (operation !== this._operation || key !== environmentKey()) return;
      this.setData({
        status: error.message,
        statusError: true,
        connectionErrorDetail: error.nativeMessage || '',
        connectionTestLabel: '连接失败 · 点击重试',
        connectionSummary: '连接失败',
        connectionExpanded: true
      });
    } finally {
      if (operation === this._operation) this.setData({ busy: false });
    }
  },
  submitAuth() {
    return this.data.authMode === 'register' ? this.signUp() : this.signIn();
  },
  async signIn() {
    const username = this.data.username,
      password = this.data.password;
    if (!this.saveConfig()) return;
    const operation = (this._operation = (this._operation || 0) + 1);
    const key = environmentKey();
    this.setData({ busy: true, status: '正在登录…', statusArea: 'auth', statusError: false });
    try {
      const session = await login(username, password);
      if (operation !== this._operation || key !== environmentKey()) return;
      this.setData({
        loggedInUser: session.username,
        password: '',
        confirmPassword: '',
        passwordVisible: false,
        loginExpanded: false,
        status: '登录成功，可以在“记录”查看已有观察任务。'
      });
    } catch (error) {
      if (operation === this._operation && key === environmentKey())
        this.setData({ status: error.message, statusError: true });
    } finally {
      if (operation === this._operation)
        this.setData({ busy: false, password: '', confirmPassword: '', passwordVisible: false });
    }
  },
  async signUp() {
    if (this.data.busy) return;
    const username = this.data.username,
      password = this.data.password,
      confirmation = this.data.confirmPassword;
    if (password !== confirmation) {
      this.setData({ status: '两次输入的密码不一致', statusArea: 'auth', statusError: true });
      return;
    }
    if (!this.saveConfig()) return;
    const operation = (this._operation = (this._operation || 0) + 1);
    const key = environmentKey();
    this.setData({ busy: true, status: '正在创建账号…', statusArea: 'auth', statusError: false });
    try {
      const account = await register(username, password);
      if (operation !== this._operation || key !== environmentKey()) return;
      this.setData({
        username: account.username,
        authMode: 'login',
        loginExpanded: true,
        status: '注册成功，请输入密码登录。',
        statusError: false
      });
    } catch (error) {
      if (operation === this._operation && key === environmentKey())
        this.setData({ status: error.message, statusError: true });
    } finally {
      if (operation === this._operation)
        this.setData({ busy: false, password: '', confirmPassword: '', passwordVisible: false });
    }
  },
  signOut() {
    if (this.data.busy) return;
    this.setData({ logoutVisible: true });
    syncTab(this, 3, true);
  },
  cancelSignOut() {
    this.setData({ logoutVisible: false });
    syncTab(this, 3, this.data.aboutVisible);
  },
  confirmSignOut() {
    if (this.data.busy) return;
    clearSession();
    this.setData({
      loggedInUser: '',
      password: '',
      confirmPassword: '',
      passwordVisible: false,
      logoutVisible: false,
      status: '已退出登录',
      statusArea: '',
      statusError: false
    });
    syncTab(this, 3, this.data.aboutVisible);
  }
});
