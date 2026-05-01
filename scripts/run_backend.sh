#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -x ".venv/bin/python" ]; then
  PYTHON_CMD=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "找不到 Python。請先執行 scripts/setup_backend.sh，或安裝 Python 3.10 以上。" >&2
  exit 1
fi

if [ ! -f "web/backend/main.py" ]; then
  echo "找不到 web/backend/main.py。請從 repo root 執行此腳本。" >&2
  exit 1
fi

cd web
"$PYTHON_CMD" -m uvicorn backend.main:app --reload --port 8000
