#!/bin/sh
set -eu

PROJECT_DIR=/home/ubuntu22/Documents/Codex/2026-10-09/new-chat/work/alzheimers-voice-assistant/vision-service
PYTHON_BIN=/home/ubuntu22/miniforge3/envs/alz-sadtalker/bin/python

cd "$PROJECT_DIR"
export PYTHONPATH="$PROJECT_DIR"
exec "$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port "${VISION_PORT:-8092}" --workers 1
