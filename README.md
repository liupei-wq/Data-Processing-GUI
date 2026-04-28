# Data-Processing-GUI

這個專案目前有兩種啟動方式：

1. Streamlit 桌面版
2. FastAPI + React 網站版（目前先完成 XRD）

## Streamlit 桌面版

### Windows

1. 安裝 Python，並勾選 `Add Python to PATH`
2. 在專案根目錄執行：

```bash
pip install -r requirements.txt
```

3. 之後每次啟動可用：

```bash
streamlit run app.py
```

或直接使用現有啟動批次檔（如果本機保留該檔）。

### Mac

1. 安裝 Python 3
2. 在專案根目錄執行：

```bash
pip3 install -r requirements.txt
chmod +x 啟動_Mac.command
./啟動_Mac.command
```

## 網站版本機開發

網站版目錄在 `web/`，目前是 `FastAPI + React + Docker` 架構。

### 後端

```bash
cd web
uvicorn backend.main:app --reload --port 8000
```

### 前端

```bash
cd web/frontend
npm install
npm run dev
```

瀏覽器開：

```text
http://localhost:3000
```

## 免費部署到 Render

專案根目錄已提供 `render.yaml`，Render 可以直接讀取。

### 部署步驟

1. 把目前專案 push 到 GitHub
2. 到 Render 建立新服務
3. 選 `Blueprint` 或直接連接這個 GitHub repo
4. Render 會讀取根目錄 `render.yaml`
5. 部署完成後，Render 會提供一個 `onrender.com` 網址

### Render 目前使用的設定

- Runtime：Docker
- Dockerfile：`web/Dockerfile`
- Docker build context：repo root
- Health check：`/health`
- Plan：`free`

### 注意

- Render 免費 web service 閒置一段時間後會休眠
- 再次開啟時，第一次請求會比較慢
- 目前網站版先以 XRD 為主，其他模組還沒搬完
