#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

PYTHON_BIN="$(command -v python3)"
if [ -z "$PYTHON_BIN" ] && [ -x /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 ]; then
    PYTHON_BIN="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
fi

if [ -z "$PYTHON_BIN" ]; then
    echo "找不到 python3，請先安裝 Python 3。"
    read -r -p "按 Enter 結束..."
    exit 1
fi

if ! "$PYTHON_BIN" -m streamlit --version >/dev/null 2>&1; then
    echo "目前的 Python 沒有安裝 Streamlit。"
    echo "請先執行：$PYTHON_BIN -m pip install -r requirements.txt"
    read -r -p "按 Enter 結束..."
    exit 1
fi

# 關掉舊的 streamlit（避免衝突）
pkill -f "streamlit run app.py" 2>/dev/null
sleep 1

echo "啟動 Spectroscopy Data Processing GUI..."
"$PYTHON_BIN" -m streamlit run app.py --server.port 8501 &
PID=$!

echo "等待伺服器啟動..."
READY=0
for i in $(seq 1 30); do
    if curl -s http://localhost:8501/_stcore/health > /dev/null 2>&1; then
        echo "伺服器已就緒，開啟瀏覽器..."
        open "http://localhost:8501"
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" -ne 1 ]; then
    echo "30 秒內沒有等到 Streamlit 就緒，請查看上方錯誤訊息。"
    read -r -p "按 Enter 結束..."
fi

wait $PID
