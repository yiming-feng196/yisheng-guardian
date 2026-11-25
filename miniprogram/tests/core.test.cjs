const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function setup(t, handler) {
  const previous = { wx: global.wx, Page: global.Page, getApp: global.getApp };
  const storage = new Map();
  const requests = [];
  const modals = [];
  const app = { globalData: { chat: null } };
  for (const filename of Object.keys(require.cache)) {
    if (filename.startsWith(root + path.sep) && filename !== __filename) delete require.cache[filename];
  }
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) { requests.push(options); if (handler) handler(options); },
    showToast() {},
    showModal(options) { modals.push(options); },
    switchTab() {},
    stopPullDownRefresh() {}
  };
  global.getApp = () => app;
  t.after(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete global[key]; else global[key] = previous[key];
    }
  });
  function load(name) { return require(path.join(root, name)); }
  function page(name) {
    let page;
    global.Page = (definition) => {
      page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
      page.setData = (patch) => Object.assign(page.data, patch);
    };
    load('pages/' + name + '/index.js');
    return page;
  }
  return { storage, requests, modals, load, page, app };
}

test('demo mode makes no implicit network requests and never calls mock replies AI answers', async (t) => {
  const state = setup(t);
  const api = state.load('services/api.js');
  const result = await api.chat('你好');
  assert.match(result.answer, /界面演示回复/);
  assert.equal((await api.listRecords())[0].status, '演示数据');
  await assert.rejects(api.login('someone', 'a-password'), /演示模式/);
  assert.equal(state.requests.length, 0);
});

test('live mode requires a valid backend and refuses invalid or credential-bearing URLs', (t) => {
  const state = setup(t);
  const env = state.load('config/env.js');
  assert.throws(() => env.saveSettings({ mode: 'live' }), /后端地址/);
  assert.throws(() => env.saveSettings({ apiBaseUrl: 'https://user:password@example.com' }), /有效/);
  assert.throws(() => env.saveSettings({ apiBaseUrl: 'javascript:alert(1)' }), /有效/);
  const saved = env.saveSettings({ mode: 'live', apiBaseUrl: ' http://192.168.1.100:8080/ ', largeText: true });
  assert.equal(saved.apiBaseUrl, 'http://192.168.1.100:8080');
  assert.equal(env.getSettings().largeText, true);
});

test('native requests match backend paths and attach a valid persistent anonymous UUID', async (t) => {
  const state = setup(t, (options) => options.success({ statusCode: 200, data: { answer: '真实接口返回' } }));
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'http://192.168.1.100:8080' });
  const api = state.load('services/api.js');
  assert.equal((await api.chat('你好')).answer, '真实接口返回');
  const request = state.requests[0];
  assert.equal(request.url, 'http://192.168.1.100:8080/assistant/chat');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.data, { message: '你好' });
  assert.match(request.header['X-Assistant-Client-Id'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(state.load('services/session.js').getClientId(), request.header['X-Assistant-Client-Id']);
});

test('HTTP failures and network failures are surfaced without silently switching to demo', async (t) => {
  const state = setup(t, (options) => options.success({ statusCode: 503, data: { message: '模型服务不可用' } }));
  const env = state.load('config/env.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  const api = state.load('services/api.js');
  await assert.rejects(api.chat('你好'), /模型服务不可用/);
  wx.request = (options) => options.fail({ errMsg: 'request:fail timeout' });
  await assert.rejects(api.chat('你好'), /请求超时/);
  assert.equal(env.getSettings().mode, 'live');
});

test('a late 401 only clears the token for its original backend', async (t) => {
  const state = setup(t);
  const env = state.load('config/env.js');
  const sessions = state.load('services/session.js');
  const backendA = 'https://a.example.com';
  const backendB = 'https://b.example.com';
  env.saveSettings({ mode: 'live', apiBaseUrl: backendA });
  sessions.saveSession('user-a', 'aaa.bbb.ccc', backendA);
  sessions.saveSession('user-b', 'ddd.eee.fff', backendB);
  const pending = state.load('services/request.js').request({ path: '/api/v1/screenings' });
  assert.equal(state.requests[0].header.Authorization, 'Bearer aaa.bbb.ccc');
  env.saveSettings({ mode: 'live', apiBaseUrl: backendB });
  state.requests[0].success({ statusCode: 401, data: { message: '登录已过期' } });
  await assert.rejects(pending, /登录已过期/);
  assert.equal(sessions.getSession(backendA), null);
  assert.equal(sessions.getSession(backendB).username, 'user-b');
});

test('profile login sends the typed password, persists only the session and clears the input', async (t) => {
  const state = setup(t, (options) => options.success({ statusCode: 200, data: 'header.payload.signature' }));
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  const page = state.page('profile');
  page.onShow();
  page.setData({ username: 'demo-user', password: 'test-password-123' });
  await page.signIn();
  assert.equal(state.requests[0].url, 'https://example.com/user/login');
  assert.equal(state.requests[0].data.password, 'test-password-123');
  assert.equal(page.data.loggedInUser, 'demo-user');
  assert.equal(page.data.password, '');
  assert.equal(JSON.stringify([...state.storage.values()]).includes('test-password-123'), false);
});

test('a plain-text login failure is not persisted as a token', async (t) => {
  const state = setup(t, (options) => options.success({ statusCode: 200, data: '用户名或密码错误' }));
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  await assert.rejects(state.load('services/api.js').login('someone', 'wrong'), /用户名或密码错误/);
  assert.equal(state.load('services/session.js').getSession(), null);
});

test('an old chat response cannot overwrite a new environment', async (t) => {
  const state = setup(t);
  const env = state.load('config/env.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://a.example.com' });
  const page = state.page('companion');
  page.onShow();
  page.setData({ input: '你好' });
  const pending = page.sendMessage();
  assert.equal(page.data.sending, true);
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://b.example.com' });
  page.onShow();
  state.requests[0].success({ statusCode: 200, data: { answer: '旧服务器的回答' } });
  await pending;
  assert.equal(page.data.sending, false);
  assert.equal(page.data.messages.some((item) => item.content.includes('旧服务器')), false);
});

test('the observation example never submits a fake recording or creates a real task', (t) => {
  const state = setup(t);
  const page = state.page('observation');
  page.onShow();
  page.nextStep();
  assert.equal(page.data.step, 0);
  page.onConsentChange({ detail: { value: ['consent'] } });
  page.nextStep();
  page.nextStep();
  assert.equal(page.data.step, 1);
  page.prepareSample();
  page.nextStep();
  page.nextStep();
  assert.equal(page.data.step, 3);
  assert.equal(state.requests.length, 0);
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  page.onShow();
  page.onConsentChange({ detail: { value: ['consent'] } });
  page.nextStep();
  page.prepareSample();
  assert.equal(page.data.sampleReady, false);
  assert.equal(state.modals.length, 1);
  assert.equal(state.requests.length, 0);
});

test('live records require a real login instead of showing sample records', async (t) => {
  const state = setup(t);
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  await assert.rejects(state.load('services/api.js').listRecords(), /登录/);
  assert.equal(state.requests.length, 0);
});
