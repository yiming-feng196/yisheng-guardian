// Development-only native smoke test. Requires miniprogram-automator and an IDE automation port.
// Runs a real model request if no previous real conversation exists. Restores user settings.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const out = path.resolve(process.env.UI_QA_OUTPUT || 'ui-qa');
fs.mkdirSync(out, { recursive: true });
const report = {
  runtime: 'WeChat DevTools 2.02.2609250 / native mini-program / iPhone 16 simulator',
  project: path.resolve(__dirname, '..'),
  checks: [],
  screens: [],
  errors: []
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mp = await automator.connect({
    wsEndpoint: process.env.WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420'
  });
  await delay(2000);
  await mp.callWxMethod('reLaunch', { url: '/pages/companion/index' });
  await delay(1500);
  const original = await mp.evaluate(() => wx.getStorageSync('yisheng.mp.settings.v1') || null);
  mp.on('exception', (e) => report.errors.push(String(e.message || e.text || JSON.stringify(e))));
  async function current() {
    await delay(500);
    return mp.currentPage();
  }
  async function route(name) {
    await mp.callWxMethod('switchTab', { url: '/pages/' + name + '/index' });
    const p = await current();
    assert.equal(p.path, 'pages/' + name + '/index');
    return p;
  }
  async function data() {
    return mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return p.data;
    });
  }
  async function wait(predicate, label, limit = 20000) {
    const start = Date.now();
    while (Date.now() - start < limit) {
      const d = await data();
      if (predicate(d)) return d;
      await delay(200);
    }
    throw Error('Timed out: ' + label);
  }
  async function snap(name) {
    await delay(350);
    const file = 'native-' + name + '.png';
    await mp.screenshot({ path: path.join(out, file) });
    report.screens.push(file);
    console.log('Saved', file);
  }
  async function call(name, ...args) {
    return mp.evaluate(
      (method, params) => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        return p[method].apply(p, params);
      },
      name,
      args
    );
  }
  function check(name, detail) {
    report.checks.push({ name, passed: true, ...detail });
    console.log('PASS', name);
  }
  try {
    await route('companion');
    await wait((d) => d.connection !== 'checking', 'live connection');
    assert.equal((await data()).connection, 'connected');
    await snap('companion');
    const p = await mp.currentPage(),
      panel = await p.$('#chat-panel');
    assert(panel, 'chat component is mounted');
    const before = await data();
    if (before.messages.length < 3) {
      const input = await panel.$('.composer-input');
      await input.input('今天阳光很好，请用一句温暖的话和我打个招呼。');
      await wait((d) => !!d.input, 'input binding');
      const send = await panel.$('.send-button');
      await send.tap();
    } else {
      await call('openChat');
    }
    const reply = await wait((d) => !d.sending && d.messages.length >= 3, 'real chat');
    assert.equal(reply.messages.at(-1).role, 'assistant');
    assert(!reply.messages.at(-1).error);
    assert(!reply.messages.at(-1).content.includes('界面演示回复'));
    check('native text input → Spring Boot → real model reply', {
      answerCharacters: reply.messages.at(-1).content.length
    });
    await snap('companion-chat');
    await (await panel.$('.chat-handle')).tap();
    await wait((d) => !d.chatOpen, 'collapse chat');
    await call('openChat');
    assert.equal((await data()).messages.length, reply.messages.length);
    check('collapse and reopen preserves conversation');
    await call('onInputFocus', { detail: { height: 300 } });
    await call('onKeyboardHeight', { detail: { height: 300 } });
    const keyboard = await data();
    assert.equal(keyboard.keyboardInset, 300);
    const hidden = await mp.evaluate(() => getCurrentPages().at(-1).getTabBar().data.hidden);
    assert.equal(hidden, true);
    await snap('companion-keyboard-layout');
    check('synthetic 300px keyboard inset hides navigation', { synthetic: true });
    await call('onInputBlur');
    assert.equal((await data()).keyboardInset, 0);
    assert.equal(await mp.evaluate(() => getCurrentPages().at(-1).getTabBar().data.hidden), false);
    check('blur restores the layout without a final height event', { synthetic: true });
    await call('closeChat');
    const observationPage = await route('observation');
    const startButton = await observationPage.$('.btn-primary'),
      startSize = await startButton.size(),
      startOffset = await startButton.offset(),
      startInfo = await mp.systemInfo(),
      observationData = await data();
    assert(Number(startSize.width) >= startInfo.windowWidth - 96);
    assert(Number(startSize.height) >= 44);
    assert(
      Number(startOffset.top) + Number(startSize.height) <=
        startInfo.windowHeight - observationData.navSpace + 8
    );
    check('observation primary action fits above floating navigation', {
      width: Number(startSize.width),
      bottom: Number(startOffset.top) + Number(startSize.height)
    });
    await snap('observation');
    await call('nextStep');
    assert.equal((await data()).step, 0);
    await call('onConsentChange', { detail: { value: ['consent'] } });
    await call('nextStep');
    await call('prepareSample');
    assert.equal((await data()).sampleReady, false);
    assert.equal((await data()).noticeVisible, true);
    await call('closeNotice');
    check('live observation refuses fake recording or upload');
    await route('records');
    assert.equal((await data()).needsLogin, true);
    await snap('records');
    await call('openProfile');
    await current();
    assert.equal((await data()).loginExpanded, true);
    check('records login action opens the real account form');
    await call('toggleLogin');
    await snap('profile');
    await call('testConnection');
    await wait((d) => !d.busy, 'connection test');
    assert.equal((await data()).connectionTestLabel, '连接成功');
    check('native backend health and model status connection test');
    await call('showAbout');
    await snap('profile-about');
    await call('closeAbout');
    await call('onTextChange', { detail: { value: true } });
    await route('companion');
    assert.equal((await data()).largeText, true);
    await snap('companion-large');
    await route('profile');
    assert.equal((await data()).largeText, true);
    await snap('profile-large');
    check('large text persists between native pages');
    await call('onTextChange', { detail: { value: false } });
    await call('onModeSelect', { currentTarget: { dataset: { mode: 'demo' } } });
    await call('saveConfig');
    await route('records');
    await wait((d) => !d.loading, 'demo records');
    assert.equal((await data()).records.length, 2);
    const recordPage = await mp.currentPage(),
      card = await recordPage.$('.record-card'),
      cardSize = await card.size(),
      device = await mp.systemInfo();
    assert(Number(cardSize.width) >= device.windowWidth - 48);
    check('record cards fill the native content width', { width: Number(cardSize.width) });
    await snap('records-demo');
    await call('showRecord', { currentTarget: { dataset: { index: 0 } } });
    assert.equal((await data()).reportVisible, true);
    await snap('records-report');
    await call('closeReport');
    check('glass report sheet displays labelled demo content');
    await route('observation');
    await call('onConsentChange', { detail: { value: ['consent'] } });
    await mp.pageScrollTo(180);
    await snap('observation-consent');
    await call('nextStep');
    await call('prepareSample');
    assert.equal((await data()).sampleReady, true);
    await mp.pageScrollTo(0);
    await snap('observation-picture');
    await call('nextStep');
    assert.equal((await data()).step, 2);
    await snap('observation-confirm');
    await call('nextStep');
    assert.equal((await data()).step, 3);
    await snap('observation-complete');
    check('all four demo observation steps complete without audio submission');
  } finally {
    await mp.evaluate((saved) => {
      if (saved) wx.setStorageSync('yisheng.mp.settings.v1', saved);
      else wx.removeStorageSync('yisheng.mp.settings.v1');
    }, original);
    await mp.callWxMethod('switchTab', { url: '/pages/companion/index' });
    fs.writeFileSync(
      path.join(out, 'native-glass-verification.json'),
      JSON.stringify(report, null, 2)
    );
    await mp.disconnect();
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  console.log(
    JSON.stringify(
      { checks: report.checks.length, screens: report.screens.length, errors: report.errors },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
