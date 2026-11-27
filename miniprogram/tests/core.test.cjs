const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function setup(t, handler) {
  const previous = {
    wx: global.wx,
    Page: global.Page,
    Component: global.Component,
    getApp: global.getApp
  };
  const storage = new Map();
  const requests = [];
  const modals = [];
  const app = { globalData: { chat: null } };
  for (const filename of Object.keys(require.cache)) {
    if (filename.startsWith(root + path.sep) && filename !== __filename)
      delete require.cache[filename];
  }
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      requests.push(options);
      if (handler) handler(options);
    },
    showToast() {},
    showModal(options) {
      modals.push(options);
    },
    switchTab() {},
    stopPullDownRefresh() {}
  };
  global.getApp = () => app;
  t.after(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete global[key];
      else global[key] = previous[key];
    }
  });
  function load(name) {
    return require(path.join(root, name));
  }
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
  assert.throws(
    () => env.saveSettings({ apiBaseUrl: 'https://user:password@example.com' }),
    /有效/
  );
  assert.throws(() => env.saveSettings({ apiBaseUrl: 'javascript:alert(1)' }), /有效/);
  const saved = env.saveSettings({
    mode: 'live',
    apiBaseUrl: ' http://192.168.1.100:8080/ ',
    largeText: true
  });
  assert.equal(saved.apiBaseUrl, 'http://192.168.1.100:8080');
  assert.equal(env.getSettings().largeText, true);
});

test('native requests match backend paths and attach a valid persistent anonymous UUID', async (t) => {
  const state = setup(t, (options) =>
    options.success({ statusCode: 200, data: { answer: '真实接口返回' } })
  );
  state
    .load('config/env.js')
    .saveSettings({ mode: 'live', apiBaseUrl: 'http://192.168.1.100:8080' });
  const api = state.load('services/api.js');
  assert.equal((await api.chat('你好')).answer, '真实接口返回');
  const request = state.requests[0];
  assert.equal(request.url, 'http://192.168.1.100:8080/assistant/chat');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.data, { message: '你好' });
  assert.match(
    request.header['X-Assistant-Client-Id'],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.equal(
    state.load('services/session.js').getClientId(),
    request.header['X-Assistant-Client-Id']
  );
});

test('HTTP failures and network failures are surfaced without silently switching to demo', async (t) => {
  const state = setup(t, (options) =>
    options.success({ statusCode: 503, data: { message: '模型服务不可用' } })
  );
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
  const state = setup(t, (options) =>
    options.success({ statusCode: 200, data: 'header.payload.signature' })
  );
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
  const state = setup(t, (options) =>
    options.success({ statusCode: 200, data: '用户名或密码错误' })
  );
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
  state.requests
    .find((request) => request.url.endsWith('/assistant/chat'))
    .success({ statusCode: 200, data: { answer: '旧服务器的回答' } });
  await pending;
  assert.equal(page.data.sending, false);
  assert.equal(
    page.data.messages.some((item) => item.content.includes('旧服务器')),
    false
  );
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
  assert.equal(page.data.step, 0);
  assert.equal(page.data.signedIn, false);
  assert.equal(state.requests.length, 0);
});

test('live records require a real login instead of showing sample records', async (t) => {
  const state = setup(t);
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  await assert.rejects(state.load('services/api.js').listRecords(), /登录/);
  assert.equal(state.requests.length, 0);
});

test('a reply arriving while avatar chat is collapsed is preserved when reopened', async (t) => {
  const state = setup(t);
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  const page = state.page('companion');
  page.onShow();
  page.setData({ input: '今天想分享一件小事' });
  const pending = page.sendMessage();
  assert.equal(page.data.chatOpen, true);
  page.closeChat();
  state.requests
    .find((request) => request.url.endsWith('/assistant/chat'))
    .success({ statusCode: 200, data: { answer: '我在这里，您慢慢说。' } });
  await pending;
  assert.equal(page.data.chatOpen, false);
  page.openChat();
  assert.equal(page.data.messages.at(-1).content, '我在这里，您慢慢说。');
  assert.equal(page.data.connectionLabel, '服务已连接');
  assert.equal(page.data.sending, false);
  assert.equal(state.app.globalData.chat.messages.length, 3);
});

test('large text persists across tabs without saving unfinished connection edits', (t) => {
  const state = setup(t);
  const env = state.load('config/env.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://saved.example.com', largeText: false });
  const profile = state.page('profile');
  profile.onShow();
  profile.setData({ mode: 'demo', apiBaseUrl: 'unfinished address' });
  profile.onTextChange({ detail: { value: true } });
  assert.deepEqual(env.getSettings(), {
    mode: 'live',
    apiBaseUrl: 'https://saved.example.com',
    largeText: true
  });
  const companion = state.page('companion');
  companion.onShow();
  assert.equal(companion.data.largeText, true);
  assert.equal(state.requests.length, 1);
  assert.match(state.requests[0].url, /\/actuator\/health$/);
});

test('local deployment initializes devtools once and preserves an explicit later demo choice', (t) => {
  const state = setup(t);
  wx.getDeviceInfo = () => ({ platform: 'devtools' });
  const env = state.load('config/env.js');
  assert.equal(env.applyDeploymentDefaults(), true);
  assert.equal(env.getSettings().apiBaseUrl, 'http://127.0.0.1:8080');
  assert.equal(env.getSettings().mode, 'live');
  env.saveSettings({ mode: 'demo', apiBaseUrl: 'http://127.0.0.1:8080' });
  assert.equal(env.applyDeploymentDefaults(), false);
  assert.equal(env.getSettings().mode, 'demo');
});

test('a phone is never configured with the devtools loopback address', (t) => {
  const state = setup(t);
  state.load('config/deployment.js').deviceBaseUrl = '';
  wx.getDeviceInfo = () => ({ platform: 'ios' });
  const env = state.load('config/env.js');
  assert.equal(env.applyDeploymentDefaults(), false);
  assert.equal(env.getSettings().apiBaseUrl, '');
});

test('deployment bootstrap preserves an existing custom server', (t) => {
  const state = setup(t);
  state.load('config/deployment.js').forceLocal = false;
  wx.getDeviceInfo = () => ({ platform: 'devtools' });
  const env = state.load('config/env.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://existing.example.com', largeText: true });
  env.applyDeploymentDefaults();
  assert.deepEqual(env.getSettings(), {
    mode: 'live',
    apiBaseUrl: 'https://existing.example.com',
    largeText: true
  });
});

test('an explicit local deployment migrates an old server once while preserving reading preferences', (t) => {
  const state = setup(t);
  wx.getDeviceInfo = () => ({ platform: 'devtools' });
  state.load('config/deployment.js').forceLocal = true;
  const env = state.load('config/env.js');
  env.saveSettings({ mode: 'demo', apiBaseUrl: 'https://old.example.com', largeText: true });
  env.applyDeploymentDefaults();
  assert.deepEqual(env.getSettings(), {
    mode: 'live',
    apiBaseUrl: 'http://127.0.0.1:8080',
    largeText: true
  });
  env.saveSettings({ mode: 'demo', apiBaseUrl: 'http://127.0.0.1:8080', largeText: true });
  env.applyDeploymentDefaults();
  assert.equal(env.getSettings().mode, 'demo');
});

test('a health response alone cannot identify an unrelated backend as connected', async (t) => {
  const state = setup(t, (options) =>
    options.success({
      statusCode: 200,
      data: options.url.endsWith('/actuator/health')
        ? { status: 'UP' }
        : { service: 'another-backend' }
    })
  );
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  await assert.rejects(state.load('services/api.js').getBackendStatus(), /后端版本不匹配/);
});

test('a late connection check cannot replace the status of a newly selected backend', async (t) => {
  const state = setup(t);
  const env = state.load('config/env.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://old.example.com' });
  const page = state.page('companion');
  page.setData({ mode: 'live' });
  const oldCheck = page.refreshConnection();
  state.requests[0].success({ statusCode: 200, data: { status: 'UP' } });
  await new Promise((resolve) => setImmediate(resolve));
  const oldStatus = state.requests.find(
    (request) => request.url === 'https://old.example.com/assistant/status'
  );
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://new.example.com' });
  const newCheck = page.refreshConnection();
  state.requests
    .find((request) => request.url === 'https://new.example.com/actuator/health')
    .success({ statusCode: 200, data: { status: 'UP' } });
  await new Promise((resolve) => setImmediate(resolve));
  state.requests
    .find((request) => request.url === 'https://new.example.com/assistant/status')
    .success({ statusCode: 200, data: { service: 'yisheng-backend', modelConfigured: true } });
  await newCheck;
  oldStatus.success({
    statusCode: 200,
    data: { service: 'yisheng-backend', modelConfigured: false }
  });
  await oldCheck;
  assert.equal(page.data.connectionLabel, '服务已连接');
  assert.equal(page.data.modelConfigured, true);
});

test('keyboard geometry avoids subtracting a resized Android viewport twice', (t) => {
  const state = setup(t);
  const ui = state.load('utils/ui.js');
  assert.equal(ui.keyboardInset(300, 754, 754), 300);
  assert.equal(ui.keyboardInset(300, 754, 454), 0);
  assert.equal(ui.keyboardInset(300, 754, 554), 100);
  const page = state.page('companion');
  let bar;
  page.getTabBar = () => ({
    setData: (patch) => {
      bar = patch;
    }
  });
  page.onShow();
  page.onInputFocus({ detail: {} });
  page.onKeyboardHeight({ detail: { height: 300 } });
  assert.equal(bar.hidden, true);
  page.closeChat();
  assert.equal(bar.hidden, false);
  assert.equal(page.data.keyboardInset, 0);
});

test('keyboard blur restores the composer and tab even without a final height event', (t) => {
  const state = setup(t);
  const page = state.page('companion');
  const bar = { data: {}, setData(patch) { Object.assign(this.data, patch); } };
  page.getTabBar = () => bar;
  page.onShow();
  page.onInput({ detail: { value: '未发送的草稿' } });
  const messages = page.data.messages;
  for (let i = 0; i < 20; i++) {
    page.onInputFocus({ detail: { height: 300 } });
    page.onKeyboardHeight({ detail: { height: 300 } });
    assert.equal(page.data.keyboardInset, 300);
    assert.equal(bar.data.hidden, true);
    page.onInputBlur();
    assert.equal(page.data.keyboardInset, 0);
    assert.equal(bar.data.hidden, false);
    page.onKeyboardHeight({ detail: { height: 300 } });
    assert.equal(page.data.keyboardInset, 0);
  }
  assert.equal(page.data.chatOpen, true);
  assert.equal(page.data.input, '未发送的草稿');
  assert.equal(page.data.messages, messages);
});

test('global keyboard fallback handles system dismissal and is removed on tab hide', (t) => {
  const state = setup(t);
  const listeners = new Set();
  wx.onKeyboardHeightChange = (callback) => listeners.add(callback);
  wx.offKeyboardHeightChange = (callback) => listeners.delete(callback);
  const page = state.page('companion');
  page.onShow();
  page.onShow();
  assert.equal(listeners.size, 1);
  const [listener] = listeners;
  page.onInputFocus({ detail: {} });
  listener({ height: 280 });
  assert.equal(page.data.keyboardInset, 280);
  listener({ height: 0 });
  assert.equal(page.data.inputFocused, false);
  assert.equal(page.data.keyboardInset, 0);
  page.onHide();
  assert.equal(listeners.size, 0);
  listener({ height: 280 });
  assert.equal(page.data.keyboardInset, 0);
  page.onShow();
  page.onUnload();
  assert.equal(listeners.size, 0);
});

test('30 tab changes reuse verified connection and same-account records', async (t) => {
  const state = setup(t, (request) => {
    const result = request.url.endsWith('/assistant/status')
      ? { service: 'yisheng-backend', modelConfigured: true }
      : request.url.endsWith('/api/v1/screenings')
        ? [{ taskId: 'one', status: 'FINISHED' }]
        : { status: 'UP' };
    request.success({ statusCode: 200, data: result });
  });
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.test' });
  const sessions = state.load('services/session.js');
  sessions.saveSession('first', 'first.test.token');
  const companion = state.page('companion');
  const records = state.page('records');
  for (let i = 0; i < 15; i++) {
    companion.onShow();
    await companion.refreshConnection();
    assert.equal(companion.data.connection, 'connected');
    companion.onHide();
    records.onShow();
    await records.loadRecords(false);
    assert.equal(records.data.records.length, 1);
  }
  assert.equal(state.requests.filter((r) => r.url.endsWith('/assistant/status')).length, 1);
  assert.equal(state.requests.filter((r) => r.url.endsWith('/api/v1/screenings')).length, 1);
  await records.loadRecords();
  assert.equal(state.requests.filter((r) => r.url.endsWith('/api/v1/screenings')).length, 2);
  sessions.saveSession('other', 'other.test.token');
  records.onShow();
  assert.deepEqual(records.data.records, []);
  await records.loadRecords(false);
  assert.equal(state.requests.at(-1).header.Authorization, 'Bearer other.test.token');
});

test('demo chat never advertises a real connected service after replying', async (t) => {
  const state = setup(t),
    page = state.page('companion');
  page.onShow();
  page.setData({ input: '你好' });
  await page.sendMessage();
  assert.equal(page.data.connection, 'demo');
  assert.equal(page.data.connectionLabel, '演示模式');
  assert.equal(state.requests.length, 0);
});

test('records distinguish login, error, empty and report states without fabricating content', async (t) => {
  const state = setup(t),
    env = state.load('config/env.js'),
    page = state.page('records');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  page.onShow();
  await new Promise((r) => setImmediate(r));
  assert.equal(page.data.needsLogin, true);
  assert.equal(page.data.error, '');
  assert.equal(page.data.loading, false);
  assert.equal(state.requests.length, 0);
  state.load('services/session.js').saveSession('account', 'aaa.bbb.ccc');
  let pending = page.loadRecords();
  state.requests.at(-1).success({ statusCode: 503, data: { message: '稍后重试' } });
  await pending;
  assert.equal(page.data.needsLogin, false);
  assert.equal(page.data.error, '稍后重试');
  pending = page.loadRecords();
  state.requests.at(-1).success({ statusCode: 200, data: [] });
  await pending;
  assert.equal(page.data.error, '');
  assert.equal(page.data.records.length, 0);
  page.setData({
    records: [
      {
        id: 'r',
        title: '真实任务',
        report: '第一段\n\n' + '长报告。'.repeat(1000),
        displayTime: '2026-11-26 12:00'
      }
    ]
  });
  page.showRecord({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.reportVisible, true);
  assert.equal(page.data.selectedRecord.content.length, 4005);
  page.closeReport();
  assert.equal(page.data.selectedRecord, null);
});

test('backend statuses and requestedAt are displayed without invented metrics or dates', async (t) => {
  const state = setup(t, (o) =>
    o.success({
      statusCode: 200,
      data: [
        { taskId: 't', status: 'PDF_GENERATING', requestedAt: '2026-11-26T12:34:56', result: null }
      ]
    })
  );
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  state.load('services/session.js').saveSession('account', 'aaa.bbb.ccc');
  const raw = (await state.load('services/api.js').listRecords())[0];
  const present = state.load('utils/records.js').presentRecord(raw);
  assert.equal(present.status, 'PDF_GENERATING');
  assert.equal(present.statusLabel, '生成报告中');
  assert.equal(present.displayTime, '2026-11-26 12:34');
  assert.equal(present.report, '');
  const unknown = state.load('utils/records.js').presentRecord({ status: 'NEW_SERVER_STATUS' });
  assert.equal(unknown.statusLabel, 'NEW_SERVER_STATUS');
  assert.equal(unknown.displayTime, '');
});

test('logout requires confirmation and password visibility is reset at navigation', (t) => {
  const state = setup(t),
    env = state.load('config/env.js'),
    sessions = state.load('services/session.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  sessions.saveSession('real-account', 'aaa.bbb.ccc');
  const p = state.page('profile');
  p.onShow();
  p.signOut();
  assert.equal(p.data.logoutVisible, true);
  assert.equal(sessions.getSession().username, 'real-account');
  p.cancelSignOut();
  assert.equal(sessions.getSession().username, 'real-account');
  p.togglePassword();
  assert.equal(p.data.passwordVisible, true);
  p.onShow();
  assert.equal(p.data.passwordVisible, false);
  p.signOut();
  p.confirmSignOut();
  assert.equal(sessions.getSession(), null);
  assert.equal(p.data.loggedInUser, '');
});

test('custom navigation commits the selection only after a successful native switch', (t) => {
  const state = setup(t);
  let def;
  global.Component = (d) => {
    def = d;
  };
  state.load('custom-tab-bar/index.js');
  const bar = Object.assign(
    {
      data: JSON.parse(JSON.stringify(def.data)),
      setData(p) {
        Object.assign(this.data, p);
      }
    },
    def.methods
  );
  let attempt;
  wx.switchTab = (o) => {
    attempt = o;
  };
  bar.switchTab({ currentTarget: { dataset: { index: 99 } } });
  assert.equal(attempt, undefined);
  bar.switchTab({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(attempt.url, '/pages/records/index');
  assert.equal(bar.data.selected, 0);
  attempt.fail();
  attempt.complete();
  assert.equal(bar.data.selected, 0);
  bar.switchTab({ currentTarget: { dataset: { index: 2 } } });
  attempt.success();
  attempt.complete();
  assert.equal(bar.data.selected, 2);
});

test('the future digital renderer pauses on hide and disposes on replacement', (t) => {
  const state = setup(t);
  let def;
  global.Component = (d) => {
    def = d;
  };
  state.load('components/digital-human/index.js');
  const calls = [],
    viewport = Object.assign({ properties: { state: 'thinking' } }, def.methods);
  const renderer = {
    mount: () => calls.push('mount'),
    setState: (s) => calls.push(s),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    dispose: () => calls.push('dispose')
  };
  viewport.attachRenderer(renderer);
  def.pageLifetimes.hide.call(viewport);
  def.pageLifetimes.show.call(viewport);
  viewport.attachRenderer(null);
  assert.deepEqual(calls, ['mount', 'thinking', 'pause', 'resume', 'dispose']);
});

test('registration validates locally and demo mode never creates an account', async (t) => {
  const state = setup(t),
    api = state.load('services/api.js');
  await assert.rejects(api.register('new-user', 'a-password'), /演示/);
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  await assert.rejects(api.register('', 'a-password'), /账号/);
  await assert.rejects(api.register('a'.repeat(65), 'a-password'), /账号/);
  await assert.rejects(api.register('new-user', 'short'), /8–64/);
  await assert.rejects(api.register('new-user', '密'.repeat(25)), /密码过长/);
  assert.equal(state.requests.length, 0);
});

test('registration uses the existing public endpoint and never saves a registration response as a token', async (t) => {
  const state = setup(t, (o) => o.success({ statusCode: 200, data: '注册成功' }));
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  const result = await state.load('services/api.js').register(' new-user ', 'a-password');
  assert.equal(state.requests[0].url, 'https://example.com/user/register');
  assert.equal(state.requests[0].method, 'POST');
  assert.deepEqual(state.requests[0].data, { username: 'new-user', password: 'a-password' });
  assert.equal(state.requests[0].header.Authorization, undefined);
  assert.deepEqual(result, { username: 'new-user' });
  assert.equal(state.load('services/session.js').getSession(), null);
  assert.equal(JSON.stringify([...state.storage.values()]).includes('a-password'), false);
});

test('HTTP 200 registration failures are not displayed as success', async (t) => {
  const state = setup(t, (o) => o.success({ statusCode: 200, data: '用户名已存在' }));
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  const api = state.load('services/api.js');
  await assert.rejects(api.register('existing', 'a-password'), /用户名已存在/);
  wx.request = (o) => o.success({ statusCode: 200, data: { unexpected: true } });
  await assert.rejects(api.register('new-user', 'a-password'), /未确认注册成功/);
});

test('registration confirmation gates the request and successful registration clears both secrets', async (t) => {
  const state = setup(t, (o) => o.success({ statusCode: 200, data: '注册成功' }));
  const env = state.load('config/env.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://example.com' });
  const p = state.page('profile');
  p.onShow();
  p.onAuthMode({ currentTarget: { dataset: { mode: 'register' } } });
  p.setData({ username: 'new-user', password: 'a-password', confirmPassword: 'different' });
  await p.submitAuth();
  assert.equal(state.requests.length, 0);
  assert.match(p.data.status, /不一致/);
  p.setData({ confirmPassword: 'a-password' });
  await p.submitAuth();
  assert.equal(state.requests[0].data.password, 'a-password');
  assert.equal(p.data.password, '');
  assert.equal(p.data.confirmPassword, '');
  assert.equal(p.data.authMode, 'login');
  assert.equal(p.data.loggedInUser, '');
  assert.match(p.data.status, /注册成功/);
  assert.equal(p.data.statusArea, 'auth');
  assert.equal(JSON.stringify([...state.storage.values()]).includes('a-password'), false);
});

test('account controls remain reachable in demo mode and switching forms clears secrets', (t) => {
  const state = setup(t),
    p = state.page('profile');
  p.onShow();
  p.toggleLogin();
  assert.equal(p.data.loginExpanded, true);
  p.setData({ password: 'not-persisted', confirmPassword: 'not-persisted', passwordVisible: true });
  p.onAuthMode({ currentTarget: { dataset: { mode: 'register' } } });
  assert.equal(p.data.password, '');
  assert.equal(p.data.confirmPassword, '');
  assert.equal(p.data.passwordVisible, false);
});

test('late account or connection responses do not replace a newly selected environment', async (t) => {
  const state = setup(t),
    env = state.load('config/env.js');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://old.example.com' });
  const p = state.page('profile');
  p.onShow();
  p.setData({ username: 'old-account', password: 'a-password' });
  const pending = p.signIn();
  env.saveSettings({ mode: 'live', apiBaseUrl: 'https://new.example.com' });
  p.onShow();
  state.requests[0].success({ statusCode: 200, data: 'aaa.bbb.ccc' });
  await pending;
  assert.equal(p.data.loggedInUser, '');
  assert.equal(p.data.busy, false);
  assert.equal(p.data.apiBaseUrl, 'https://new.example.com');
  assert.equal(state.load('services/session.js').getSession('https://new.example.com'), null);
});

test('a real phone refuses loopback without making a doomed request', async (t) => {
  const state = setup(t);
  wx.getDeviceInfo = () => ({ platform: 'ios' });
  state.load('config/env.js').saveSettings({ mode: 'live', apiBaseUrl: 'http://127.0.0.1:8080' });
  await assert.rejects(
    state.load('services/api.js').getBackendStatus(),
    (e) => e.code === 'DEVICE_LOOPBACK' && /手机自身/.test(e.message)
  );
  assert.equal(state.requests.length, 0);
});

test('WeChat domain, TLS and network failures produce distinct actionable messages', async (t) => {
  const state = setup(t);
  state
    .load('config/env.js')
    .saveSettings({ mode: 'live', apiBaseUrl: 'http://192.168.1.10:8080' });
  const api = state.load('services/api.js');
  for (const [native, code] of [
    ['request:fail url not in domain list', 'DOMAIN_NOT_ALLOWED'],
    ['request:fail ssl certificate error', 'TLS_ERROR'],
    ['request:fail timeout', 'NETWORK_TIMEOUT']
  ]) {
    wx.request = (o) => o.fail({ errMsg: native });
    await assert.rejects(
      api.getBackendStatus(),
      (e) => e.code === code && e.nativeMessage === native
    );
  }
});

test('local address action preserves preferences and the diagnostic copy uses the selected server', async (t) => {
  const state = setup(t, (o) =>
    o.success({
      statusCode: 200,
      data: o.url.endsWith('/actuator/health')
        ? { status: 'UP' }
        : { service: 'yisheng-backend', modelConfigured: true }
    })
  );
  state.load('config/deployment.js').deviceBaseUrl = 'http://192.168.1.10:8080';
  state.load('config/env.js').saveSettings({ mode: 'demo', largeText: true });
  const p = state.page('profile');
  p.onShow();
  await p.useDeviceAddress();
  assert.equal(p.data.connectionTestLabel, '连接成功');
  assert.equal(state.load('config/env.js').getSettings().largeText, true);
  let copied;
  wx.setClipboardData = (o) => {
    copied = o.data;
    o.success();
  };
  p.copyHealthUrl();
  assert.equal(copied, 'http://192.168.1.10:8080/actuator/health');
});

function voiceSetup(t) {
  const state = setup(t);
  const callbacks = {},
    uploads = [],
    removed = [];
  state
    .load("config/env")
    .saveSettings({ mode: "live", apiBaseUrl: "http://192.168.1.2:8080" });
  const recorder = {
    start(options) {
      assert.equal(options.format, "wav");
      assert.equal(options.sampleRate, 16000);
      callbacks.Start();
    },
    stop() {},
    onInterruptionBegin(fn) { callbacks.Interrupt = fn; },
    onStart(fn) {
      callbacks.Start = fn;
    },
    onStop(fn) {
      callbacks.Stop = fn;
    },
    onError(fn) {
      callbacks.Error = fn;
    },
  };
  const wav = (length, broken = false) => {
    const buffer = Buffer.alloc(44 + length);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(buffer.length - 8 + (broken ? 44 : 0), 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24);
    buffer.writeUInt32LE(32000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(broken ? buffer.length : length, 40);
    return Uint8Array.from(buffer).buffer;
  };
  const fs = {
    unlink(o) { removed.push(o.filePath); },
    readFile(o) {
      o.success({ data: wav(o.filePath.includes('short') ? 3200 : 64000, o.filePath.includes('broken')) });
    }
  };
  Object.assign(global.wx, {
    showModal(o) { o.success({ confirm: true }); },
    authorize(o) {
      o.success();
    },
    getRecorderManager() {
      return recorder;
    },
    getFileSystemManager() { return fs; },
    uploadFile(o) {
      uploads.push(o);
      return { abort() {} };
    },
  });
  const updates = [];
  const voice = new (state.load("services/voice").VoiceSession)((p) =>
    updates.push(p),
  );
  t.after(() => voice.cancel());
  return { state, voice, callbacks, uploads, removed, updates, fs };
}
test("voice cancellation prevents upload and waits for native stop before restarting", async (t) => {
  const { voice, callbacks, uploads, removed } = voiceSetup(t);
  await voice.start(() => assert.fail("cancelled text"));
  voice.cancel();
  assert.equal(require("../services/recorder").isBusy(), true);
  callbacks.Stop({ tempFilePath: "/tmp/cancelled.wav", duration: 2000 });
  assert.equal(require("../services/recorder").isBusy(), false);
  assert.equal(uploads.length, 0);
  assert.deepEqual(removed, ["/tmp/cancelled.wav"]);
});
test("recorded speech becomes an editable draft, with no automatic chat submission", async (t) => {
  const { voice, callbacks, uploads, removed } = voiceSetup(t);
  let draft = "";
  await voice.start((t) => (draft = t));
  const completed = callbacks.Stop({
    tempFilePath: "/tmp/speech.wav",
    duration: 2000,
  });
  await new Promise(setImmediate);
  assert.equal(uploads[0].name, "file");
  uploads[0].success({
    statusCode: 200,
    data: JSON.stringify({ transcription: "今天心情很好" }),
  });
  await completed;
  assert.equal(draft, "今天心情很好");
  assert.equal(voice.state, "idle");
  assert.deepEqual(removed, ["/tmp/speech.wav"]);
});
test("a late transcription cannot cross a backend environment change", async (t) => {
  const { state, voice, callbacks, uploads } = voiceSetup(t);
  let delivered = false;
  await voice.start(() => (delivered = true));
  const completed = callbacks.Stop({
    tempFilePath: "/tmp/speech.wav",
    duration: 2000,
  });
  await new Promise(setImmediate);
  state
    .load("config/env")
    .saveSettings({ mode: "live", apiBaseUrl: "http://192.168.1.3:8080" });
  voice.cancel();
  uploads[0].success({
    statusCode: 200,
    data: JSON.stringify({ transcription: "旧环境" }),
  });
  await completed;
  assert.equal(delivered, false);
});
test("short or empty recordings are deleted without upload", async (t) => {
  const { voice, callbacks, uploads, removed } = voiceSetup(t);
  await voice.start(() => assert.fail());
  await callbacks.Stop({ tempFilePath: "/tmp/short.wav", duration: 100 });
  assert.equal(uploads.length, 0);
  assert.equal(voice.state, "idle");
  assert.equal(removed.length, 1);
});
test('repairs the known 44-byte device WAV length error before upload', async (t) => {
  const { voice, callbacks, uploads, removed, fs } = voiceSetup(t);
  global.wx.env = { USER_DATA_PATH: '/data' };
  fs.writeFile = (options) => {
    const header = new DataView(options.data);
    assert.equal(header.getUint32(4, true), 64036);
    assert.equal(header.getUint32(40, true), 64000);
    options.success();
  };
  await voice.start(() => {});
  const completed = callbacks.Stop({ tempFilePath: '/tmp/broken.wav' });
  await new Promise(setImmediate);
  assert.match(uploads[0].filePath, /^\/data\/recording-.*\.wav$/);
  uploads[0].success({ statusCode: 200, data: '{"transcription":"已修复"}' });
  await completed;
  assert.deepEqual(removed, ['/tmp/broken.wav', uploads[0].filePath]);
});

test('interruption discards the recording and permits a subsequent recording', async (t) => {
  const { voice, callbacks, uploads } = voiceSetup(t);
  await voice.start(() => assert.fail('interrupted audio was delivered'));
  callbacks.Interrupt();
  await callbacks.Stop({ tempFilePath: '/tmp/interrupted.wav' });
  assert.equal(uploads.length, 0);
  await voice.start(() => {});
  assert.equal(voice.state, 'recording');
});

test('developer tools WebM is renamed for chat and rejected for observation', async (t) => {
  const { voice, callbacks, uploads, fs, state } = voiceSetup(t);
  global.wx.getDeviceInfo = () => ({ platform: 'devtools' });
  global.wx.env = { USER_DATA_PATH: '/data' };
  fs.readFile = (options) => options.success({ data: Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3).buffer });
  fs.copyFile = (options) => options.success();
  const result = { tempFilePath: '/tmp/devtools.wav', duration: 2000 };
  await assert.rejects(state.load('services/recorder').inspectRecording(result), /手机真机/);
  await voice.start(() => {});
  const completed = callbacks.Stop(result);
  await new Promise(setImmediate);
  assert.match(uploads[0].filePath, /[.]webm$/);
  uploads[0].success({ statusCode: 200, data: '{"transcription":"测试"}' });
  await completed;
});

test('microphone permission rejection returns the voice flow to idle', async (t) => {
  const { voice, uploads } = voiceSetup(t);
  const prompts = [];
  global.wx.showModal = (options) => { prompts.push(options); options.success({ confirm: true }); };
  global.wx.authorize = (options) => options.fail({});
  let settingsOpened = 0;
  global.wx.openSetting = () => { settingsOpened++; };
  await voice.start(() => assert.fail('permission was denied'));
  assert.equal(voice.state, 'idle');
  assert.equal(uploads.length, 0);
  assert.equal(settingsOpened, 1);
  assert.equal(prompts[1].confirmText, '打开设置');
});

test("demo voice never asks for microphone permission", async (t) => {
  const { state, voice } = voiceSetup(t);
  state.load("config/env").saveSettings({ mode: "demo" });
  global.wx.authorize = () => assert.fail("microphone requested in demo");
  await assert.rejects(
    voice.start(() => {}),
    /真实服务/,
  );
});

test("cancelled speech synthesis cannot create or play an audio file", async (t) => {
  const { voice } = voiceSetup(t);
  let response,
    aborted = false;
  global.wx.request = (o) => {
    response = o;
    return {
      abort() {
        aborted = true;
      },
    };
  };
  global.wx.getFileSystemManager = () =>
    assert.fail("cancelled TTS wrote a file");
  const pending = voice.speak("你好");
  voice.cancel();
  response.success({ statusCode: 200, data: new ArrayBuffer(200) });
  await pending;
  assert.equal(aborted, true);
  assert.equal(voice.state, "idle");
});

function speakingPage(t) {
  const state = setup(t);
  const env = state.load('config/env');
  env.saveSettings({ mode: 'live', apiBaseUrl: 'http://192.168.1.2:8080' });
  const page = state.page('companion'), spoken = [];
  page.setData({ mode: 'live', input: '你好' });
  page._voice = {
    state: 'idle', cancelled: 0,
    cancel() {
      this.cancelled++; this.state = 'idle'; page.setData({ voiceState: 'idle', speakingId: '' });
    },
    async speak(text) {
      assert.equal(page.data.sending, false, 'text reply completes before speech begins');
      spoken.push(text); this.state = 'synthesizing'; page.setData({ voiceState: 'synthesizing' });
    }
  };
  function reply(answer = '你好，今天过得怎么样？') {
    const request = state.requests.findLast(r => r.url.endsWith('/assistant/chat'));
    request.success({ statusCode: 200, data: { answer } });
  }
  return { ...state, page, spoken, env, reply };
}

test('a new live reply is presented and automatically read exactly once', async t => {
  const s = speakingPage(t), pending = s.page.sendMessage();
  s.reply(); await pending;
  assert.equal(s.spoken.length, 1);
  assert.equal(s.spoken[0], s.page.data.messages.at(-1).content);
  assert.equal(s.page.data.speakingId, s.page.data.messages.at(-1).id);
});

test('automatic reading can be disabled persistently without changing backend settings', async t => {
  const s = speakingPage(t), before = s.env.getSettings();
  s.page.onAutoReadChange({ detail: { value: false } });
  assert.equal(s.load('config/voice').getAutoRead(), false);
  assert.deepEqual(s.env.getSettings(), before);
  const pending = s.page.sendMessage(); s.reply(); await pending;
  assert.equal(s.spoken.length, 0);
  s.page.refreshConnection = () => Promise.resolve(); s.page.onShow();
  assert.equal(s.page.data.autoRead, false);
});

test('hiding the page or changing backend prevents late replies from speaking', async t => {
  const s = speakingPage(t), pending = s.page.sendMessage();
  s.page.onHide(); s.reply(); await pending;
  assert.equal(s.spoken.length, 0);
  s.page.setData({ pageActive: true, input: '另一条消息' });
  const next = s.page.sendMessage();
  s.env.saveSettings({ mode: 'live', apiBaseUrl: 'http://other.example' });
  s.reply('旧服务器的回复'); await next;
  assert.equal(s.spoken.length, 0);
});

test('a reply after the user collapses chat remains visible on reopen without starting speech', async t => {
  const s = speakingPage(t), pending = s.page.sendMessage();
  s.page.closeChat(); s.reply('已保存的文字回复'); await pending;
  assert.equal(s.spoken.length, 0);
  s.page.openChat(); assert.equal(s.spoken.length, 0);
  assert.equal(s.page.data.messages.at(-1).content, '已保存的文字回复');
});

test('demo replies and request failures are not automatically read', async t => {
  const s = speakingPage(t);
  s.env.saveSettings({ mode: 'demo' }); s.page.setData({ mode: 'demo' });
  await s.page.sendMessage(); assert.equal(s.spoken.length, 0);
  s.env.saveSettings({ mode: 'live', apiBaseUrl: 'http://192.168.1.2:8080' });
  s.page.setData({ mode: 'live', input: '再试一次' });
  const pending = s.page.sendMessage();
  s.requests.at(-1).success({ statusCode: 503, data: { message: '服务暂不可用' } });
  await pending; assert.equal(s.spoken.length, 0); assert.equal(s.page.data.messages.at(-1).error, true);
});

test('the read button stops active speech and a new message interrupts synthesis', async t => {
  const s = speakingPage(t), pending = s.page.sendMessage(); s.reply(); await pending;
  const message = s.page.data.messages.at(-1);
  s.page.onSpeak({ detail: { id: message.id } });
  assert.equal(s.page.data.voiceState, 'idle'); assert.equal(s.page.data.speakingId, '');
  s.page.onSpeak({ detail: { id: message.id } });
  assert.equal(s.page.data.voiceState, 'synthesizing');
  const cancelled = s.page._voice.cancelled;
  s.page.setData({ input: '先聊聊别的' });
  const next = s.page.sendMessage();
  assert.equal(s.page._voice.cancelled, cancelled + 1);
  s.reply('好的'); await next; assert.equal(s.spoken.at(-1), '好的');
  s.page.onAutoReadChange({ detail: { value: false } });
  assert.equal(s.page.data.voiceState, 'idle');
});

test('speech failure preserves the successful text reply', async t => {
  const s = speakingPage(t);
  s.page._voice.speak = () => Promise.reject(new Error('朗读服务暂不可用'));
  const pending = s.page.sendMessage(); s.reply('这段文字应当保留'); await pending; await Promise.resolve();
  assert.equal(s.page.data.messages.at(-1).content, '这段文字应当保留');
  assert.equal(s.page.data.messages.at(-1).error, undefined);
  assert.equal(s.page.data.sending, false);
});

test('successful synthesis plays consecutive chunks and removes both temporary files', async t => {
  const { voice, removed } = voiceSetup(t), callbacks = {};
  global.wx.env = { USER_DATA_PATH: '/tmp' };
  let written = 0, played = 0, destroyed = 0;
  global.wx.getFileSystemManager = () => ({
    writeFile(o) { written += o.data.byteLength; o.success(); },
    unlink(o) { removed.push(o.filePath); }
  });
  global.wx.createInnerAudioContext = () => ({
    onPlay(fn) { callbacks.play = fn; }, onEnded(fn) { callbacks.ended = fn; },
    onError(fn) { callbacks.error = fn; },
    play() { played++; callbacks.play(); }, stop() {}, destroy() { destroyed++; }
  });
  const chunks = [];
  global.wx.request = o => {
    chunks.push(o.data.text);
    o.success({ statusCode: 200, data: new ArrayBuffer(200) }); return { abort() {} };
  };
  const text = '你'.repeat(700) + '好';
  await voice.speak(text);
  assert.equal(written, 200); assert.equal(played, 1); assert.equal(voice.state, 'playing');
  callbacks.ended();
  await new Promise(setImmediate);
  assert.deepEqual(chunks, [text.slice(0, 700), '好']);
  assert.equal(voice.state, 'playing');
  assert.equal(played, 2);
  callbacks.ended();
  assert.equal(voice.state, 'idle'); assert.equal(destroyed, 2); assert.equal(removed.length, 2);
});
