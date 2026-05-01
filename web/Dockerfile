# Multi-stage build
# Build context must be the project root (Data-Processing-GUI-main/)
# Usage: docker build -f web/Dockerfile -t spectroscopy-web .

# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:24-alpine AS frontend-build
WORKDIR /build

COPY web/frontend/package.json web/frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY web/frontend/ ./
RUN npm run build
# Output: /build/dist/

# ── Stage 2: Python backend + static files ────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies
COPY web/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy processing modules (now live inside web/backend/)
COPY web/backend/core/ ./core/
COPY web/backend/db/   ./db/

# Copy FastAPI backend
COPY web/backend/ ./backend/

# Copy built React app so FastAPI can serve it as static files
COPY --from=frontend-build /build/dist ./static/

EXPOSE 8000

# Railway injects $PORT at runtime; fall back to 8000 locally
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
