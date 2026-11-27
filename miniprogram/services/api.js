const { getSettings } = require('../config/env');
const { request } = require('./request');
const { getSession, saveSession } = require('./session');

const CONSENT_VERSION = 'voice-screening-consent-v1';
const TASK_TYPE = 'NATURAL_SPEECH';

async function uploadObservation(filePath, consentAccepted, onProgress, isCurrent) {
  if (getSettings().mode !== 'live' || !consentAccepted || !filePath) {
    throw new Error('请在接口联调模式中确认知情同意并完成录音');
  }
  const result = await withAudioExtension(filePath, 'wav', (path) => isCurrent() && request({
    path: '/audio/upload', auth: 'required', filePath: path, onProgress,
    data: { imageName: 'test.jpg', consentAccepted: 'true', consentVersion: CONSENT_VERSION, taskType: TASK_TYPE }
  }));
  if (typeof result !== 'string' || result.trim() !== '上传成功') {
    throw new Error('后端未确认录音已保存');
  }
}

async function observationRequest(path, method) {
  if (getSettings().mode !== 'live') throw new Error('请先切换到接口联调模式');
  return request({ path, method, auth: 'required' });
}

async function listAudios() {
  const items = await observationRequest('/audio/my');
  if (!Array.isArray(items)) throw new Error('后端录音列表格式不正确');
  return items.filter((item) => item && Number.isSafeInteger(item.id) && item.id > 0).map((item) => ({
    id: item.id, name: item.filePath, duration: item.duration, time: item.uploadTime,
    canAnalyze: item.consentVersion === CONSENT_VERSION && item.taskType === TASK_TYPE
  }));
}

function audioIdPath(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('无效的录音编号');
  return String(id);
}

async function startAnalysis(id) {
  const result = await observationRequest('/api/v1/audios/' + audioIdPath(id) + '/screenings', 'POST');
  if (!result || typeof result.taskId !== 'string' || !result.taskId) throw new Error('后端未返回任务编号');
  return result.taskId;
}

function fileSegment(name) {
  if (typeof name !== 'string' || !name || /[/\\]/.test(name) || name === '.' || name === '..') {
    throw new Error('后端未返回有效的文件名');
  }
  return encodeURIComponent(name);
}

async function removeAudio(name) {
  let result;
  try {
    result = await observationRequest('/audio/' + fileSegment(name), 'DELETE');
  } catch (error) {
    if (error.statusCode === 409) throw new Error('这段录音仍有正在处理的观察任务，请等任务结束后再删除。');
    throw error;
  }
  if (!result || result.deleted !== true) throw new Error('后端未确认删除');
}

async function withAudioExtension(filePath, extension, useFile) {
  // The transcription controller validates the multipart filename extension.
  let staged = '';
  try {
    if (!filePath.toLowerCase().endsWith('.' + extension)) {
      staged = wx.env.USER_DATA_PATH + '/chat-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + extension;
      await new Promise((resolve, reject) => wx.getFileSystemManager().copyFile({
        srcPath: filePath, destPath: staged, success: resolve, fail: () => reject(new Error('无法准备转写文件'))
      }));
    }
    return await useFile(staged || filePath);
  } finally {
    if (staged) wx.getFileSystemManager().unlink({ filePath: staged, fail() {} });
  }
}

async function transcribe({ path: filePath, format = 'wav' }, onTask, isCurrent) {
  return withAudioExtension(filePath, format, async (path) => {
    if (!isCurrent()) return '';
    const result = await request({
      path: '/assistant/speech/transcribe', auth: false, filePath: path, onTask, timeout: 120000
    });
    if (typeof result?.transcription !== 'string' || !result.transcription.trim())
      throw new Error('没有识别到语音，请重新录制');
    return result.transcription.trim();
  });
}

function synthesizeSpeech(text, onTask) {
  return request({
    path: '/assistant/voice/synthesize', auth: false, method: 'POST',
    data: { text }, responseType: 'arraybuffer', timeout: 120000, onTask
  }).then((audio) => {
    if (!(audio instanceof ArrayBuffer) || audio.byteLength < 100)
      throw new Error('朗读服务未返回有效音频');
    return audio;
  });
}

function downloadAudio(name, onTask) {
  return request({ path: '/audio/file/' + fileSegment(name), auth: 'required', download: true, onTask });
}

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

function register(username, password) {
  if (getSettings().mode === 'demo') {
    return Promise.reject(new Error('演示服务不能创建账号，请先连接真实服务'));
  }
  const name = String(username || '').trim();
  const secret = String(password || '');
  if (!name || name.length > 64) return Promise.reject(new Error('请填写 1–64 字的账号'));
  if (secret.length < 8 || secret.length > 64 || !secret.trim()) {
    return Promise.reject(new Error('注册密码需要 8–64 位'));
  }
  let byteLength = 0;
  for (const character of secret) {
    const code = character.codePointAt(0);
    byteLength += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  if (byteLength > 72) return Promise.reject(new Error('密码过长，请减少汉字或表情后重试'));
  return request({
    path: '/user/register',
    method: 'POST',
    auth: false,
    data: { username: name, password: secret }
  }).then((result) => {
    if (typeof result === 'string' && result.trim() === '注册成功') return { username: name };
    if (typeof result === 'string' && result.trim()) throw new Error(result.trim());
    throw new Error('服务器未确认注册成功，请稍后重试');
  });
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

module.exports = {
  checkConnection, getBackendStatus, chat, login, register, listRecords,
  transcribe, synthesizeSpeech, uploadObservation, listAudios, startAnalysis, removeAudio, downloadAudio
};
