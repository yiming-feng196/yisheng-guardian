#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${SADTALKER_PYTHON:-/home/ubuntu22/miniforge3/envs/alz-sadtalker/bin/python}"

cd "$PROJECT_DIR/digital-human-service"
export PATH="$(dirname "$PYTHON_BIN"):$PATH"
exec "$PYTHON_BIN" -m uvicorn app:app --host 0.0.0.0 --port 8091
