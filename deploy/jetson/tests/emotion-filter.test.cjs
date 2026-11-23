const test = require('node:test');
const assert = require('node:assert/strict');
const Filter = require('../../../backend/src/main/resources/static/emotion-filter.js');
const face = emotion => ({emotion, label: emotion, confidence: 0.8});

test('alternating single frames cannot replace an established expression', () => {
  const filter = new Filter();
  for (let t = 0; t <= 4000; t += 400) filter.update(face('happy'), t);
  for (let t = 4400; t <= 24000; t += 400) {
    const result = filter.update(face(t % 800 ? 'sad' : 'happy'), t);
    assert.equal(result.emotion, 'happy');
  }
});

test('a sustained expression replaces the old one, with similar delay at different frame rates', () => {
  const changes = [250, 500, 750].map(interval => {
    const filter = new Filter();
    for (let t = 0; t <= 4500; t += interval) filter.update(face('happy'), t);
    for (let t = 4500 + interval; t < 13000; t += interval) {
      if (filter.update(face('sad'), t).emotion === 'sad') return t - 4500;
    }
    throw new Error('Sustained change never appeared');
  });
  assert.ok(Math.max(...changes) - Math.min(...changes) <= 750);
  changes.forEach(time => assert.ok(time >= 750 && time <= 1750));
});

test('brief face loss retains display but marks it stale; long loss resets it', () => {
  const filter = new Filter();
  for (let t = 0; t <= 3000; t += 500) filter.update(face('happy'), t);
  assert.equal(filter.update(null, 3500).stale, true);
  assert.equal(filter.update(null, 4500), null);
  assert.equal(filter.update(face('sad'), 5000).pending, true);
});

test('uncertain frames never establish a label and long gaps discard old evidence', () => {
  const filter = new Filter();
  for (let t = 0; t < 5000; t += 500) assert.equal(filter.update({...face('sad'),confidence:0.1}, t).pending, true);
  for (let t = 5000; t <= 8000; t += 500) filter.update(face('happy'), t);
  assert.equal(filter.update(face('sad'), 12000).pending, true);
});


test('first expression is confirmed quickly, while a single conflicting frame is ignored', () => {
  const filter = new Filter();
  assert.equal(filter.update(face('happy'), 0).pending, true);
  assert.equal(filter.update(face('happy'), 250).emotion, 'happy');
  filter.update(face('happy'), 500);
  assert.equal(filter.update(face('sad'), 750).emotion, 'happy');
  assert.equal(filter.update(face('happy'), 1000).emotion, 'happy');
});

test('a new label respects the minimum display duration even with a clear reversal', () => {
  const filter = new Filter();
  filter.update(face('happy'), 0);
  filter.update(face('happy'), 250);
  for (let t = 500; t < 1450; t += 250) {
    assert.equal(filter.update(face('sad'), t).emotion, 'happy');
  }
  assert.equal(filter.update(face('sad'), 1500).emotion, 'sad');
});
