from __future__ import annotations

import asyncio
import html
import os
import re
import subprocess
import sys
import threading
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Literal, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EDGE_TTS_RUNTIME = Path(os.getenv(
    "EDGE_TTS_RUNTIME",
    PROJECT_ROOT / ".runtime" / "edge-tts-py38",
)).resolve()
if EDGE_TTS_RUNTIME.is_dir() and str(EDGE_TTS_RUNTIME) not in sys.path:
    sys.path.insert(0, str(EDGE_TTS_RUNTIME))

import edge_tts
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


SHERPA_RUNTIME = Path(os.getenv(
    "SHERPA_RUNTIME",
    PROJECT_ROOT / ".runtime" / "sherpa-runtime-py38",
)).resolve()
MELO_MODEL_ROOT = Path(os.getenv(
    "MELO_TTS_MODEL",
    PROJECT_ROOT / ".runtime" / "tts-models" / "vits-melo-tts-zh_en",
)).resolve()
KOKORO_MODEL_ROOT = Path(os.getenv(
    "KOKORO_TTS_MODEL",
    PROJECT_ROOT / ".runtime" / "tts-models" / "kokoro-multi-lang-v1_1",
)).resolve()
KOKORO_SPEAKER_ID = int(os.getenv("KOKORO_SPEAKER_ID", "3"))
if SHERPA_RUNTIME.is_dir() and str(SHERPA_RUNTIME) not in sys.path:
    sys.path.insert(0, str(SHERPA_RUNTIME))
try:
    import sherpa_onnx
except ImportError:
    sherpa_onnx = None

SADTALKER_ROOT = Path(os.getenv("SADTALKER_ROOT", PROJECT_ROOT / ".runtime" / "SadTalker")).resolve()
PYTHON_BIN = Path(os.getenv(
    "SADTALKER_PYTHON",
    "/home/ubuntu22/miniforge3/envs/alz-sadtalker/bin/python",
)).resolve()
FFMPEG_BIN = Path(os.getenv(
    "SADTALKER_FFMPEG",
    "/home/ubuntu22/miniforge3/envs/alz-sadtalker/bin/ffmpeg",
)).resolve()
PIPER_PYTHON = Path(os.getenv("PIPER_PYTHON", "/usr/bin/python3")).resolve()
PIPER_RUNTIME = Path(os.getenv(
    "PIPER_RUNTIME",
    PROJECT_ROOT / ".runtime" / "piper-runtime",
)).resolve()
PIPER_MODEL = Path(os.getenv(
    "PIPER_MODEL",
    PROJECT_ROOT / ".runtime" / "piper-voices" / "zh_CN-huayan-medium.onnx",
)).resolve()
PIPER_CONFIG = Path(os.getenv(
    "PIPER_CONFIG",
    f"{PIPER_MODEL}.json",
)).resolve()
AVATAR_IMAGE = Path(os.getenv(
    "DIGITAL_HUMAN_AVATAR",
    PROJECT_ROOT / "backend" / "src" / "main" / "resources" / "static" / "avatar-hero-v1.png",
)).resolve()
DATA_ROOT = Path(os.getenv("DIGITAL_HUMAN_DATA", PROJECT_ROOT / "digital-human-data")).resolve()
VOICE = os.getenv("DIGITAL_HUMAN_VOICE", "zh-CN-XiaoxiaoNeural")

DATA_ROOT.mkdir(parents=True, exist_ok=True)


class RenderRequest(BaseModel):
    text: str = Field(min_length=1, max_length=800)


class RenderJob(BaseModel):
    id: str
    status: Literal["QUEUED", "SYNTHESIZING", "RENDERING", "COMPLETED", "FAILED"]
    message: str
    video_url: Optional[str] = None


class SpeechResult(BaseModel):
    id: str
    message: str
    engine: str
    audio_url: str


app = FastAPI(title="Alzheimer Voice Assistant Digital Human", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

jobs: Dict[str, RenderJob] = {}
jobs_lock = threading.Lock()
render_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="digital-human")
melo_init_lock = threading.Lock()
melo_generate_lock = threading.Lock()
melo_tts = None
kokoro_init_lock = threading.Lock()
kokoro_generate_lock = threading.Lock()
kokoro_tts = None


def required_model_files() -> List[Path]:
    checkpoint_dir = SADTALKER_ROOT / "checkpoints"
    return [
        checkpoint_dir / "mapping_00109-model.pth.tar",
        checkpoint_dir / "mapping_00229-model.pth.tar",
        checkpoint_dir / "SadTalker_V0.0.2_512.safetensors",
    ]


def model_ready() -> bool:
    expected_sizes = {
        "mapping_00109-model.pth.tar": 155_779_231,
        "mapping_00229-model.pth.tar": 155_521_183,
        "SadTalker_V0.0.2_512.safetensors": 725_066_984,
    }
    return all(
        path.is_file() and path.stat().st_size == expected_sizes[path.name]
        for path in required_model_files()
    )


def update_job(job_id: str, status: str, message: str, video_url: Optional[str] = None) -> None:
    with jobs_lock:
        jobs[job_id] = RenderJob(id=job_id, status=status, message=message, video_url=video_url)


def piper_ready() -> bool:
    return all(path.is_file() for path in (PIPER_PYTHON, PIPER_MODEL, PIPER_CONFIG)) and PIPER_RUNTIME.is_dir()


def melo_ready() -> bool:
    required = [
        MELO_MODEL_ROOT / "model.onnx",
        MELO_MODEL_ROOT / "lexicon.txt",
        MELO_MODEL_ROOT / "tokens.txt",
        MELO_MODEL_ROOT / "date.fst",
        MELO_MODEL_ROOT / "phone.fst",
        MELO_MODEL_ROOT / "number.fst",
    ]
    return sherpa_onnx is not None and all(path.is_file() for path in required)


def kokoro_ready() -> bool:
    required = [
        KOKORO_MODEL_ROOT / "model.onnx",
        KOKORO_MODEL_ROOT / "voices.bin",
        KOKORO_MODEL_ROOT / "tokens.txt",
        KOKORO_MODEL_ROOT / "espeak-ng-data",
        KOKORO_MODEL_ROOT / "lexicon-us-en.txt",
        KOKORO_MODEL_ROOT / "lexicon-zh.txt",
        KOKORO_MODEL_ROOT / "date-zh.fst",
        KOKORO_MODEL_ROOT / "phone-zh.fst",
        KOKORO_MODEL_ROOT / "number-zh.fst",
    ]
    return sherpa_onnx is not None and all(path.exists() for path in required)


def get_kokoro_tts():
    global kokoro_tts
    if kokoro_tts is not None:
        return kokoro_tts
    with kokoro_init_lock:
        if kokoro_tts is not None:
            return kokoro_tts
        if not kokoro_ready():
            raise RuntimeError("Kokoro 中文语音模型未安装")
        model_config = sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(KOKORO_MODEL_ROOT / "model.onnx"),
                voices=str(KOKORO_MODEL_ROOT / "voices.bin"),
                tokens=str(KOKORO_MODEL_ROOT / "tokens.txt"),
                data_dir=str(KOKORO_MODEL_ROOT / "espeak-ng-data"),
                lexicon=",".join((
                    str(KOKORO_MODEL_ROOT / "lexicon-us-en.txt"),
                    str(KOKORO_MODEL_ROOT / "lexicon-zh.txt"),
                )),
            ),
            num_threads=4,
            debug=False,
            provider="cpu",
        )
        config = sherpa_onnx.OfflineTtsConfig(
            model=model_config,
            rule_fsts=",".join(str(KOKORO_MODEL_ROOT / name) for name in (
                "date-zh.fst", "phone-zh.fst", "number-zh.fst",
            )),
            max_num_sentences=1,
        )
        if not config.validate():
            raise RuntimeError("Kokoro 中文语音配置无效")
        kokoro_tts = sherpa_onnx.OfflineTts(config)
        return kokoro_tts


def get_melo_tts():
    global melo_tts
    if melo_tts is not None:
        return melo_tts
    with melo_init_lock:
        if melo_tts is not None:
            return melo_tts
        if not melo_ready():
            raise RuntimeError("MeloTTS 中文语音模型未安装")
        model_config = sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(MELO_MODEL_ROOT / "model.onnx"),
                lexicon=str(MELO_MODEL_ROOT / "lexicon.txt"),
                tokens=str(MELO_MODEL_ROOT / "tokens.txt"),
                noise_scale=0.667,
                noise_scale_w=0.8,
                length_scale=1.0,
            ),
            num_threads=4,
            debug=False,
            provider="cpu",
        )
        config = sherpa_onnx.OfflineTtsConfig(
            model=model_config,
            rule_fsts=",".join(str(MELO_MODEL_ROOT / name) for name in (
                "date.fst", "phone.fst", "number.fst",
            )),
            max_num_sentences=1,
        )
        if not config.validate():
            raise RuntimeError("MeloTTS 中文语音配置无效")
        melo_tts = sherpa_onnx.OfflineTts(config)
        return melo_tts


def normalize_speech_text(text: str) -> str:
    value = html.unescape(str(text or ""))
    value = re.sub(r"!\[([^]]*)]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^]]+)]\([^)]*\)", r"\1", value)
    value = re.sub(r"https?://\S+", "", value)
    value = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", value)
    value = re.sub(r"(?m)^\s*(?:[-*•]+|\d+[.)、])\s*", "。", value)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"\n{2,}", "。", value)
    value = re.sub(r"\n", "；", value)
    value = re.sub(r"[*_`~>|]", "", value)
    value = value.translate(str.maketrans({
        ",": "，", ":": "：", ";": "；", "!": "！", "?": "？",
        "(": "（", ")": "）",
    }))
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"(?<=[\u3400-\u9fff]) (?=[\u3400-\u9fff])", "", value)
    value = re.sub(r"[。；，]{2,}", lambda match: match.group(0)[-1], value)
    value = re.sub(r"([，；：])(?=。)", "", value)
    value = value.strip("，；：。 ")
    if value and value[-1] not in "。！？":
        value += "。"
    return value


def synthesize_with_kokoro(text: str, wav_path: Path) -> None:
    normalized = normalize_speech_text(text)
    if not normalized:
        raise RuntimeError("没有可朗读的中文内容")
    generation = sherpa_onnx.GenerationConfig()
    generation.sid = KOKORO_SPEAKER_ID
    generation.speed = 1.02
    # Keep sentence pauses conversational. Kokoro's default silence is too
    # long for an interactive companion when answers contain several clauses.
    generation.silence_scale = 0.55
    with kokoro_generate_lock:
        audio = get_kokoro_tts().generate(normalized, config=generation)
    samples = np.asarray(audio.samples, dtype=np.float32)
    if samples.size < 256:
        raise RuntimeError("Kokoro 没有生成有效语音")
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(str(wav_path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(audio.sample_rate)
        output.writeframes(pcm.tobytes())


def synthesize_with_melo(text: str, wav_path: Path) -> None:
    normalized = normalize_speech_text(text)
    if not normalized:
        raise RuntimeError("没有可朗读的中文内容")
    with melo_generate_lock:
        audio = get_melo_tts().generate(normalized, sid=0, speed=1.0)
    samples = np.asarray(audio.samples, dtype=np.float32)
    if samples.size < 256:
        raise RuntimeError("MeloTTS 没有生成有效语音")
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(str(wav_path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(audio.sample_rate)
        output.writeframes(pcm.tobytes())


def synthesize_with_piper(text: str, wav_path: Path) -> None:
    if not piper_ready():
        raise RuntimeError("本地 Piper 中文语音模型未安装")
    piper_env = os.environ.copy()
    python_path = str(PIPER_RUNTIME)
    if piper_env.get("PYTHONPATH"):
        python_path = f"{python_path}{os.pathsep}{piper_env['PYTHONPATH']}"
    piper_env["PYTHONPATH"] = python_path
    subprocess.run(
        [
            str(PIPER_PYTHON), "-m", "piper",
            "--model", str(PIPER_MODEL),
            "--config", str(PIPER_CONFIG),
            "--output-file", str(wav_path),
            "--length-scale", "1.05",
            "--sentence-silence", "0.16",
            "--volume", "1.12",
        ],
        input=f"{text}\n",
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
        env=piper_env,
    )
    if not wav_path.is_file() or wav_path.stat().st_size < 1024:
        raise RuntimeError("本地 Piper 没有生成有效语音")


def synthesize_with_edge_neural(text: str, mp3_path: Path) -> None:
    normalized = normalize_speech_text(text)
    if not normalized:
        raise RuntimeError("没有可朗读的中文内容")

    async def generate() -> None:
        communicator = edge_tts.Communicate(
            text=normalized,
            voice=VOICE,
            rate="-2%",
            pitch="+0Hz",
        )
        await communicator.save(str(mp3_path))

    asyncio.run(generate())
    if not mp3_path.is_file() or mp3_path.stat().st_size < 1024:
        raise RuntimeError("普通话神经语音没有生成有效音频")


def synthesize_realtime_speech(job_id: str, text: str) -> SpeechResult:
    job_dir = DATA_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    wav_path = job_dir / "speech-realtime.wav"
    mp3_path = job_dir / "speech-realtime.mp3"
    try:
        local_fallback = False
        try:
            synthesize_with_edge_neural(text, mp3_path)
            engine = f"Microsoft {VOICE}"
        except Exception as edge_error:
            print(f"Neural voice unavailable, using local fallback: {edge_error}", flush=True)
            mp3_path.unlink(missing_ok=True)
            local_fallback = True
            if kokoro_ready():
                synthesize_with_kokoro(text, wav_path)
                engine = f"Kokoro multi-lang v1.1 sid-{KOKORO_SPEAKER_ID}"
            elif melo_ready():
                synthesize_with_melo(text, wav_path)
                engine = "MeloTTS zh_en"
            else:
                synthesize_with_piper(normalize_speech_text(text), wav_path)
                engine = "Piper zh_CN-huayan-medium"
        if local_fallback:
            subprocess.run(
                [
                    str(FFMPEG_BIN), "-y", "-i", str(wav_path),
                    "-codec:a", "libmp3lame", "-b:a", "128k",
                    "-ac", "1", str(mp3_path),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
        if not mp3_path.is_file() or mp3_path.stat().st_size < 1024:
            raise RuntimeError("没有生成有效的实时语音")
        return SpeechResult(
            id=job_id,
            message="自然普通话语音已生成",
            engine=engine,
            audio_url=f"/v1/speech/{job_id}/audio",
        )
    except Exception:
        mp3_path.unlink(missing_ok=True)
        raise
    finally:
        wav_path.unlink(missing_ok=True)


@app.on_event("startup")
def warm_up_natural_voice() -> None:
    try:
        if kokoro_ready():
            get_kokoro_tts()
        elif melo_ready():
            get_melo_tts()
    except Exception as error:
        print(f"Natural TTS warm-up failed: {error}", flush=True)


async def synthesize_speech(text: str, mp3_path: Path, wav_path: Path) -> str:
    edge_error: Optional[Exception] = None
    try:
        communicator = edge_tts.Communicate(text=text, voice=VOICE, rate="-4%", pitch="-2Hz")
        await communicator.save(str(mp3_path))
        if not mp3_path.is_file() or mp3_path.stat().st_size < 1024:
            raise RuntimeError("Edge TTS 没有生成有效语音")
    except Exception as error:
        edge_error = error
        mp3_path.unlink(missing_ok=True)

    if edge_error is not None:
        try:
            synthesize_with_piper(text, wav_path)
            return "本地中文语音"
        except Exception as piper_error:
            raise RuntimeError(
                f"联网语音失败（{edge_error}）；本地语音失败（{piper_error}）"
            ) from piper_error

    subprocess.run(
        [str(FFMPEG_BIN), "-y", "-i", str(mp3_path), "-ar", "16000", "-ac", "1", str(wav_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return "联网中文语音"


def render_video(job_id: str, text: str) -> None:
    job_dir = DATA_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    mp3_path = job_dir / "speech.mp3"
    wav_path = job_dir / "speech.wav"
    result_dir = job_dir / "result"
    result_dir.mkdir(exist_ok=True)
    try:
        update_job(job_id, "SYNTHESIZING", "正在生成中文语音")
        speech_engine = asyncio.run(synthesize_speech(text, mp3_path, wav_path))
        update_job(job_id, "RENDERING", f"{speech_engine}已生成，正在生成口型、表情和头部动作")
        command = [
            str(PYTHON_BIN),
            "inference.py",
            "--driven_audio", str(wav_path),
            "--source_image", str(AVATAR_IMAGE),
            "--checkpoint_dir", str(SADTALKER_ROOT / "checkpoints"),
            "--result_dir", str(result_dir),
            "--size", "512",
            "--preprocess", "full",
            "--expression_scale", "1.05",
            "--pose_style", "5",
            "--batch_size", "1",
        ]
        render_env = os.environ.copy()
        render_env["PATH"] = f"{FFMPEG_BIN.parent}:{render_env.get('PATH', '')}"
        completed = subprocess.run(
            command,
            cwd=SADTALKER_ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=600,
            env=render_env,
        )
        (job_dir / "render.log").write_text(
            completed.stdout + "\n" + completed.stderr,
            encoding="utf-8",
        )
        outputs = sorted(result_dir.glob("*.mp4"), key=lambda path: path.stat().st_mtime, reverse=True)
        if not outputs:
            raise RuntimeError("数字人引擎没有生成视频文件")
        # SadTalker's raw 1024x1536 MPEG-4 output is far larger than the web
        # card and can be decoded on the browser's rendering path.  Re-encode
        # it once as a smaller, broadly hardware-accelerated H.264 file.
        # Keep the raw file in result/ for diagnostics.
        final_path = job_dir / "avatar.mp4"
        subprocess.run(
            [
                str(FFMPEG_BIN), "-y", "-i", str(outputs[0]),
                "-vf", "scale=640:-2:flags=lanczos",
                "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-c:a", "aac", "-b:a", "128k",
                str(final_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        update_job(job_id, "COMPLETED", "数字人视频已生成", f"/v1/renders/{job_id}/video")
    except subprocess.CalledProcessError as error:
        details = "\n".join((error.stderr or error.stdout or "").strip().splitlines()[-8:])
        (job_dir / "render.log").write_text(
            (error.stdout or "") + "\n" + (error.stderr or ""),
            encoding="utf-8",
        )
        update_job(job_id, "FAILED", f"生成失败：{details or error}")
    except Exception as error:
        update_job(job_id, "FAILED", f"生成失败：{error}")


@app.get("/health")
def health() -> Dict[str, object]:
    return {
        "status": "UP",
        "engine": "SadTalker",
        "model_ready": model_ready(),
        "avatar_ready": AVATAR_IMAGE.is_file(),
        "offline_tts_ready": piper_ready(),
        "offline_tts_voice": PIPER_MODEL.stem if piper_ready() else None,
        "natural_tts_ready": kokoro_ready() or melo_ready(),
        "realtime_voice": f"Microsoft {VOICE}",
        "offline_voice_fallback": (
            f"Kokoro multi-lang v1.1 sid-{KOKORO_SPEAKER_ID}"
            if kokoro_ready()
            else "MeloTTS zh_en" if melo_ready()
            else "Piper zh_CN-huayan-medium"
        ),
        "cuda_python": str(PYTHON_BIN),
    }


@app.post("/v1/speech", response_model=SpeechResult)
def create_speech(request: RenderRequest) -> SpeechResult:
    if not piper_ready():
        raise HTTPException(status_code=503, detail="本地中文语音模型尚未安装完成")
    job_id = uuid.uuid4().hex
    try:
        return synthesize_realtime_speech(job_id, request.text.strip())
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"本地语音生成失败：{error}") from error


@app.get("/v1/speech/{job_id}/audio")
def get_speech_audio(job_id: str) -> FileResponse:
    if len(job_id) != 32 or any(char not in "0123456789abcdef" for char in job_id):
        raise HTTPException(status_code=404, detail="未找到语音")
    path = DATA_ROOT / job_id / "speech-realtime.mp3"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="语音尚未生成")
    return FileResponse(path, media_type="audio/mpeg", filename=f"speech-{job_id}.mp3")


@app.post("/v1/renders", status_code=202, response_model=RenderJob)
def create_render(request: RenderRequest) -> RenderJob:
    if not model_ready():
        raise HTTPException(status_code=503, detail="数字人模型仍在下载或尚未安装完成")
    if not AVATAR_IMAGE.is_file():
        raise HTTPException(status_code=503, detail="数字人头像文件不存在")
    job_id = uuid.uuid4().hex
    job = RenderJob(id=job_id, status="QUEUED", message="已进入数字人生成队列")
    with jobs_lock:
        jobs[job_id] = job
    render_pool.submit(render_video, job_id, request.text.strip())
    return job


@app.get("/v1/renders/{job_id}", response_model=RenderJob)
def get_render(job_id: str) -> RenderJob:
    with jobs_lock:
        job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="未找到数字人生成任务")
    return job


@app.get("/v1/renders/{job_id}/video")
def get_render_video(job_id: str) -> FileResponse:
    path = DATA_ROOT / job_id / "avatar.mp4"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="视频尚未生成")
    return FileResponse(path, media_type="video/mp4", filename=f"avatar-{job_id}.mp4")
