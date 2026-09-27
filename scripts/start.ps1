<#
.SYNOPSIS
  Builds (if needed) and starts Smart RSS with Docker Compose, then waits until it is healthy.
.EXAMPLE
  .\scripts\start.ps1           # start the app
  .\scripts\start.ps1 -Js       # also start the headless-Chromium renderer
  .\scripts\start.ps1 -NoBuild  # skip the image rebuild (faster when the code did not change)
#>
param(
  [switch]$Js,
  [switch]$NoBuild
)
. "$PSScriptRoot\_common.ps1"

Initialize-EnvFile
Assert-Docker

$composeArgs = @('compose')
if ($Js) { $composeArgs += @('--profile', 'js') }
$composeArgs += @('up', '-d')
if (-not $NoBuild) { $composeArgs += '--build' }

Write-Host "> docker $($composeArgs -join ' ')"
& docker @composeArgs
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }

$url = Get-AppUrl
Wait-Healthy $url
Write-Host "Smart RSS is running at $url"
