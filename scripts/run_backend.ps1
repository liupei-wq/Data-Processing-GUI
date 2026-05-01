Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
  $PythonCommand = $VenvPython
  $PythonArgs = @()
} elseif (Get-Command "python" -ErrorAction SilentlyContinue) {
  $PythonCommand = "python"
  $PythonArgs = @()
} elseif (Get-Command "py" -ErrorAction SilentlyContinue) {
  $PythonCommand = "py"
  $PythonArgs = @("-3")
} else {
  Write-Error "Python was not found. Run scripts\setup_backend.ps1 first, or install Python 3.10+."
  exit 1
}

if (-not (Test-Path "web/backend/main.py")) {
  Write-Error "web/backend/main.py was not found. Run this script from the repo root."
  exit 1
}

Set-Location "web"
& $PythonCommand @PythonArgs -m uvicorn backend.main:app --reload --port 8000
