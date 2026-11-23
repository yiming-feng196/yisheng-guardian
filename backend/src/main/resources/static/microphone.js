"use strict";

// Jetson's PulseAudio device exposes only the valid ICS43434 left slot.
// Processing stays in memory and feeds both WAV screening and MediaRecorder.
window.YiShengAudio = {
  async openMicrophone(config = {}) {
    let rawStream = null;
    let context = null;
    let destination = null;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      rawStream?.getTracks().forEach((track) => track.stop());
      destination?.stream.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close();
    };
    try {
      const jetson = Boolean(config.microphoneDeviceLabel);
      const audio = jetson
        ? { channelCount: 1, sampleRate: 48000, echoCancellation: false,
            noiseSuppression: false, autoGainControl: false }
        : { channelCount: 1, echoCancellation: true, noiseSuppression: true,
            autoGainControl: true };
      rawStream = await navigator.mediaDevices.getUserMedia({ audio });
      if (!jetson) return { stream: rawStream, release };

      const label = String(config.microphoneDeviceLabel).toLowerCase();
      const devices = await navigator.mediaDevices.enumerateDevices();
      const matches = devices.filter((device) => device.kind === "audioinput"
        && device.label.toLowerCase().endsWith(label));
      const preferred = matches.find((device) => !["default", "communications"].includes(device.deviceId)) || matches[0];
      if (!preferred) throw new Error("未找到忆声麦克风，请检查 Jetson 音频服务。");
      if (rawStream.getAudioTracks()[0]?.getSettings().deviceId !== preferred.deviceId) {
        rawStream.getTracks().forEach((track) => track.stop());
        rawStream = await navigator.mediaDevices.getUserMedia({
          audio: { ...audio, deviceId: { exact: preferred.deviceId } }
        });
      }
      context = new AudioContext({ sampleRate: 48000 });
      const input = context.createMediaStreamSource(rawStream);
      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80;
      highpass.Q.value = Math.SQRT1_2;
      const gain = context.createGain();
      gain.gain.value = Math.min(20, Math.max(1, Number(config.microphoneGain) || 1));
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      destination = context.createMediaStreamDestination();
      destination.channelCount = 1;
      input.connect(highpass).connect(gain).connect(limiter).connect(destination);
      // No connection to speakers: recording must not produce microphone feedback.
      await context.resume();
      return { stream: destination.stream, release };
    } catch (error) {
      await release();
      throw error;
    }
  }
};
