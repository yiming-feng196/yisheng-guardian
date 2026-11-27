const automator = require('miniprogram-automator');
const fs = require('node:fs'),
  path = require('node:path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mp = await automator.connect({
    wsEndpoint: process.env.WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420'
  });
  console.log('connected');
  const original = await mp.currentPage();
  try {
    for (const page of ['companion', 'observation', 'records', 'profile']) {
      console.log('warm', page);
      await mp.callWxMethod('switchTab', { url: '/pages/' + page + '/index' });
      await wait(450);
    }
    await mp.evaluate(() => {
      getApp().globalData.__liquidProfile = { events: [], restores: [] };
      return true;
    });
    for (const page of ['companion', 'observation', 'records', 'profile']) {
      await mp.callWxMethod('switchTab', { url: '/pages/' + page + '/index' });
      await wait(400);
      await mp.evaluate(() => {
        const b = getCurrentPages()[getCurrentPages().length - 1].getTabBar(),
          q = getApp().globalData.__liquidProfile;
        const route = getCurrentPages()[getCurrentPages().length - 1].route;
        for (const name of ['_draw', '_measure']) {
          const original = b[name];
          q.restores.push(() => {
            b[name] = original;
          });
          b[name] = function () {
            const start = Date.now();
            const result = original.apply(this, arguments);
            q.events.push({ method: name, route, time: start, duration: Date.now() - start });
            return result;
          };
        }
        return true;
      });
    }
    await mp.evaluate(() => {
      getApp().globalData.__liquidProfile.events = [];
      return true;
    });
    for (const index of [0, 2, 1, 3, 0, 1, 2, 3]) {
      console.log('profile', index);
      await mp.evaluate((index) => {
        const b = getCurrentPages()[getCurrentPages().length - 1].getTabBar(),
          q = getApp().globalData.__liquidProfile;
        q.events.push({
          method: 'release',
          route: b.data.tabs[index].url.slice(1),
          time: Date.now()
        });
        b.switchTab({ currentTarget: { dataset: { index } } });
        return true;
      }, index);
      await wait(950);
    }
    const events = await mp.evaluate(() => getApp().globalData.__liquidProfile.events);
    const releases = events.filter((e) => e.method === 'release');
    const transitions = releases.map((e, i) => {
      const end = releases[i + 1]?.time || Infinity;
      const draws = events.filter(
        (d) => d.method === '_draw' && d.route === e.route && d.time >= e.time && d.time < end
      );
      const intervals = draws.slice(1).map((d, j) => d.time - draws[j].time);
      return {
        route: e.route,
        firstDrawMs: draws[0]?.time - e.time,
        frames: draws.length,
        maxGapMs: Math.max(0, ...intervals),
        longFrames: intervals.filter((v) => v > 34).length
      };
    });
    const durations = events
      .filter((e) => e.method === '_draw')
      .map((e) => e.duration)
      .sort((a, b) => a - b);
    const report = {
      measureCalls: events.filter((e) => e.method === '_measure').length,
      drawP95Ms: durations[Math.floor(durations.length * 0.95)],
      drawMaxMs: Math.max(...durations),
      transitions
    };
    const dest = path.resolve(
      process.env.UI_QA_OUTPUT || 'ui-qa/liquid-navigation',
      process.argv[2] || 'performance.json'
    );
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mp.evaluate(() => {
      const q = getApp().globalData.__liquidProfile;
      if (q) {
        q.restores.forEach((f) => f());
        delete getApp().globalData.__liquidProfile;
      }
      return true;
    });
    await mp.callWxMethod('switchTab', { url: '/' + original.path });
    await mp.disconnect();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
