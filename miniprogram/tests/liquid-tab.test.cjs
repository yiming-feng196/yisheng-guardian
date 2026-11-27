const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const liquid = require('../custom-tab-bar/liquid');

function harness(options = {}) {
  let definition,
    now = 1000,
    id = 0;
  const frames = new Map(),
    requests = [],
    bars = [];
  const context = {
    require: () => liquid,
    Component: (d) => {
      definition = d;
    },
    Date: { now: () => now },
    setTimeout: (f, delay) => {
      frames.set(++id, { f, at: now + delay });
      return id;
    },
    clearTimeout: (n) => frames.delete(n),
    wx: {
      getDeviceInfo: () => ({ benchmarkLevel: options.lowPower ? 5 : 50 }),
      getWindowInfo: () => ({ pixelRatio: 3 }),
      switchTab: (request) => requests.push(request),
      showToast() {}
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../custom-tab-bar/index.js'), 'utf8'),
    context
  );
  function bar(selected = 0) {
    const draw = { points: [], fills: 0, gradients: 0, queries: 0 },
      patches = [];
    const ctx = {
      scale() {},
      clearRect() {
        draw.points = [];
      },
      beginPath() {},
      moveTo() {},
      quadraticCurveTo(...p) {
        draw.points.push(p);
      },
      closePath() {},
      createLinearGradient: () => {
        draw.gradients++;
        return { addColorStop() {} };
      },
      fill() {
        draw.fills++;
      },
      stroke() {}
    };
    const canvas = {
      getContext: () => ctx,
      requestAnimationFrame(f) {
        frames.set(++id, { f, at: now + (options.rafDelay || 16) });
        return id;
      },
      cancelAnimationFrame: (n) => frames.delete(n)
    };
    const instance = Object.assign(
      {
        data: Object.assign(JSON.parse(JSON.stringify(definition.data)), {
          selected,
          visualIndex: selected
        }),
        rect: { left: 16, top: 600, bottom: 658, width: 360, height: 58 },
        setData(patch, done) {
          Object.assign(this.data, patch);
          patches.push(patch);
          if (done) done();
        },
        createSelectorQuery() {
          draw.queries++;
          const q = {
            select: () => q,
            fields: () => q,
            boundingClientRect: () => q,
            exec(callback) {
              callback([{ node: options.noCanvas ? null : canvas }, instance.rect]);
            }
          };
          return q;
        }
      },
      definition.methods
    );
    definition.lifetimes.attached.call(instance);
    definition.lifetimes.ready.call(instance);
    bars.push(instance);
    return Object.assign(instance, { draw, patches, canvas });
  }
  function step(count = 1) {
    for (let i = 0; i < count; i++) {
      now += 16;
      for (const [key, value] of [...frames]) {
        if (frames.has(key) && value.at <= now) {
          frames.delete(key);
          value.f(now);
        }
      }
    }
  }
  function touch(x, y = 630, pointer = 1, index = 0) {
    const p = { clientX: x, clientY: y, identifier: pointer };
    return { currentTarget: { dataset: { index } }, touches: [p], changedTouches: [p] };
  }
  function width(b) {
    const x = b.draw.points.flatMap((p) => [p[0], p[2]]);
    return Math.max(...x) - Math.min(...x);
  }
  return {
    bar,
    step,
    touch,
    width,
    frames,
    requests,
    definition,
    bars,
    elapse: (ms) => {
      now += ms;
    }
  };
}

test('liquid stretches into a continuous neck and converges to one capsule', () => {
  const m = liquid.createMotion(0);
  m.x = 3;
  m.target = 3;
  const points = liquid.contour(m, 360, 58),
    top = points.slice(0, points.length / 2 + 1);
  assert(points.every((p) => p.every(Number.isFinite)));
  assert(points.every((p) => p[0] >= 0 && p[0] <= 360 && p[1] >= 0 && p[1] <= 58));
  const middle = top.reduce((a, b) => (Math.abs(a[0] - 180) < Math.abs(b[0] - 180) ? a : b));
  assert(middle[1] > 18 && middle[1] < 29, 'narrow but nonzero center connection');
  for (let i = 0; i < 150; i++) liquid.advance(m, 0.016, false);
  assert.equal(m.x, 3);
  assert.equal(m.tail, 3);
  assert.equal(liquid.advance(m, 0.016, false), false);
});

test('springs can reverse from their current position and stay finite after a long frame', () => {
  const m = liquid.createMotion(0);
  m.target = 3;
  for (let i = 0; i < 6; i++) liquid.advance(m, 0.016, false);
  const before = m.x;
  m.target = 0;
  assert.equal(m.x, before);
  liquid.advance(m, 50, false);
  assert(Number.isFinite(m.x));
  for (let i = 0; i < 150; i++) liquid.advance(m, 0.016, false);
  assert.equal(m.x, 0);
  assert.equal(m.tail, 0);
  assert(liquid.rubberband(-10) > -0.24);
  assert(liquid.rubberband(10) < 3.24);
});

test('drag follows touch, cancels outside, ignores secondary fingers and does not send frame-by-frame setData', () => {
  const h = harness(),
    b = h.bar();
  h.step(120);
  const restingWidth = h.width(b);
  b.onTouchStart(h.touch(61));
  b.onTouchMove(h.touch(69));
  b.onTouchMove(h.touch(331));
  assert(h.width(b) > restingWidth * 2);
  assert.equal(h.requests.length, 0);
  const gesture = b._gesture;
  b.onTouchStart(h.touch(110, 630, 2, 1));
  b.onTouchEnd(h.touch(110, 630, 2, 1));
  assert.equal(b._gesture, gesture);
  const patchCount = b.patches.length;
  h.step(20);
  assert.equal(b.patches.length, patchCount);
  b.onTouchEnd(h.touch(331, 400));
  h.step(150);
  assert.equal(h.requests.length, 0);
  assert.equal(b.data.selected, 0);
  assert.equal(b.data.pressedIndex, -1);
  assert(Math.abs(h.width(b) - restingWidth) < 0.1);
  assert.equal(h.frames.size, 0);
});

test('motion hands off to the destination tab instance and hidden instances stop drawing', () => {
  const h = harness(),
    source = h.bar();
  h.step(100);
  source.onTouchStart(h.touch(61));
  source.onTouchMove(h.touch(69));
  source.onTouchMove(h.touch(331));
  source.onTouchEnd(h.touch(331));
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/pages/profile/index');
  assert.equal(source.data.selected, 0);
  const before = JSON.stringify(source.draw.points);
  h.definition.pageLifetimes.hide.call(source);
  const destination = h.bar(3);
  assert.equal(
    JSON.stringify(destination.draw.points),
    before,
    'first destination frame preserves shape'
  );
  h.requests[0].success();
  h.requests[0].complete();
  const fills = source.draw.fills;
  h.step(150);
  assert.equal(source.draw.fills, fills);
  assert.equal(destination.data.selected, 3);
  assert(h.width(destination) < 90);
  assert.equal(h.frames.size, 0);
});

test('touch cancellation and native navigation failures restore the committed selection', () => {
  const h = harness(),
    b = h.bar();
  h.step(100);
  b.onTouchStart(h.touch(61));
  b.onTouchMove(h.touch(69));
  b.onTouchMove(h.touch(260));
  b.onTouchCancel();
  h.step(150);
  assert.equal(h.requests.length, 0);
  assert.equal(b.data.visualIndex, 0);
  h.step(30);
  b.switchTab({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(b.data.selected, 0);
  h.requests[0].fail();
  h.requests[0].complete();
  h.step(150);
  assert.equal(b.data.selected, 0);
  assert.equal(b.data.visualIndex, 0);
  assert.equal(h.frames.size, 0);
});

test('canvas failure keeps navigation usable and low-power mode settles immediately', () => {
  const no = harness({ noCanvas: true }),
    fallback = no.bar();
  assert.equal(fallback.data.liquidReady, false);
  fallback.switchTab({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(no.requests[0].url, '/pages/observation/index');
  const h = harness({ lowPower: true }),
    b = h.bar();
  b.switchTab({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(h.frames.size, 0);
  assert(h.width(b) < 90);
});

test('keyboard hide stops rendering; large-text geometry is remeasured on return', () => {
  const h = harness(),
    b = h.bar();
  h.step(100);
  b.onTouchStart(h.touch(61));
  b.syncPage({ selected: 0, hidden: true });
  assert.equal(h.frames.size, 0);
  assert.equal(b._gesture, null);
  b.rect.height = 70;
  b.rect.bottom = 670;
  b.syncPage({ selected: 0, hidden: false, largeText: true });
  h.step(100);
  assert.equal(b._height, 70);
  assert.equal(b.data.largeText, true);
  assert.equal(h.frames.size, 0);
  b.onTouchStart(h.touch(61));
  h.definition.pageLifetimes.resize.call(b);
  h.step(100);
  assert.equal(b._gesture, null);
  assert.equal(b.data.pressedIndex, -1);
  assert.equal(h.frames.size, 0);
});

test('returning to a cached page does not query or recreate its canvas and gradients', () => {
  const h = harness(),
    b = h.bar();
  h.step(100);
  const queries = b.draw.queries,
    gradients = b.draw.gradients;
  b.syncPage({ selected: 0, hidden: false, largeText: false, safeBottom: 0 });
  h.step(100);
  h.definition.pageLifetimes.hide.call(b);
  h.definition.pageLifetimes.show.call(b);
  b.syncPage({ selected: 0, hidden: false, largeText: false, safeBottom: 0 });
  h.step(100);
  assert.equal(b.draw.queries, queries);
  assert.equal(b.draw.gradients, gradients);
});

test('destination catches up through the navigation interval instead of resuming a frozen shape', () => {
  const h = harness(),
    source = h.bar();
  h.step(100);
  source.switchTab({ currentTarget: { dataset: { index: 3 } } });
  h.step(4);
  const old = JSON.stringify(source.draw.points);
  h.definition.pageLifetimes.hide.call(source);
  h.elapse(100);
  const destination = h.bar(3);
  assert.notEqual(JSON.stringify(destination.draw.points), old);
  h.requests[0].success();
  h.requests[0].complete();
  h.step(120);
  assert.equal(h.frames.size, 0);
  assert(h.width(destination) < 90);
});

test('a delayed native frame callback falls back to a single responsive clock', () => {
  const h = harness({ rafDelay: 500 }),
    b = h.bar();
  h.step(100);
  b.switchTab({ currentTarget: { dataset: { index: 3 } } });
  const fills = b.draw.fills;
  h.step(12);
  assert.equal(b._timerClock, true);
  assert(b.draw.fills - fills > 8, 'animation keeps producing frames');
  h.step(150);
  assert.equal(h.frames.size, 0);
  assert.equal(b.draw.gradients, 2, 'gradients are cached, not rebuilt per frame');
});
