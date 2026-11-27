"""Loopback speech worker. Audio stays local for ASR; TTS sends text to Edge online speech."""
import asyncio
import io
import os
from pathlib import Path
from threading import Lock
from urllib.request import getproxies
from flask import Flask, jsonify, request, send_file

ROOT = Path(__file__).resolve().parent.parent
AUDIO = Path(os.getenv('AUDIO_STORAGE_DIR', str(ROOT / 'data/audio'))).resolve()
MODEL = os.getenv('VOICE_WHISPER_MODEL', 'small')
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 26 * 1024 * 1024
lock = Lock()
model = None

def tts_proxy():
    """Honor explicit configuration, then the OS/environment HTTP proxy."""
    configured = os.getenv('VOICE_TTS_PROXY', '').strip()
    if configured.lower() == 'direct':
        return None
    proxies = getproxies()
    return configured or proxies.get('https') or proxies.get('http') or None

def load_model():
    global model
    if model is None:
        from faster_whisper import WhisperModel
        model = WhisperModel(MODEL, device='cpu', compute_type='int8',
                             download_root=str(ROOT / '.runtime/voice-models'))
    return model

@app.get('/health')
def health():
    return jsonify(service='yisheng-voice', asrReady=model is not None,
                   model=MODEL, ttsEngine='edge-online', ttsRequiresInternet=True)

@app.post('/api/transcription')
def transcription():
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get('audio_path'), str):
        return jsonify(message='缺少音频路径'), 400
    path = Path(data['audio_path']).resolve()
    if not path.is_relative_to(AUDIO) or not path.is_file() or path.stat().st_size > 25*1024*1024:
        return jsonify(message='无效的录音文件'), 400
    if not lock.acquire(blocking=False):
        return jsonify(message='语音服务正在处理其他录音，请稍后重试'), 429
    try:
        segments, info = load_model().transcribe(str(path), language='zh', beam_size=5, vad_filter=True,
                                                condition_on_previous_text=False, initial_prompt='这是中文日常对话。数字伙伴的名字是小忆。')
        if info.duration > 65:
            return jsonify(message='请将录音控制在一分钟以内'), 400
        text = ''.join(s.text for s in segments).strip()
        if not text:
            return jsonify(message='没有识别到有效语音，请靠近麦克风重试'), 422
        return jsonify(transcription=text)
    except Exception:
        app.logger.exception('ASR failed')
        return jsonify(message='语音识别失败，请检查音频和本机模型'), 503
    finally:
        lock.release()

@app.post('/synthesize')
def synthesize():
    data = request.get_json(silent=True) or {}
    text = data.get('text')
    if not isinstance(text, str) or not 0 < len(text.strip()) <= 3000:
        return jsonify(message='朗读内容需要 1–3000 字'), 400
    async def generate():
        import edge_tts
        output = bytearray()
        async for chunk in edge_tts.Communicate(text.strip(), voice='zh-CN-XiaoxiaoNeural', rate='-5%',
                                               proxy=tts_proxy(), connect_timeout=8, receive_timeout=45).stream():
            if chunk['type'] == 'audio': output.extend(chunk['data'])
        return bytes(output)
    try:
        audio = asyncio.run(asyncio.wait_for(generate(), timeout=95))
        if len(audio) < 100: raise ValueError('Empty audio')
        response = send_file(io.BytesIO(audio), mimetype='audio/mpeg')
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception as error:
        # Third-party exceptions can include full URLs or proxy credentials.
        app.logger.warning('TTS failed (%s)', type(error).__name__)
        return jsonify(message='在线朗读服务连接失败，请检查电脑网络'), 503

if __name__ == '__main__':
    # Load and verify model before advertising ASR readiness.
    load_model()
    app.run(host='127.0.0.1', port=5010, threaded=True)
