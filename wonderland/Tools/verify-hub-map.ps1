# WONDERLAND — run the hub-map verification inside Unreal, headless.
#
# Read-only counterpart to author-hub-map.ps1. Exits non-zero if any link of
# the startup chain is broken, so it is usable as a gate.
#
# Usage:  pwsh -File wonderland/Tools/verify-hub-map.ps1
#         npm run wonderland:map:verify

$ErrorActionPreference = 'Stop'

$engineRoot = $env:WONDERLAND_UE_ROOT
if (-not $engineRoot) { $engineRoot = 'C:\Program Files\Epic Games\UE_5.4' }

$editorCmd = Join-Path $engineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
if (-not (Test-Path $editorCmd)) {
  throw "UnrealEditor-Cmd.exe not found at '$editorCmd'. Set WONDERLAND_UE_ROOT to the UE 5.4 install."
}

$toolsDir = Split-Path -Parent $PSCommandPath
$projectDir = Split-Path -Parent $toolsDir
$uproject = Join-Path $projectDir 'Wonderland.uproject'
$script = Join-Path $toolsDir 'verify-hub-map.py'

foreach ($required in @($uproject, $script)) {
  if (-not (Test-Path $required)) { throw "missing: $required" }
}

& $editorCmd `
  $uproject `
  -run=pythonscript `
  -script="$script" `
  -EnablePlugins=PythonScriptPlugin `
  -unattended `
  -nopause `
  -nosplash `
  -stdout `
  -FullStdOutLogOutput

$code = $LASTEXITCODE
Write-Host ''
Write-Host "UnrealEditor-Cmd exit code: $code"
exit $code
