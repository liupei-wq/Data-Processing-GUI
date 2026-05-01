Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Sync-PathFromEnvironment {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $knownNodePath = "C:\Program Files\nodejs"
  $paths = @($env:Path, $machinePath, $userPath, $knownNodePath) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $env:Path = ($paths -join ";")
}

Sync-PathFromEnvironment

if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
  Write-Error "node was not found. Install Node.js LTS, recommended: Node 24."
  exit 1
}

if (-not (Get-Command "npm.cmd" -ErrorAction SilentlyContinue)) {
  Write-Error "npm was not found. Confirm Node.js/npm is installed and available in PATH."
  exit 1
}

if (-not (Test-Path "web/frontend/package.json")) {
  Write-Error "web/frontend/package.json was not found. Run this script from the repo root."
  exit 1
}

Set-Location "web/frontend"
npm.cmd run dev
