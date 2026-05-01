#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PYTHON_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "找不到 Python。請安裝 Python 3.10 或以上。" >&2
  exit 1
fi

if [ ! -f "web/backend/requirements.txt" ]; then
  echo "找不到 web/backend/requirements.txt。請從 repo root 執行此腳本。" >&2
  exit 1
fi

if [ ! -d ".venv" ]; then
  "$PYTHON_CMD" -m venv .venv
fi

VENV_PYTHON=".venv/bin/python"
if [ ! -x "$VENV_PYTHON" ]; then
  echo "找不到 .venv/bin/python，虛擬環境建立失敗。" >&2
  exit 1
fi

"$VENV_PYTHON" -m pip install --upgrade pip
"$VENV_PYTHON" -m pip install -r web/backend/requirements.txt
