<#
.SYNOPSIS
  Stops then starts Smart RSS. Accepts the same switches as start.ps1 (-Js, -NoBuild).
#>
param(
  [switch]$Js,
  [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'

& "$PSScriptRoot\stop.ps1"
& "$PSScriptRoot\start.ps1" -Js:$Js -NoBuild:$NoBuild
