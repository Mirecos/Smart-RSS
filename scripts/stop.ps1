<#
.SYNOPSIS
  Stops Smart RSS (and the optional renderer). Your data is kept in the "rss-data" volume.
#>
. "$PSScriptRoot\_common.ps1"

Assert-Docker

# The profiles make sure the optional renderer (js) and HTTPS proxy (https) are stopped too.
Write-Host '> docker compose --profile js --profile https down'
docker compose --profile js --profile https down
if ($LASTEXITCODE -ne 0) { throw 'docker compose down failed.' }
Write-Host 'Smart RSS stopped (data kept).'
