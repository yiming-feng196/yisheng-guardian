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
  const uploading = Boolean(options.filePath);
  const downloading = options.download === true;
  if (options.auth === 'required' && !session) {
    return Promise.reject(new Error('请先到“我的”登录项目账号'));
  }
  return new Promise((resolve, reject) => {
    const callbacks = {
      url: config.apiBaseUrl + options.path,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 60000,
      header: Object.assign(
        {
          ...(uploading ? {} : { 'Content-Type': 'application/json' }),
          'X-Assistant-Client-Id': getClientId()
        },
        session ? { Authorization: 'Bearer ' + session.token } : {}
      ),
      success(response) {
        // wx.request also calls success for HTTP 4xx/5xx.
        if (response.statusCode >= 200 && response.statusCode < 300) {
          let result = response.data;
          if (uploading && typeof result === 'string') {
            try { result = JSON.parse(result); } catch (_) { /* Plain text upload acknowledgement. */ }
          }
          if (downloading && !response.tempFilePath) reject(new Error('服务器未返回可用文件'));
          else resolve(downloading ? response.tempFilePath : result);
          return;
        }
        if (downloading && response.tempFilePath)
          wx.getFileSystemManager().unlink({ filePath: response.tempFilePath, fail() {} });
        if (session && response.statusCode === 401 && getSession(config.apiBaseUrl)?.token === session.token)
          clearSession(config.apiBaseUrl);
        let data = response.data;
        if (uploading && typeof data === 'string') {
          try { data = JSON.parse(data); } catch (_) { /* Fall back to HTTP status. */ }
        }
        const message = data && (data.message || data.error);
        const error = new Error(typeof message === 'string' ? message : '请求失败（' + response.statusCode + '）');
        error.statusCode = response.statusCode;
        reject(error);
      },
      fail(error) {
        reject(networkError(error));
      }
    };
    const task = uploading
      ? wx.uploadFile({ ...callbacks, filePath: options.filePath, name: 'file', formData: options.data })
      : downloading ? wx.downloadFile(callbacks)
      : wx.request({ ...callbacks, responseType: options.responseType });
    if (options.onProgress) task?.onProgressUpdate?.(({ progress }) => options.onProgress(progress));
    options.onTask?.(task);
  });
}

module.exports = { request };
