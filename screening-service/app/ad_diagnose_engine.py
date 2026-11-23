from __future__ import annotations

import os
from pathlib import Path

from .engine import EngineResult, QualityOnlyEngine
from .quality import AudioQuality


class DeepSeekVoiceDiagnosisEngine:
    model_version = "deepseek-whisper-mfcc-v1"

    def analyze(self, audio_path: Path, quality: AudioQuality) -> EngineResult:
        return self.analyze_staged(audio_path, quality, lambda _stage: None)

    def analyze_staged(
        self, audio_path: Path, quality: AudioQuality, on_stage, check_cancelled=lambda: None
    ) -> EngineResult:
        from .ad_diagnose import (
            call_deepseek_api,
            extract_mfcc,
            extract_semantic_features,
            transcribe_audio,
        )

        check_cancelled()
        on_stage("TRANSCRIPTION")
        transcription = transcribe_audio(audio_path, check_cancelled)
        check_cancelled()
        on_stage("FEATURES")
        mfcc_features = extract_mfcc(audio_path)
        check_cancelled()
        semantic = extract_semantic_features(transcription)
        check_cancelled()
        on_stage("LLM")
        report = call_deepseek_api(transcription, mfcc_features, semantic)
        check_cancelled()
        highlights = [
            "已完成 Whisper 中文转写",
            "已提取 MFCC 声学特征",
        ]
        if isinstance(semantic, dict):
            ttr = semantic.get("ttr")
            avg_sentence_length = semantic.get("avg_sentence_length")
            if isinstance(ttr, (int, float)):
                highlights.append(f"词汇多样性 TTR={ttr:.2f}")
            if isinstance(avg_sentence_length, (int, float)):
                highlights.append(f"平均句长={avg_sentence_length:.2f}")
        if not quality.passed:
            highlights.extend(quality.issues)

        return EngineResult(
            transcription=transcription or "[未识别到有效语音]",
            report=report or "语音筛查报告生成失败，请重新采集或稍后再试。",
            risk_level="INCONCLUSIVE",
            risk_score=None,
            feature_highlights=highlights,
            model_version=self.model_version,
        )


class WhisperOnlyEngine:
    """Local transcription and descriptive features without an AI risk opinion."""

    model_version = "whisper-local-features-v1"

    def analyze(self, audio_path: Path, quality: AudioQuality) -> EngineResult:
        from .ad_diagnose import (
            extract_mfcc,
            extract_semantic_features,
            transcribe_audio,
        )

        transcription = transcribe_audio(audio_path)
        mfcc_features = extract_mfcc(audio_path)
        semantic = extract_semantic_features(transcription)
        highlights = [
            "已完成 Whisper 中文转写",
            "已在本地提取 MFCC 声学特征",
        ]
        if isinstance(semantic, dict):
            ttr = semantic.get("ttr")
            avg_sentence_length = semantic.get("avg_sentence_length")
            if isinstance(ttr, (int, float)):
                highlights.append(f"词汇多样性 TTR={ttr:.2f}")
            if isinstance(avg_sentence_length, (int, float)):
                highlights.append(f"平均句长={avg_sentence_length:.2f}")
        if not quality.passed:
            highlights.extend(quality.issues)

        report = (
            "已完成本地语音转写和描述性特征提取。当前未启用经过验证的认知风险模型，"
            "因此不提供风险分数或疾病判断；转写与特征仅供核对录音和辅助整理就医信息。"
        )
        if not quality.passed:
            report = "录音质量不足；已尽力完成本地转写，但结果可能不可靠，请根据质量提示重新采集。"

        return EngineResult(
            transcription=transcription or "[未识别到有效语音]",
            report=report,
            risk_level="INCONCLUSIVE",
            risk_score=None,
            feature_highlights=highlights,
            model_version=self.model_version,
        )


def create_whisper_engine():
    return WhisperOnlyEngine()


def create_engine():
    if not os.getenv("DEEPSEEK_API_KEY", "").strip():
        if os.getenv("SCREENING_REQUIRE_AI", "false").strip().lower() == "true":
            raise RuntimeError(
                "SCREENING_REQUIRE_AI=true，但未配置 DEEPSEEK_API_KEY；"
                "拒绝静默降级为仅录音质量检查"
            )
        return QualityOnlyEngine()
    return DeepSeekVoiceDiagnosisEngine()
