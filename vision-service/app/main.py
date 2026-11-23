from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import cv2 as cv
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware


MODEL_DIR = Path(os.getenv("VISION_MODEL_DIR", Path(__file__).resolve().parents[1] / "models"))
FACE_MODEL = MODEL_DIR / "face_detection_yunet_2023mar.onnx"
EMOTION_MODEL = MODEL_DIR / "facial_expression_recognition_mobilefacenet_2022july.onnx"
MAX_IMAGE_BYTES = int(os.getenv("VISION_MAX_IMAGE_BYTES", "2500000"))
MAX_FACES = int(os.getenv("VISION_MAX_FACES", "5"))

EXPRESSIONS = (
    ("angry", "生气"),
    ("disgust", "厌恶"),
    ("fearful", "紧张"),
    ("happy", "愉悦"),
    ("neutral", "平静"),
    ("sad", "低落"),
    ("surprised", "惊讶"),
)


def _emotion_biases() -> np.ndarray:
    defaults = {
        "angry": 2.00,
        "disgust": 0.00,
        "fearful": 0.10,
        "happy": 0.00,
        "neutral": -0.60,
        "sad": 1.30,
        "surprised": 1.20,
    }
    configured = os.getenv("VISION_EMOTION_BIASES", "")
    for item in configured.split(","):
        if "=" not in item:
            continue
        name, value = item.split("=", 1)
        if name.strip() in defaults:
            defaults[name.strip()] = float(value)
    return np.array([defaults[name] for name, _ in EXPRESSIONS], dtype=np.float32)


EMOTION_TEMPERATURE = max(0.5, float(os.getenv("VISION_EMOTION_TEMPERATURE", "2.00")))
EMOTION_BIASES = _emotion_biases()
ANGER_DISGUST_GATE = float(os.getenv("VISION_ANGER_DISGUST_GATE", "0.17"))
ANGER_DISGUST_SAD_RATIO = float(os.getenv("VISION_ANGER_DISGUST_SAD_RATIO", "2.00"))


class EmotionEngine:
    """YuNet face detection plus MobileFaceNet expression classification."""

    _STANDARD_LANDMARKS = np.array(
        [
            [38.2946, 51.6963],
            [73.5318, 51.5014],
            [56.0252, 71.7366],
            [41.5493, 92.3655],
            [70.7299, 92.2041],
        ],
        dtype=np.float32,
    )

    def __init__(self) -> None:
        missing = [str(path) for path in (FACE_MODEL, EMOTION_MODEL) if not path.is_file()]
        if missing:
            raise RuntimeError(f"Missing vision model files: {', '.join(missing)}")

        self.detector = cv.FaceDetectorYN.create(
            str(FACE_MODEL),
            "",
            (320, 320),
            score_threshold=float(os.getenv("VISION_FACE_SCORE_THRESHOLD", "0.78")),
            nms_threshold=0.3,
            top_k=5000,
        )
        self.expression = cv.dnn.readNet(str(EMOTION_MODEL))
        self._lock = threading.Lock()

    @staticmethod
    def _softmax(values: np.ndarray) -> np.ndarray:
        shifted = values - np.max(values)
        exponentials = np.exp(shifted)
        return exponentials / np.sum(exponentials)

    def _align_face(self, image: np.ndarray, detection: np.ndarray) -> np.ndarray:
        landmarks = detection[4:14].reshape(5, 2).astype(np.float32)
        transform, _ = cv.estimateAffinePartial2D(
            landmarks,
            self._STANDARD_LANDMARKS,
            method=cv.LMEDS,
        )
        if transform is None:
            x, y, width, height = detection[:4].astype(int)
            x0, y0 = max(0, x), max(0, y)
            x1 = min(image.shape[1], x + width)
            y1 = min(image.shape[0], y + height)
            crop = image[y0:y1, x0:x1]
            if crop.size == 0:
                raise ValueError("empty face crop")
            return cv.resize(crop, (112, 112), interpolation=cv.INTER_AREA)
        return cv.warpAffine(image, transform, (112, 112), flags=cv.INTER_LINEAR)

    def _classify(self, aligned_face: np.ndarray) -> tuple[str, str, float]:
        rgb = cv.cvtColor(aligned_face, cv.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - 0.5) / 0.5
        blob = cv.dnn.blobFromImage(rgb)
        self.expression.setInput(blob, "data")
        raw = self.expression.forward(["label"])[0].reshape(-1)
        # RAF-DB models commonly over-select neutral on live CSI feeds. A
        # temperature plus explicit, configurable class biases makes brief
        # negative/surprised expressions easier to surface without retraining.
        calibrated = raw / EMOTION_TEMPERATURE + EMOTION_BIASES
        probabilities = self._softmax(calibrated)
        index = int(np.argmax(probabilities))
        # On live CSI images, a furrowed brow is often routed to the adjacent
        # "disgust" class while neutral remains narrowly on top. Treat that
        # pattern as anger when sadness is not the competing signal.
        if (
            index == 4
            and float(probabilities[1]) >= ANGER_DISGUST_GATE
            and float(probabilities[1]) >= float(probabilities[5]) * ANGER_DISGUST_SAD_RATIO
        ):
            confidence = min(
                0.88,
                max(float(probabilities[0]), 0.50 + (float(probabilities[1]) - ANGER_DISGUST_GATE) * 2.5),
            )
            return "angry", "生气", confidence
        key, label = EXPRESSIONS[index]
        return key, label, float(probabilities[index])

    def analyze(self, image: np.ndarray) -> dict:
        started = time.perf_counter()
        height, width = image.shape[:2]
        with self._lock:
            self.detector.setInputSize((width, height))
            _, detections = self.detector.detect(image)
            faces = []
            if detections is not None:
                detections = sorted(detections, key=lambda row: float(row[2] * row[3]), reverse=True)
                for detection in detections[:MAX_FACES]:
                    try:
                        key, label, confidence = self._classify(self._align_face(image, detection))
                    except (cv.error, ValueError, np.linalg.LinAlgError):
                        continue
                    x, y, face_width, face_height = detection[:4]
                    faces.append(
                        {
                            "bbox": [
                                max(0, int(round(x))),
                                max(0, int(round(y))),
                                max(1, int(round(face_width))),
                                max(1, int(round(face_height))),
                            ],
                            "emotion": key,
                            "label": label,
                            "confidence": round(confidence, 4),
                            "face_confidence": round(float(detection[-1]), 4),
                        }
                    )

        return {
            "faces": faces,
            "image_width": width,
            "image_height": height,
            "inference_ms": round((time.perf_counter() - started) * 1000, 1),
            "privacy": "memory-only",
        }


engine = EmotionEngine()
app = FastAPI(title="YiSheng Visual Emotion Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("VISION_ALLOWED_ORIGINS", "*").split(",")],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "opencv": cv.__version__,
        "detector": FACE_MODEL.name,
        "classifier": EMOTION_MODEL.name,
        "temperature": EMOTION_TEMPERATURE,
        "biases": {name: float(EMOTION_BIASES[index]) for index, (name, _) in enumerate(EXPRESSIONS)},
        "anger_disgust_gate": ANGER_DISGUST_GATE,
        "anger_disgust_sad_ratio": ANGER_DISGUST_SAD_RATIO,
        "storage": "disabled",
    }


@app.post("/v1/analyze")
async def analyze(request: Request) -> dict:
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="empty image body")
    if len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image body is too large")

    image = cv.imdecode(np.frombuffer(payload, dtype=np.uint8), cv.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="invalid JPEG or PNG image")
    if image.shape[0] < 64 or image.shape[1] < 64:
        raise HTTPException(status_code=400, detail="image is too small")

    return await run_in_threadpool(engine.analyze, image)
