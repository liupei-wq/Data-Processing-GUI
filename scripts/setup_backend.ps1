Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Get-PythonLaunch {
  if (Get-Command "python" -ErrorAction SilentlyContinue) {
    try {
      & python --version | Out-Null
      return @{ Command = "python"; Args = @() }
    } catch {}
  }

  if (Get-Command "py" -ErrorAction SilentlyContinue) {
    try {
      & py -3 --version | Out-Null
      return @{ Command = "py"; Args = @("-3") }
    } catch {}
  }

  return $null
}

$Python = Get-PythonLaunch
if ($null -eq $Python) {
  Write-Error "No usable Python was found. Install Python 3.10+ and ensure python or py works in PowerShell."
  exit 1
}

if (-not (Test-Path "web/backend/requirements.txt")) {
  Write-Error "web/backend/requirements.txt was not found. Run this script from the repo root."
  exit 1
}

if (-not (Test-Path ".venv")) {
  & $Python.Command @($Python.Args) -m venv .venv
}

$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  Write-Error ".venv\Scripts\python.exe was not found; virtual environment creation failed."
  exit 1
}

& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r "web/backend/requirements.txt"
