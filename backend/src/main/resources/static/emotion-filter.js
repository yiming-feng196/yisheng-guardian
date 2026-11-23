"use strict";

// A clock-based filter, so stability does not depend on camera/inference FPS.
class YiShengEmotionFilter {
  constructor(options = {}) {
    this.options = { timeConstantMs: 1600, initialHoldMs: 900, switchHoldMs: 1600,
      minimumDisplayMs: 3000, missingGraceMs: 1200, resetGapMs: 2200,
      confidenceFloor: 0.3, majority: 0.6, ...options };
    this.reset();
  }
  reset() {
    this.scores = new Map();
    this.samples = [];
    this.current = null;
    this.candidate = null;
    this.lastAt = null;
    this.lastFaceAt = null;
    this.lastSwitchAt = null;
    this.lastConfidenceAt = null;
  }
  update(face, now = performance.now()) {
    const settings = this.options;
    if (this.lastAt !== null && (now < this.lastAt || now - this.lastAt > settings.resetGapMs)) this.reset();
    if (!face) {
      this.candidate = null;
      if (this.lastFaceAt !== null && now - this.lastFaceAt <= settings.missingGraceMs) {
        return this.current ? { ...this.current, stale: true } : null;
      }
      this.reset();
      return null;
    }
    this.lastFaceAt = now;
    const elapsed = this.lastAt === null ? 450 : Math.max(1, now - this.lastAt);
    this.lastAt = now;
    const confidence = Math.max(0, Math.min(1, Number(face.confidence) || 0));
    const accepted = confidence >= settings.confidenceFloor;
    const alpha = 1 - Math.exp(-elapsed / settings.timeConstantMs);
    for (const [key, value] of this.scores) this.scores.set(key, value * (1 - alpha));
    if (accepted) {
      this.scores.set(face.emotion, (this.scores.get(face.emotion) || 0) + alpha * confidence);
      this.samples.push({ emotion: face.emotion, label: face.label, confidence, at: now });
    }
    this.samples = this.samples.filter(sample => now - sample.at <= 4000);
    const ranking = Array.from(this.scores.entries()).sort((a, b) => b[1] - a[1]);
    const total = ranking.reduce((sum, item) => sum + item[1], 0);
    const leader = ranking[0];
    const convincing = accepted && leader && leader[0] === face.emotion
      && total > 0 && leader[1] / total >= settings.majority;
    if (convincing && leader[0] !== this.current?.emotion) {
      if (this.candidate?.emotion !== leader[0]) this.candidate = { emotion: leader[0], since: now };
      const hold = this.current ? settings.switchHoldMs : settings.initialHoldMs;
      if (now - this.candidate.since >= hold
          && (this.lastSwitchAt === null || now - this.lastSwitchAt >= settings.minimumDisplayMs)) {
        this.current = { emotion: face.emotion, label: face.label, confidence };
        this.lastSwitchAt = now;
        this.lastConfidenceAt = now;
        this.candidate = null;
      }
    } else {
      this.candidate = null;
    }
    if (!this.current) return { emotion: null, label: "正在观察", confidence: 0, pending: true };
    if (now - this.lastConfidenceAt >= 1000) {
      const matches = this.samples.filter(sample => sample.emotion === this.current.emotion);
      if (matches.length) {
        const mean = matches.reduce((sum, sample) => sum + sample.confidence, 0) / matches.length;
        this.current.confidence += 0.2 * (mean - this.current.confidence);
      }
      this.lastConfidenceAt = now;
    }
    return { ...this.current, pending: false, stale: false };
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = YiShengEmotionFilter;
if (typeof window !== "undefined") window.YiShengEmotionFilter = YiShengEmotionFilter;
