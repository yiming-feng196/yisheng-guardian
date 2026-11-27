// Run against an already open WeChat DevTools automation session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const automator = require('miniprogram-automator');

const output = path.resolve(process.env.UI_QA_OUTPUT || 'ui-qa');
const phase = process.argv[2];
assert(['before', 'after'].includes(phase), 'pass before or after');
const routes = ['companion', 'observation', 'records', 'profile'];
const report = { phase, checks: [], screenshots: [], exceptions: [], consoleLevels: {}, warnings: [], switchesMs: [] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(output, { recursive: true });

async function run() {
  const mp = await automator.connect({
    wsEndpoint: process.env.WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420'
  });
  const settingsKey = 'yisheng.mp.settings.v1';
  const original = await mp.evaluate((key) => wx.getStorageSync(key) || null, settingsKey);
  mp.on('exception', (error) => report.exceptions.push(String(error.message || error)));
  mp.on('console', (entry) => {
    const level = entry.level || entry.type || 'unknown';
    report.consoleLevels[level] = (report.consoleLevels[level] || 0) + 1;
    if (level === 'warn') {
      const details = Array.isArray(entry.args)
        ? entry.args.map((arg) => String(arg.value ?? arg.description ?? arg)).join(' ')
        : '';
      const message = String(entry.text || entry.message || details);
      if (message && !report.warnings.includes(message)) report.warnings.push(message);
    }
  });

  async function show(route) {
    const start = performance.now();
    const url = '/pages/' + route + '/index';
    await mp.callWxMethod('switchTab', { url });
    const page = await mp.currentPage();
    assert.equal('/' + page.path, url);
    const root = await page.$('.page');
    assert(root, route + ' root is mounted');
    const size = await root.size();
    assert(Number(size.width) > 0 && Number(size.height) > 0, route + ' root has layout');
    return { page, ms: Math.round(performance.now() - start) };
  }

  async function screenshot(name) {
    await delay(350);
    const filename = phase + '-' + name + '.png';
    await mp.screenshot({ path: path.join(output, filename) });
    report.screenshots.push(filename);
  }

  const call = (name, detail) => mp.evaluate((method, args) => {
    return getCurrentPages().at(-1)[method](args);
  }, name, detail);
  const layout = () => mp.evaluate(() => {
    const page = getCurrentPages().at(-1);
    return {
      inset: page.data.keyboardInset,
      height: page.data.keyboardHeight,
      tabHidden: page.getTabBar().data.hidden,
      draft: page.data.input,
      messages: page.data.messages.length
    };
  });

  try {
    const info = await mp.evaluate(() => ({
      ...wx.getDeviceInfo(), ...wx.getWindowInfo(), ...wx.getAppBaseInfo()
    }));
    report.device = Object.fromEntries(
      ['model', 'platform', 'SDKVersion', 'windowWidth', 'windowHeight'].map((key) => [key, info[key]])
    );
    await mp.evaluate((key, value) => {
      wx.setStorageSync(key, { ...value, mode: 'demo', largeText: false });
    }, settingsKey, original);
    await mp.callWxMethod('reLaunch', { url: '/pages/companion/index' });
    for (const route of routes) {
      const { page } = await show(route);
      report.checks.push({ name: route + ' mounted', passed: true });
      if (route === 'observation') {
        const button = await page.$('.btn-primary');
        assert(Number((await button.size()).height) >= 44);
      }
      await screenshot(route);
    }
    for (let i = 0; i < 30; i++) {
      report.switchesMs.push((await show(routes[i % routes.length])).ms);
    }
    await show('companion');
    const page = await mp.currentPage();
    const panel = await page.$('#chat-panel');
    await call('onInput', { detail: { value: '键盘回归草稿' } });
    const initial = await layout();
    assert.equal(initial.draft, '键盘回归草稿');
    const input = await panel.$('.composer-input');
    await (await panel.$('.chat-handle')).tap();
    await delay(350);
    const scene = await page.$('.page');
    const dimensions = async () => ({
      pageHeight: Number((await scene.size()).height),
      inputBottom: Number((await input.offset()).top) + Number((await input.size()).height)
    });
    const expanded = await dimensions();
    await call('onInputFocus', { detail: { height: 300 } });
    await call('onKeyboardHeight', { detail: { height: 300 } });
    const raised = await layout();
    assert(raised.height > 0 && raised.tabHidden);
    await screenshot('keyboard-raised');
    const raisedGeometry = await dimensions();
    await call('onInputBlur');
    report.firstBlur = await layout();
    await screenshot('keyboard-after-blur');
    const restoredGeometry = await dimensions();
    report.geometry = { expanded, raised: raisedGeometry, afterBlur: restoredGeometry };
    let restored = Number(report.firstBlur.inset === 0 && !report.firstBlur.tabHidden);
    for (let i = 1; i < 20; i++) {
      await call('onInputFocus', { detail: { height: 300 } });
      await call('onKeyboardHeight', { detail: { height: 300 } });
      await call('onInputBlur');
      const current = await layout();
      assert.equal(current.draft, initial.draft);
      assert.equal(current.messages, initial.messages);
      restored += Number(current.inset === 0 && !current.tabHidden);
    }
    report.checks.push({ name: 'synthetic keyboard cycles without final height event', restored, total: 20 });
    await call('onKeyboardHeight', { detail: { height: 0 } });
    await (await panel.$('.send-button')).tap();
    const until = Date.now() + 5000;
    while ((await layout()).messages < initial.messages + 2 && Date.now() < until) await delay(50);
    const chat = await layout();
    assert.equal(chat.messages, initial.messages + 2);
    await screenshot('chat-reply');
    if (phase === 'after') {
      await input.tap();
      await delay(300);
      await input.input('Focus regression');
      await delay(300);
      assert.equal((await layout()).draft, 'Focus regression');
      const focused = () => mp.evaluate(() => getCurrentPages().at(-1).data.inputFocused);
      assert.equal(await focused(), true);
      await (await page.$('.identity-subtitle')).tap();
      await delay(300);
      assert.equal(await focused(), false);
      assert.equal((await layout()).draft, 'Focus regression');
      report.checks.push({ name: 'simulator input focus, typing and tap-to-dismiss', passed: true });
    }
    await show('profile');
    await call('showAbout');
    await screenshot('profile-about');
    report.modalHidesTab = await mp.evaluate(() => getCurrentPages().at(-1).getTabBar().data.hidden);
    if (phase === 'after') {
      const modal = await (await mp.currentPage()).$('#about-sheet');
      assert(modal, 'about sheet is mounted');
      const confirm = await modal.$('.btn-primary');
      assert(confirm, 'about sheet confirm button is present');
      await confirm.tap();
      await delay(400);
      assert.equal(await mp.evaluate(() => getCurrentPages().at(-1).data.aboutVisible), false);
    } else {
      await call('closeAbout');
    }
    report.checks.push({ name: 'demo text reply and profile sheet', passed: true });
    if (phase === 'after') {
      assert.equal(await mp.evaluate(() => getCurrentPages().at(-1).getTabBar().data.hidden), false);
      await call('onTextChange', { detail: { value: true } });
      for (const route of routes) {
        const { page: largePage } = await show(route);
        assert.equal(await mp.evaluate(() => getCurrentPages().at(-1).data.largeText), true);
        if (route === 'companion') await call('closeChat');
        await screenshot(route + '-large');
        if (route === 'observation') {
          await mp.callWxMethod('pageScrollTo', { scrollTop: 10000, duration: 0 });
          await delay(200);
          const action = await largePage.$('.btn-primary');
          const bottom = Number((await action.offset()).top) + Number((await action.size()).height);
          const nav = await mp.evaluate(() => getCurrentPages().at(-1).data.navSpace);
          assert(bottom <= info.windowHeight - nav + 8);
          await screenshot('observation-large-action');
        }
      }
      report.checks.push({ name: 'large text state across all tabs', passed: true });
    }
    if (process.env.UI_QA_PROBE_LOCAL === '1') {
      report.localHealthProbe = await mp.evaluate(() => new Promise((resolve) => {
        wx.request({
          url: 'http://127.0.0.1:8080/actuator/health',
          timeout: 3000,
          success: (response) => resolve({ status: response.statusCode }),
          fail: (error) => resolve({ error: error.errMsg })
        });
      }));
    }
    assert.equal(report.exceptions.length, 0);
    if (phase === 'after') {
      assert.equal(restored, 20);
      assert.equal(report.modalHidesTab, true);
      assert.equal(raisedGeometry.pageHeight, expanded.pageHeight - 300);
      assert(raisedGeometry.inputBottom <= raisedGeometry.pageHeight + 1);
      assert(Math.abs(restoredGeometry.pageHeight - expanded.pageHeight) <= 1);
      assert(Math.abs(restoredGeometry.inputBottom - expanded.inputBottom) <= 1);
    }
  } finally {
    fs.writeFileSync(path.join(output, phase + '.json'), JSON.stringify(report, null, 2));
    await mp.evaluate((key, value) => {
      if (value) wx.setStorageSync(key, value);
      else wx.removeStorageSync(key);
    }, settingsKey, original).finally(() => mp.disconnect());
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
