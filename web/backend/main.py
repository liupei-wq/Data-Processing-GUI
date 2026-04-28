"""FastAPI entry point.

Local dev  : cd web && uvicorn backend.main:app --reload --port 8000
Docker     : WORKDIR=/app  uvicorn backend.main:app --host 0.0.0.0 --port $PORT
"""

import sys
from pathlib import Path

# ── path setup ───────────────────────────────────────────────────────────────
_this = Path(__file__).resolve().parent          # .../web/backend  or  /app/backend
sys.path.insert(0, str(_this))                   # lets "from routers import xrd" work

# Find the directory that contains core/ and db/ (project root)
for _candidate in (_this.parent, _this.parent.parent):
    if (_candidate / "core").exists():
        sys.path.insert(0, str(_candidate))
        break
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import raman, xrd

app = FastAPI(title="Spectroscopy Web API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(xrd.router, prefix="/api/xrd", tags=["XRD"])
app.include_router(raman.router, prefix="/api/raman", tags=["Raman"])


@app.get("/health")
def health():
    return {"status": "ok"}


# Serve built React app in production (static/ is created by Dockerfile)
_static = _this.parent / "static"
if _static.exists():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="static")
