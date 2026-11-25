const { getSettings } = require('../config/env');
const CLIENT_KEY = 'yisheng.mp.clientId.v1';

function getClientId() {
  let id = wx.getStorageSync(CLIENT_KEY);
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    // This UUID identifies an anonymous conversation; it is not a credential.
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (letter) => {
      const value = Math.floor(Math.random() * 16);
      return (letter === 'x' ? value : (value & 3) | 8).toString(16);
    });
    wx.setStorageSync(CLIENT_KEY, id);
  }
  return id;
}

function sessionKey(baseUrl) {
  return 'yisheng.mp.session.v1:' + encodeURIComponent(baseUrl || getSettings().apiBaseUrl);
}

function getSession(baseUrl) {
  const saved = wx.getStorageSync(sessionKey(baseUrl));
  return saved && typeof saved.token === 'string' ? saved : null;
}

function saveSession(username, token, baseUrl) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token.trim())) {
    throw new Error(typeof token === 'string' && token.length < 100 ? token : '登录未返回有效凭证');
  }
  const session = { username, token: token.trim() };
  wx.setStorageSync(sessionKey(baseUrl), session);
  return session;
}

function clearSession(baseUrl) { wx.removeStorageSync(sessionKey(baseUrl)); }

module.exports = { getClientId, getSession, saveSession, clearSession };
