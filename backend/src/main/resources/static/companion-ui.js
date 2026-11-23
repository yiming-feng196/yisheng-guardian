"use strict";

// Presentation preferences affect the complete interface, including rem units.
function applyReadingSize(large) {
  document.documentElement.classList.toggle("text-large", large);
  document.body.classList.toggle("large-text", large);
  $("fontToggle").setAttribute("aria-pressed", String(large));
  $("fontToggle").textContent = large ? "标准字号" : "大字模式";
}
let savedReadingSize = false;
try { savedReadingSize = localStorage.getItem("yishengReadingSize") === "large"; } catch (_) {}
applyReadingSize(savedReadingSize);
$("fontToggle").addEventListener("click", () => {
  const large = !document.documentElement.classList.contains("text-large");
  applyReadingSize(large);
  try { localStorage.setItem("yishengReadingSize", large ? "large" : "standard"); } catch (_) {}
});

// The status reflects the actual conversation API, not just the static server.
let serviceCheckRunning = false;
async function checkConversationConnection(retry = false) {
  if (serviceCheckRunning) return;
  serviceCheckRunning = true;
  const status = $("serviceStatus");
  const button = $("serviceRetry");
  status.dataset.state = "connecting";
  status.textContent = "正在连接";
  button.disabled = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/assistant/conversations", { headers: assistantHeaders(), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error("unavailable");
    if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("unexpected response");
    const conversations = await response.json();
    if (!Array.isArray(conversations)) throw new Error("unexpected response");
    if (retry && !state.currentConversationId) await initializeAssistantConversations();
    const ready = Boolean(state.currentConversationId);
    status.dataset.state = ready ? "ready" : "connecting";
    status.textContent = ready ? "可以开始" : "正在准备对话";
    button.hidden = ready;
  } catch (_) {
    status.dataset.state = "offline";
    status.textContent = "连接中断";
    button.hidden = false;
  } finally {
    window.clearTimeout(timeout);
    serviceCheckRunning = false;
    button.disabled = false;
  }
}
$("recordLogin").addEventListener("click", () => { window.yishengReturnToRecords = true; switchTab("screening"); $("username").focus(); });
window.addEventListener("yisheng-conversation-ready", event => {
  if (event.detail) {
    $("serviceStatus").dataset.state = "ready";
    $("serviceStatus").textContent = "可以开始";
    $("serviceRetry").hidden = true;
  }
});
$("serviceRetry").addEventListener("click", () => checkConversationConnection(true));
checkConversationConnection();
window.setInterval(() => { if (!document.hidden) checkConversationConnection(); }, 30000);
window.addEventListener("online", () => checkConversationConnection(true));
window.addEventListener("offline", () => {
  $("serviceStatus").dataset.state = "offline";
  $("serviceStatus").textContent = "连接中断";
  $("serviceRetry").hidden = false;
});

$("chatInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    if (!$("chatSend").disabled && $("chatInput").value.trim()) $("chatForm").requestSubmit();
  }
});
function setCameraFit(full) {
  $("emotionPreview").dataset.fit = full ? "full" : "fill";
  $("cameraFitToggle").setAttribute("aria-pressed", String(full));
  $("cameraFitToggle").textContent = full ? "填满画面" : "显示完整画面";
}
let savedCameraFit = false;
try { savedCameraFit = localStorage.getItem("yishengCameraFit") === "full"; } catch (_) {}
setCameraFit(savedCameraFit);
$("cameraFitToggle").addEventListener("click", () => {
  const full = $("emotionPreview").dataset.fit !== "full";
  setCameraFit(full);
  try { localStorage.setItem("yishengCameraFit", full ? "full" : "fill"); } catch (_) {}
});
const emotionDetails = document.querySelector(".emotion-details");
$("emotionOverlay").hidden = !emotionDetails.open;
emotionDetails.addEventListener("toggle", () => { $("emotionOverlay").hidden = !emotionDetails.open; });

window.YiShengScreening = (() => {
  let current = 0;
  let reached = 0;
  let displayedResult = "";
  const pages = Array.from(document.querySelectorAll("[data-screening-page]"));
  const indicators = Array.from(document.querySelectorAll("[data-screening-step]"));
  function show(index, focus = true) {
    if (state.audioContext || state.screeningOpening) {
      setStatus($("screeningStatus"), "请先结束录音，再切换步骤。", "error");
      return;
    }
    current = index;
    reached = Math.max(reached, index);
    pages.forEach((page, i) => { page.hidden = i !== index; });
    indicators.forEach((button, i) => {
      button.disabled = i > reached;
      if (i === index) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    $("screeningPrevious").hidden = index === 0;
    $("screeningNext").hidden = index === 2;
    $("screeningNext").disabled = index === 0 && !$("consentCheckbox").checked;
    $("screeningNext").textContent = index === 3 ? "开始新的观察" : index === 0 ? "下一步：看图讲述" : "下一步：确认录音";
    if (focus && document.body.dataset.activeSection === "screening") pages[index].querySelector("h3")?.focus({ preventScroll: true });
  }
  function tasks(items) {
    const task = items.find(item => item.taskId === state.activeWizardTaskId);
    const card = $("screeningActiveTask");
    card.replaceChildren();
    card.hidden = !task;
    if (!task) return;
    const label = document.createElement("p");
    label.textContent = TASK_STATUS_LABELS[task.status] || "正在整理观察结果";
    card.append(label);
    if (task.status === "COMPLETED" && task.result && displayedResult !== task.taskId) {
      displayedResult = task.taskId;
      renderResult(task.result);
      setStatus($("screeningStatus"), "观察已完成，结果和建议如下。", "success");
    } else if (["FAILED", "CANCELLED"].includes(task.status)) {
      card.append(createButton("重新分析", "secondary-button", event => retryScreeningTask(task.taskId, event.currentTarget)));
    }
  }
  function recorded() {
    $("screeningRecordingSummary").textContent = state.durationSeconds > 0 ? `这段录音共 ${state.durationSeconds} 秒。试听后，保存并继续。` : "试听后，保存并继续。";
    show(2);
  }
  indicators.forEach((button, index) => button.addEventListener("click", () => { if (index <= reached) show(index); }));
  $("consentCheckbox").addEventListener("change", () => {
    if (!$("consentCheckbox").checked) { reached = 0; show(0, false); }
    else if (current === 0) $("screeningNext").disabled = false;
  });
  $("screeningPrevious").addEventListener("click", () => show(Math.max(0, current - 1)));
  $("screeningRerecord").addEventListener("click", () => {
    state.audioBlob = state.audioFile = null;
    $("audioFile").value = "";
    $("uploadAudio").disabled = true;
    show(1);
  });
  $("screeningNext").addEventListener("click", () => {
    if (current === 0 && !$("consentCheckbox").checked) return;
    if (current === 1 && !state.audioBlob && !state.audioFile) {
      setStatus($("screeningStatus"), "请先录音，或选择一段已有的 WAV 录音。", "error"); return;
    }
    if (current === 3) {
      state.activeWizardTaskId = null;
      displayedResult = "";
      $("screeningActiveTask").hidden = true;
      state.audioBlob = state.audioFile = null;
      state.durationSeconds = 0;
      $("audioFile").value = "";
      $("audioPreview").pause();
      $("audioPreview").removeAttribute("src");
      $("audioPreview").hidden = true;
      $("resultCard").hidden = true;
      $("uploadAudio").disabled = true;
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = "";
      reached = 0;
      setStatus($("screeningStatus"), "");
      show(0);
    } else show(current + 1);
  });
  show(0, false);
  $("imageSelect").addEventListener("change", () => {
    if (state.audioBlob || state.audioFile) {
      state.audioBlob = state.audioFile = null;
      $("audioFile").value = "";
      $("audioPreview").pause();
      $("audioPreview").removeAttribute("src");
      $("audioPreview").hidden = true;
      $("uploadAudio").disabled = true;
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = "";
      reached = 0;
      show(0, false);
      setStatus($("screeningStatus"), "图片已更换，请根据新图片重新讲述。");
    }
  });
  return { show, recorded, tasks };
})();
