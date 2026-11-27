const MAX_DURATION_MS = 300000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
let recorder;
let capture;

function discardFile(filePath) {
  if (filePath) wx.getFileSystemManager().unlink({ filePath, fail() {} });
}

function logInvalidRecording(data, tempFilePath, error) {
  if (wx.getAccountInfoSync?.()?.miniProgram?.envVersion !== 'develop') return;
  const header = new Uint8Array(data, 0, Math.min(32, data.byteLength));
  console.warn('[recorder] 文件校验失败', {
    bytes: data.byteLength,
    extension: tempFilePath.match(/\.([a-z0-9]+)$/i)?.[1] || '',
    header: Array.from(header, (byte) => byte.toString(16).padStart(2, '0')).join(' '),
    message: error.message
  });
}

function readDuration(buffer) {
  if (buffer.byteLength < 44 || buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error('录音文件为空、损坏或超过 25 MB');
  }
  const view = new DataView(buffer);
  const fourCC = (offset) => view.getUint32(offset);
  const end = view.getUint32(4, true) + 8;
  if (fourCC(0) !== 0x52494646 || fourCC(8) !== 0x57415645 || end > view.byteLength) {
    throw new Error('设备返回的音频不是有效的 WAV 格式');
  }
  let bytesPerFrame = 0;
  let sampleRate = 0;
  let audioBytes = 0;
  for (let offset = 12; offset + 8 <= end;) {
    const chunk = fourCC(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > end) throw new Error('录音文件不完整');
    if (chunk === 0x666d7420 && size >= 16) {
      const encoding = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bytesPerFrame = view.getUint16(body + 12, true);
      const bits = view.getUint16(body + 14, true);
      if (encoding !== 1 || channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 48000
          || ![8, 16, 24, 32].includes(bits) || bytesPerFrame !== channels * bits / 8) {
        throw new Error('设备返回的录音格式与后端要求不兼容');
      }
    }
    if (chunk === 0x64617461) audioBytes = size;
    offset = body + size + (size % 2);
  }
  if (!bytesPerFrame || audioBytes % bytesPerFrame !== 0) throw new Error('录音数据不完整');
  const seconds = audioBytes / bytesPerFrame / sampleRate;
  if (seconds < 1) throw new Error('录音至少需要 1 秒');
  if (seconds > MAX_DURATION_MS / 1000) throw new Error('录音不能超过 5 分钟');
  return Math.floor(seconds * 1000);
}

// Some devices count the 44-byte PCM header twice when finalizing the file.
function repairPcmLength(buffer) {
  const headerBytes = 44;
  if (buffer.byteLength < headerBytes || buffer.byteLength > MAX_FILE_BYTES) return false;
  const view = new DataView(buffer);
  const audioBytes = buffer.byteLength - headerBytes;
  const declaredAudioBytes = view.getUint32(40, true);
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645
      || view.getUint32(12) !== 0x666d7420 || view.getUint32(16, true) !== 16
      || view.getUint32(36) !== 0x64617461 || audioBytes === 0 || audioBytes % 2 !== 0
      || view.getUint32(4, true) + 8 !== buffer.byteLength + headerBytes
      || ![audioBytes, buffer.byteLength].includes(declaredAudioBytes)) return false;
  const sampleRate = view.getUint32(24, true);
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
      || sampleRate !== 16000 || view.getUint32(28, true) !== sampleRate * 2
      || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16) return false;
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(40, audioBytes, true);
  return true;
}

function inspectRecording({ tempFilePath, fileSize, duration: reportedDuration }, { allowDevtoolsWebm = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath || fileSize > MAX_FILE_BYTES) {
      reject(new Error('录音未生成或超过 25 MB'));
      return;
    }
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: tempFilePath,
      success({ data }) {
        try {
          if (wx.getDeviceInfo?.().platform === 'devtools' && data.byteLength >= 4
              && data.byteLength <= MAX_FILE_BYTES && new DataView(data).getUint32(0) === 0x1a45dfa3) {
            if (!allowDevtoolsWebm) throw new Error('观察需要标准 WAV 录音，请在手机真机录制');
            if (reportedDuration < 1000) throw new Error('录音至少需要 1 秒');
            resolve({ path: tempFilePath, duration: reportedDuration, format: 'webm' });
            return;
          }
          const repaired = repairPcmLength(data);
          const duration = readDuration(data);
          if (!repaired) {
            resolve({ path: tempFilePath, duration });
            return;
          }
          const path = wx.env.USER_DATA_PATH + '/recording-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.wav';
          fs.writeFile({
            filePath: path,
            data,
            success: () => resolve({ path, duration }),
            fail() {
              discardFile(path);
              reject(new Error('无法保存修复后的录音，请重新录制'));
            }
          });
        } catch (error) {
          logInvalidRecording(data, tempFilePath, error);
          reject(error);
        }
      },
      fail() { reject(new Error('无法读取录音，请重新录制')); }
    });
  });
}

function getRecorder() {
  if (recorder) return recorder;
  recorder = wx.getRecorderManager();
  recorder.onStart(() => {
    if (capture && !capture.cancelled) capture.started();
    else if (capture) recorder.stop();
  });
  recorder.onPause?.(() => { if (capture && !capture.cancelled) capture.paused(); });
  recorder.onResume?.(() => { if (capture && !capture.cancelled) capture.resumed(); });
  recorder.onStop((result) => {
    const current = capture;
    capture = null;
    if (!current || current.cancelled) return discardFile(result.tempFilePath);
    return current.stopped(result);
  });
  recorder.onError(() => {
    const current = capture;
    capture = null;
    if (current && !current.cancelled) current.failed('录音设备出现问题，请检查系统麦克风权限后重试');
  });
  recorder.onInterruptionBegin?.(() => cancel('录音被系统打断，请重新录制'));
  return recorder;
}

function start(handlers, options = {}) {
  if (capture) throw new Error('麦克风正在结束上一次录音，请稍后重试');
  const manager = getRecorder();
  capture = { ...handlers, cancelled: false };
  try {
    manager.start({ format: 'wav', duration: MAX_DURATION_MS, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, ...options });
  } catch (error) {
    capture = null;
    throw error;
  }
}

function cancel(message) {
  if (!capture || capture.cancelled) return;
  capture.cancelled = true;
  if (message) capture.failed(message);
  recorder.stop();
}

module.exports = {
  start, cancel, inspectRecording, discardFile,
  pause() { recorder.pause(); },
  isBusy() { return Boolean(capture); },
  resume() { recorder.resume(); },
  stop() { recorder.stop(); }
};
