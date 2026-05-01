#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node。請安裝 Node.js LTS，建議使用 Node 24；可參考 ENV_SETUP.zh-TW.md。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "找不到 npm。請確認 Node.js/npm 已安裝並加入 PATH。" >&2
  exit 1
fi

if [ ! -f "web/frontend/package.json" ]; then
  echo "找不到 web/frontend/package.json。請從 repo root 執行此腳本。" >&2
  exit 1
fi

cd web/frontend
npm install
