<#
.SYNOPSIS
  Stops Smart RSS, rebuilds the image from scratch (fresh base images), then starts it again.
  Your data is kept. Use it after pulling new code or when a normal restart does not pick up changes.
.EXAMPLE
  .\scripts\rebuild.ps1            # rebuild with fresh base images, reusing the build cache
  .\scripts\rebuild.ps1 -NoCache   # full rebuild, ignoring the build cache (slower)
  .\scripts\rebuild.ps1 -Js        # also start the headless-Chromium renderer afterwards
#>
param(
  [switch]$NoCache,
  [switch]$Js
)
. "$PSScriptRoot\_common.ps1"

Initialize-EnvFile
Assert-Docker

& "$PSScriptRoot\stop.ps1"

$buildArgs = @('compose', 'build', '--pull')
if ($NoCache) { $buildArgs += '--no-cache' }
Write-Host "> docker $($buildArgs -join ' ')"
& docker @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'docker compose build failed. The app is stopped; fix the error and run this script again.' }

& "$PSScriptRoot\start.ps1" -NoBuild -Js:$Js
