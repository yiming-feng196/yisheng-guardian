const { getSettings } = require('../config/env');
const { request } = require('./request');
const { getSession, saveSession } = require('./session');

function checkConnection() {
  return request({ path: '/actuator/health', auth: false, timeout: 8000 }).then((result) => {
    if (!result || result.status !== 'UP') throw new Error('后端健康检查未通过');
    return result;
  });
}

function chat(message) {
  const value = String(message || '').trim();
  if (!value || value.length > 500) return Promise.reject(new Error('请输入 1–500 字的消息'));
  if (getSettings().mode === 'demo') {
    return Promise.resolve({
      title: '小忆',
      answer: '这是界面演示回复，尚未调用 AI。连接真实服务后，小忆才能继续和您聊天。'
    });
  }
  // A single-turn interface establishes connectivity before the SSE migration.
  return request({
    path: '/assistant/chat',
    method: 'POST',
    auth: false,
    timeout: 120000,
    data: { message: value }
  }).then((result) => {
    if (!result || typeof result.answer !== 'string' || !result.answer.trim())
      throw new Error('后端未返回有效回答');
    return result;
  });
}

function login(username, password) {
  const config = getSettings();
  if (config.mode === 'demo')
    return Promise.reject(new Error('演示模式不会验证账号，请先切换到接口联调模式'));
  if (!username.trim() || !password) return Promise.reject(new Error('请填写账号和密码'));
  return request({
    path: '/user/login',
    method: 'POST',
    auth: false,
    data: { username: username.trim(), password }
  }).then((token) => saveSession(username.trim(), token, config.apiBaseUrl));
}

function listRecords() {
  if (getSettings().mode === 'demo') {
    return Promise.resolve([
      {
        id: 'demo-1',
        title: '看图讲述流程示例',
        status: '演示数据',
        description: '展示任务与报告入口，不代表真实录音或观察结果。'
      },
      {
        id: 'demo-2',
        title: '观察记录页面示例',
        status: '演示数据',
        description: '切换到接口联调模式后，这里读取当前登录账号的观察任务。'
      }
    ]);
  }
  if (!getSession()) return Promise.reject(new Error('请先到“我的”登录现有项目账号'));
  return request({ path: '/api/v1/screenings' }).then((items) => {
    if (!Array.isArray(items)) throw new Error('后端任务列表格式不正确');
    return items.map((item) => ({
      id: item.taskId,
      title: '语音观察任务',
      status: item.status || '状态待确认',
      createdAt: item.requestedAt || item.createdAt || '',
      description: item.message || item.createdAt || '',
      report: item.result && typeof item.result.report === 'string' ? item.result.report : ''
    }));
  });
}

function getBackendStatus() {
  return checkConnection()
    .then(() => request({ path: '/assistant/status', auth: false, timeout: 8000 }))
    .then((result) => {
      if (
        !result ||
        result.service !== 'yisheng-backend' ||
        typeof result.modelConfigured !== 'boolean'
      ) {
        throw new Error('服务已响应，但后端版本不匹配，请更新本机后端');
      }
      return result;
    });
}

module.exports = { checkConnection, getBackendStatus, chat, login, listRecords };
