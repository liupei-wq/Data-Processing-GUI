#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 關掉舊的 streamlit（避免衝突）
pkill -f "streamlit run app.py" 2>/dev/null
sleep 1

echo "啟動 Spectroscopy Data Processing GUI..."
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 -m streamlit run app.py --server.port 8501 &
PID=$!

echo "等待伺服器啟動..."
for i in $(seq 1 30); do
    if curl -s http://localhost:8501/_stcore/health > /dev/null 2>&1; then
        echo "伺服器已就緒，開啟瀏覽器..."
        open "http://localhost:8501"
        break
    fi
    sleep 1
done

wait $PID
