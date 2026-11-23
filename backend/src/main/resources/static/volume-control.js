"use strict";

(() => {
  const slider = document.getElementById("speakerVolume");
  const output = document.getElementById("speakerVolumeValue");
  const mute = document.getElementById("volumeMute");
  const status = document.getElementById("volumeStatus");
  if (!slider || !output || !mute) return;
  const endpoint = window.YISHENG_CONFIG?.audioControlUrl;
  let lastAudible = 50;
  let pending = null;
  let busy = false;
  let timer = null;
  let current = 100;
  function render(value) {
    current = Math.max(0, Math.min(100, Math.round(value)));
    slider.value = current;
    output.value = `${current}%`;
    slider.setAttribute("aria-valuetext", `${current}%`);
    mute.textContent = current === 0 ? "取消静音" : "静音";
    mute.setAttribute("aria-pressed", String(current === 0));
    if (current > 0) lastAudible = current;
  }
  function applyBrowserVolume() {
    document.querySelectorAll("audio, video").forEach((media) => { media.volume = current / 100; });
  }
  window.YiShengVolume = { get speechVolume() { return endpoint ? 1 : current / 100; } };
  async function request(options) {
    const response = await fetch(endpoint, { cache: "no-store", ...options });
    if (!response.ok) throw new Error("音量调节暂不可用，请稍后重试。");
    return response.json();
  }
  async function flush() {
    window.clearTimeout(timer);
    if (busy || pending === null) return;
    busy = true;
    const value = pending;
    pending = null;
    try {
      const result = await request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ volume: value }) });
      if (pending === null) render(result.volume);
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      if (pending !== null) flush();
    }
  }
  function choose(value, immediately = false) {
    render(value);
    if (!endpoint) {
      localStorage.setItem("yishengVolume", String(current));
      applyBrowserVolume();
      return;
    }
    pending = current;
    window.clearTimeout(timer);
    if (immediately) flush();
    else timer = window.setTimeout(flush, 120);
  }
  slider.addEventListener("input", () => choose(Number(slider.value)));
  slider.addEventListener("change", () => { if (endpoint) flush(); });
  mute.addEventListener("click", () => choose(current === 0 ? lastAudible : 0, true));
  if (endpoint) {
    slider.disabled = mute.disabled = true;
    request().then((result) => render(result.volume)).catch((error) => {
      status.textContent = error.message;
    }).finally(() => { slider.disabled = mute.disabled = false; });
  } else {
    const stored = Number(localStorage.getItem("yishengVolume") ?? 100);
    render(Number.isFinite(stored) ? stored : 100);
    applyBrowserVolume();
    new MutationObserver(applyBrowserVolume).observe(document.body, { childList: true, subtree: true });
  }
})();
