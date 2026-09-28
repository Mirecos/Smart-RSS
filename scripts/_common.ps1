# Shared helpers for start.ps1 / stop.ps1 / restart.ps1 (dot-sourced, not run directly).
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Initialize-EnvFile {
  if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host 'Created .env from .env.example (edit it to change settings).'
  }
}

# Reads KEY=value from .env; returns $Default when missing or empty.
function Get-EnvValue([string]$Name, [string]$Default) {
  if (-not (Test-Path '.env')) { return $Default }
  $line = Get-Content '.env' | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
  if (-not $line) { return $Default }
  $value = ($line -split '=', 2)[1].Trim().Trim('"', "'")
  if ($value) { return $value } else { return $Default }
}

function Assert-Docker {
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop, then try again.' }
}

function Get-AppUrl {
  $bindHost = Get-EnvValue 'BIND_ADDRESS' '127.0.0.1'
  if ($bindHost -eq '0.0.0.0') { $bindHost = '127.0.0.1' }
  $basePath = (Get-EnvValue 'BASE_PATH' '').TrimEnd('/')
  return "http://${bindHost}:$(Get-EnvValue 'PORT' '8080')$basePath"
}

function Wait-Healthy([string]$Url, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  Write-Host -NoNewline 'Waiting for the app to become healthy'
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest "$Url/api/health" -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { Write-Host ' ok'; return }
    } catch {
      # Not listening yet: keep polling until the deadline.
    }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 2
  }
  Write-Host ''
  throw "The app did not become healthy within $TimeoutSeconds s. Check the logs: docker compose logs app"
}
