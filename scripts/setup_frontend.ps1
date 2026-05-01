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

function Require-Command {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Error "$Name was not found. $InstallHint"
    exit 1
  }
}

Sync-PathFromEnvironment
Require-Command "node" "Install Node.js LTS, recommended: Node 24. See ENV_SETUP.zh-TW.md."
Require-Command "npm.cmd" "Install npm; it is normally bundled with Node.js."

if (-not (Test-Path "web/frontend/package.json")) {
  Write-Error "web/frontend/package.json was not found. Run this script from the repo root."
  exit 1
}

Set-Location "web/frontend"
npm.cmd install
