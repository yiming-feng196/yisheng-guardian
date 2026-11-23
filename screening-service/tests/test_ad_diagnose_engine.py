from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from app.ad_diagnose_engine import (
    DeepSeekVoiceDiagnosisEngine,
    WhisperOnlyEngine,
    create_engine,
    create_whisper_engine,
)
from app.engine import QualityOnlyEngine


def test_factory_uses_safe_fallback_when_ai_is_optional(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setenv("SCREENING_REQUIRE_AI", "false")

    assert isinstance(create_engine(), QualityOnlyEngine)


def test_factory_rejects_silent_fallback_when_ai_is_required(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setenv("SCREENING_REQUIRE_AI", "true")

    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        create_engine()


def test_whisper_factory_does_not_require_deepseek(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    assert isinstance(create_whisper_engine(), WhisperOnlyEngine)


def test_whisper_only_engine_transcribes_without_calling_deepseek(monkeypatch):
    diagnosis = SimpleNamespace(
        transcribe_audio=lambda _audio_path: "这是一段测试转写",
        extract_mfcc=lambda _audio_path: [0.1] * 13,
        extract_semantic_features=lambda _text: {
            "ttr": 0.75,
            "avg_sentence_length": 8.0,
        },
    )
    monkeypatch.setitem(sys.modules, "app.ad_diagnose", diagnosis)

    quality = type("Quality", (), {"passed": True, "issues": []})()
    result = WhisperOnlyEngine().analyze(None, quality)

    assert result.transcription == "这是一段测试转写"
    assert result.risk_level == "INCONCLUSIVE"
    assert result.risk_score is None
    assert result.model_version == "whisper-local-features-v1"


def test_staged_analysis_stops_after_transcription_when_cancelled(monkeypatch):
    cancelled = False
    feature_extraction_started = False

    def transcribe(_audio_path, _check_cancelled):
        nonlocal cancelled
        cancelled = True
        return "测试转写"

    def extract_mfcc(_audio_path):
        nonlocal feature_extraction_started
        feature_extraction_started = True
        return []

    def check_cancelled():
        if cancelled:
            raise RuntimeError("cancelled")

    diagnosis = SimpleNamespace(
        transcribe_audio=transcribe,
        extract_mfcc=extract_mfcc,
        extract_semantic_features=lambda _text: {},
        call_deepseek_api=lambda _text, _mfcc, _semantic: "report",
    )
    monkeypatch.setitem(sys.modules, "app.ad_diagnose", diagnosis)

    quality = type("Quality", (), {"passed": True, "issues": []})()
    with pytest.raises(RuntimeError, match="cancelled"):
        DeepSeekVoiceDiagnosisEngine().analyze_staged(
            None, quality, lambda _stage: None, check_cancelled
        )

    assert feature_extraction_started is False
