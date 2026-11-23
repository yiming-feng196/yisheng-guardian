"use strict";

(() => {
  const panel = $("wakeControls");
  const button = $("wakeToggle");
  const message = $("wakeStatus");
  const base = String(YISHENG_CONFIG.wakeApiBase || "").replace(/\/$/, "");
  if (!panel || !base) return;
  panel.hidden = false;
  document.body.classList.add("wake-capable");
  let latest = null;
  let instance = "";
  let sequence = 0;
  let running = false;
  let again = false;
  let changing = false;
  let handlingWake = false;
  let closed = false;
  let timer = null;
  let controlEpoch = 0;

  function busy() {
    return handlingWake || digitalVoiceOpening || digitalVoiceSubmitting
      || digitalVoiceRecorder?.state === "recording" || Boolean(state.audioContext)
      || Boolean(state.screeningOpening) || state.chatStreaming
      || digitalAvatar.stage?.dataset.avatarState === "thinking";
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("wake service unavailable");
      const result = await response.json();
      if (typeof result.enabled !== "boolean" || !Number.isInteger(result.sequence) || typeof result.instance_id !== "string") throw new Error("invalid wake status");
      return result;
    } finally { window.clearTimeout(timeout); }
  }
  function render(status) {
    latest = status;
    button.disabled = changing;
    button.setAttribute("aria-pressed", String(status.enabled));
    button.textContent = status.enabled ? "关闭唤醒" : "开启唤醒";
    panel.dataset.state = status.enabled ? status.state : "disabled";
    const speaking = digitalAvatar.stage?.dataset.avatarState === "speaking";
    message.textContent = !status.enabled ? "语音唤醒已关闭" : status.state === "error" ? "唤醒暂不可用，请检查麦克风后重试" : !status.ready ? "正在准备语音唤醒…" : speaking && status.listening ? "正在朗读，可喊“小忆小忆”打断并开启新话题" : busy() ? "正在对话，唤醒监听已暂停" : status.listening ? "喊“小忆小忆”，就能和我说话" : "正在恢复唤醒监听…";
  }
  async function handleWake() {
    if (busy() || changing || !latest?.enabled) return;
    handlingWake = true;
    try {
      await request("/lease", { client: state.assistantClientId, busy: true });
      if (closed || changing || !latest?.enabled) return;
      switchTab("chat");
      stopDigitalPlayback(false);
      if (!state.currentConversationId) {
        setDigitalAvatarState("thinking", "我在，正在准备对话。");
        let limit;
        try {
          await Promise.race([initializeAssistantConversations(), new Promise((_, reject) => { limit = window.setTimeout(() => reject(new Error("timeout")), 8000); })]);
        } finally { window.clearTimeout(limit); }
      }
      if (!state.currentConversationId) throw new Error("conversation unavailable");
      if (closed || changing || !latest?.enabled) return;
      primeDigitalAudio();
      await startDigitalListening({ autoSubmit: true });
    } catch (_) {
      setDigitalAvatarState("error", "我听到您叫我了。对话暂未就绪，请重试连接，也可以打字。 ");
    } finally {
      handlingWake = false;
      activityChanged();
    }
  }
  async function poll() {
    if (closed) return;
    if (running || changing) { again = true; return; }
    running = true;
    const epoch = controlEpoch;
    window.clearTimeout(timer);
    try {
      const status = await request("/lease", { client: state.assistantClientId, busy: busy() });
      if (closed || epoch !== controlEpoch) return;
      render(status);
      if (instance !== status.instance_id) {
        instance = status.instance_id;
        sequence = status.sequence;
      } else if (status.sequence > sequence) {
        sequence = status.sequence;
        if (status.event_age_ms !== null && status.event_age_ms <= 2500) await handleWake();
      }
    } catch (_) {
      if (closed) return;
      latest = null;
      panel.dataset.state = "error";
      message.textContent = "唤醒连接中断，手动说话仍可使用";
      button.disabled = false;
      button.textContent = "重试连接";
    } finally {
      running = false;
      if (!closed) { const delay = again ? 0 : 500; again = false; timer = window.setTimeout(poll, delay); }
    }
  }
  function activityChanged() {
    if (latest) render(latest);
    poll();
  }
  async function setEnabled(enabled) {
    if (changing) return;
    changing = true;
    ++controlEpoch;
    button.disabled = true;
    try {
      const status = await request("/control", { enabled });
      render(status);
      instance = status.instance_id;
      sequence = status.sequence;
    } catch (_) {
      latest = null;
      message.textContent = "暂时无法切换唤醒，请重试";
      button.textContent = "重试连接";
    } finally {
      changing = false;
      button.disabled = false;
      activityChanged();
    }
  }
  button.addEventListener("click", () => {
    primeDigitalAudio();
    if (!latest) poll();
    else setEnabled(!latest.enabled);
  });
  window.YiShengWake = { activityChanged, setEnabled, isBusy: busy };
  window.addEventListener("pagehide", () => { closed = true; window.clearTimeout(timer); if (digitalVoiceAutoSubmit || handlingWake) cancelDigitalRecording(false); });
  window.addEventListener("pageshow", () => { if (closed) { closed = false; instance = ""; poll(); } });
  poll();
})();
