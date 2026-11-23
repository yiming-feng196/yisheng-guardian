window.YISHENG_CONFIG = Object.assign({
  wakeApiBase: "",
  wakeSilenceMs: 1800,
  visionApiBase: `${window.location.protocol}//${window.location.hostname}:8092`,
  digitalHumanBaseUrl: `${window.location.protocol}//${window.location.hostname}:8091`,
  emotionAutoStart: false,
  cameraStreamUrl: "",
  preferredCameraLabel: "",
  emotionIntervalMs: 250,
  negativeEmotionHoldMs: 3000,
  negativeEmotionConfidence: 0.48,
  emotionComfortCooldownMs: 90000
}, window.YISHENG_CONFIG || {});
