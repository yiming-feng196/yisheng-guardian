const { getSettings } = require('../config/env');
const { getClientId, getSession, clearSession } = require('./session');
const { platform, isLoopback, networkError } = require('../utils/connection');

function request(options) {
  const config = getSettings();
  if (!config.apiBaseUrl) return Promise.reject(new Error('请先在“我的”中配置后端地址'));
  const devicePlatform = platform();
  if (devicePlatform && devicePlatform !== 'devtools' && isLoopback(config.apiBaseUrl)) {
    const error = new Error('当前地址指向手机自身。请在“我的 → 服务连接”填写电脑的 Wi-Fi 地址。');
    error.code = 'DEVICE_LOOPBACK';
    return Promise.reject(error);
  }
  if (!options || typeof options.path !== 'string' || !/^\/(?!\/)/.test(options.path)) {
    return Promise.reject(new Error('接口路径必须以单个 / 开头'));
  }
  const session = options.auth === false ? null : getSession(config.apiBaseUrl);
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.apiBaseUrl + options.path,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 60000,
      header: Object.assign(
        {
          'Content-Type': 'application/json',
          'X-Assistant-Client-Id': getClientId()
        },
        session ? { Authorization: 'Bearer ' + session.token } : {}
      ),
      success(response) {
        // wx.request also calls success for HTTP 4xx/5xx.
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (session && response.statusCode === 401) clearSession(config.apiBaseUrl);
        const data = response.data;
        const message = data && (data.message || data.error);
        reject(
          new Error(
            typeof message === 'string' ? message : '请求失败（' + response.statusCode + '）'
          )
        );
      },
      fail(error) {
        reject(networkError(error));
      }
    });
  });
}

module.exports = { request };
