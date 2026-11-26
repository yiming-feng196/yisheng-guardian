const SETTINGS_KEY = 'yisheng.mp.settings.v1';
const DEFAULTS = Object.freeze({ mode: 'demo', apiBaseUrl: '', largeText: false });
const deployment = require('./deployment');
const DEPLOYMENT_KEY = 'yisheng.mp.localDeployment.v1';

function normalizeBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~%/-]*)?$/.test(url)) {
    throw new Error('请输入有效的 http:// 或 https:// 后端地址，不含账号、查询参数或片段');
  }
  return url;
}

function getSettings() {
  const saved = wx.getStorageSync(SETTINGS_KEY) || {};
  let apiBaseUrl = '';
  try { apiBaseUrl = normalizeBaseUrl(saved.apiBaseUrl); } catch (_) { /* Ignore invalid old settings. */ }
  return {
    mode: saved.mode === 'live' ? 'live' : DEFAULTS.mode,
    apiBaseUrl,
    largeText: saved.largeText === true
  };
}

function saveSettings(input) {
  const mode = input.mode === 'live' ? 'live' : 'demo';
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  if (mode === 'live' && !apiBaseUrl) throw new Error('接口联调模式需要先填写后端地址');
  const result = { mode, apiBaseUrl, largeText: input.largeText === true };
  wx.setStorageSync(SETTINGS_KEY, result);
  return result;
}

function environmentKey() {
  const config = getSettings();
  return config.mode + ':' + config.apiBaseUrl;
}

function applyDeploymentDefaults() {
  if (!deployment.enabled || wx.getStorageSync(DEPLOYMENT_KEY) === deployment.revision) return false;
  const platform = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo().platform : '';
  if (!platform) return false;
  const baseUrl = platform === 'devtools' ? deployment.devtoolsBaseUrl : deployment.deviceBaseUrl;
  if (!baseUrl) return false;
  const current = getSettings();
  // A local launcher can request one migration; later explicit choices remain.
  if (deployment.forceLocal || !current.apiBaseUrl) saveSettings(Object.assign({}, current, { mode: 'live', apiBaseUrl: baseUrl }));
  wx.setStorageSync(DEPLOYMENT_KEY, deployment.revision);
  return true;
}

module.exports = { DEFAULTS, getSettings, saveSettings, normalizeBaseUrl, environmentKey, applyDeploymentDefaults };
