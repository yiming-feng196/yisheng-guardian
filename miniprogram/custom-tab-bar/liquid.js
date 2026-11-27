// Normalized tab-width units let page-specific tab bars share one motion.
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
function createMotion(index) {
  return {
    x: index,
    target: index,
    tail: index,
    velocity: 0,
    tailVelocity: 0,
    pressure: 0,
    pressureTarget: 0,
    pressureVelocity: 0
  };
}
function settle(m, index) {
  m.x = m.tail = m.target = index;
  m.velocity = m.tailVelocity = m.pressureVelocity = 0;
  m.pressure = m.pressureTarget;
}
function advance(m, elapsed, dragging) {
  const dt = clamp(elapsed, 0, 0.032),
    steps = Math.max(1, Math.ceil(dt / 0.008)),
    h = dt / steps;
  for (let i = 0; i < steps; i++) {
    if (!dragging) {
      m.velocity += ((m.target - m.x) * 800 - 56.57 * m.velocity) * h;
      m.x += m.velocity * h;
    }
    m.tailVelocity += ((m.x - m.tail) * 200 - 28.3 * m.tailVelocity) * h;
    m.tail += m.tailVelocity * h;
    m.pressureVelocity += ((m.pressureTarget - m.pressure) * 1000 - 64 * m.pressureVelocity) * h;
    m.pressure += m.pressureVelocity * h;
  }
  const moving =
    (!dragging && (Math.abs(m.target - m.x) > 0.0004 || Math.abs(m.velocity) > 0.004)) ||
    Math.abs(m.x - m.tail) > 0.0009 ||
    Math.abs(m.tailVelocity) > 0.005 ||
    Math.abs(m.pressureTarget - m.pressure) > 0.002 ||
    Math.abs(m.pressureVelocity) > 0.01;
  if (!moving) {
    if (!dragging) m.x = m.target;
    m.tail = m.x;
    m.velocity = m.tailVelocity = m.pressureVelocity = 0;
    m.pressure = m.pressureTarget;
  }
  return moving;
}
function rubberband(p) {
  return p < 0
    ? -0.24 * (1 - Math.exp(p / 0.7))
    : p > 3
      ? 3 + 0.24 * (1 - Math.exp(-(p - 3) / 0.7))
      : p;
}
function contour(m, width, height) {
  const slot = width / 4,
    rx = Math.max(8, (slot - 4) / 2),
    ry = height / 2 - 1.8;
  const amount = clamp(Math.abs(m.x - m.tail) / 1.25, 0, 1);
  const speed = clamp(Math.abs(m.velocity * slot) / 1500, 0, 1);
  const headRX = Math.min(slot / 2 - 0.7, rx * (1 + m.pressure * 0.025 + speed * 0.04));
  const headRY = ry * (1 - m.pressure * 0.055 - speed * 0.025);
  const tailRX = rx * (1 - 0.42 * amount),
    tailRY = ry * (1 - 0.43 * amount);
  const headCX = clamp((m.x + 0.5) * slot, headRX + 0.5, width - headRX - 0.5);
  const tailCX = clamp((m.tail + 0.5) * slot, tailRX + 0.5, width - tailRX - 0.5);
  const head = { cx: headCX, rx: headRX, ry: headRY },
    tail = { cx: tailCX, rx: tailRX, ry: tailRY };
  const left = headCX <= tailCX ? head : tail,
    right = headCX <= tailCX ? tail : head;
  const start = Math.min(headCX - headRX, tailCX - tailRX),
    end = Math.max(headCX + headRX, tailCX + tailRX);
  const distance = right.cx - left.cx,
    count = Math.max(24, Math.min(48, Math.ceil((end - start) / 4.5)));
  const top = [],
    bottom = [];
  const envelope = (x, lobe) => {
    const u = Math.abs((x - lobe.cx) / lobe.rx);
    return u >= 1 ? 0 : lobe.ry * Math.pow(1 - Math.pow(u, 3.15), 1 / 3.15);
  };
  for (let i = 0; i <= count; i++) {
    const x = start + ((end - start) * i) / count;
    let half = Math.max(envelope(x, left), envelope(x, right)),
      cy = height / 2;
    if (distance >= 1 && x > left.cx && x < right.cx) {
      const t = (x - left.cx) / distance,
        base = left.ry + (right.ry - left.ry) * t;
      const pinch = clamp((distance / (left.rx + right.rx)) * 0.88, 0, 0.88);
      const bridge = Math.max(3.8, base * (1 - pinch * Math.pow(Math.sin(Math.PI * t), 0.65)));
      half = Math.max(half, bridge) + Math.pow(Math.max(2.2 - Math.abs(half - bridge), 0), 2) / 8.8;
      cy += Math.sin(Math.PI * t) * amount * Math.sign(m.velocity) * 1.5;
    }
    half = i === 0 || i === count ? 0 : Math.min(half, height / 2 - 1.2);
    top.push([x, cy - half]);
    bottom.push([x, cy + half]);
  }
  return top.concat(bottom.reverse().slice(1, -1));
}
function trace(ctx, points) {
  const last = points[points.length - 1],
    first = points[0];
  ctx.beginPath();
  ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      next = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + next[0]) / 2, (p[1] + next[1]) / 2);
  }
  ctx.closePath();
}
module.exports = { clamp, createMotion, settle, advance, rubberband, contour, trace };
