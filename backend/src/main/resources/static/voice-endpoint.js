"use strict";

// End only a wake-started turn; manual/screening recordings keep their controls.
class YiShengVoiceEndpoint {
  constructor(options = {}) {
    this.threshold = Math.max(.005, Number(options.threshold) || .02);
    this.silenceMs = Math.max(1200, Number(options.silenceMs) || 1800);
    this.noSpeechMs = Math.max(4000, Number(options.noSpeechMs) || 8000);
    this.maxMs = Math.max(10000, Number(options.maxMs) || 45000);
    this.startedAt = null;
    this.lastAt = null;
    this.lastVoiceAt = null;
    this.voicedMs = 0;
    this.done = false;
  }
  update(rms, now) {
    if (this.done) return null;
    if (this.startedAt === null) this.startedAt = now;
    const elapsed = this.lastAt === null ? 100 : Math.min(200, Math.max(0, now - this.lastAt));
    this.lastAt = now;
    if (Number.isFinite(rms) && rms >= this.threshold) {
      this.voicedMs += elapsed;
      this.lastVoiceAt = now;
    }
    const speech = this.voicedMs >= 300;
    const age = now - this.startedAt;
    let action = null;
    if (!speech && age >= this.noSpeechMs) action = "cancel";
    else if (speech && age >= 1000 && now - this.lastVoiceAt >= this.silenceMs) action = "submit";
    else if (age >= this.maxMs) action = speech ? "submit" : "cancel";
    if (action) this.done = true;
    return action;
  }
}
if (typeof window !== "undefined") window.YiShengVoiceEndpoint = YiShengVoiceEndpoint;
if (typeof module !== "undefined" && module.exports) module.exports = YiShengVoiceEndpoint;
