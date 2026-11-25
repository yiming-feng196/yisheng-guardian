const { getSettings } = require('../config/env');
const { getClientId, getSession, clearSession } = require('./session');

function request(options) {
  const config = getSettings();
  if (!config.apiBaseUrl) return Promise.reject(new Error('请先在“我的”中配置后端地址'));
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
      header: Object.assign({
        'Content-Type': 'application/json',
        'X-Assistant-Client-Id': getClientId()
      }, session ? { Authorization: 'Bearer ' + session.token } : {}),
      success(response) {
        // wx.request also calls success for HTTP 4xx/5xx.
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (session && response.statusCode === 401) clearSession(config.apiBaseUrl);
        const data = response.data;
        const message = data && (data.message || data.error);
        reject(new Error(typeof message === 'string' ? message : '请求失败（' + response.statusCode + '）'));
      },
      fail(error) {
        const timeout = /timeout/i.test(error.errMsg || '');
        reject(new Error(timeout ? '请求超时，请重试' : '无法连接后端，请检查地址、网络及开发工具域名设置'));
      }
    });
  });
}

module.exports = { request };
