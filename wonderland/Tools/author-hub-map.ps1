# WONDERLAND — run the hub-map authoring script inside Unreal, headless.
#
# The .umap is a binary editor format. Rather than hand-author one (which would
# be fabricating an asset) or click it into being (which leaves no diff), this
# drives the real editor's Python commandlet over author-hub-map.py, so the map
# that ships was produced by a script this repository contains.
#
# Python is enabled ON THE COMMAND LINE, not in Wonderland.uproject: the
# PythonScriptPlugin is editor-only tooling and has no business in the shipping
# project descriptor. Nothing about the project changes when this is not running.
#
# Usage:  pwsh -File wonderland/Tools/author-hub-map.ps1
#         (close the Unreal Editor first — see NOTE below)
#
# NOTE. Run this with the editor CLOSED. It will work with the editor open, but
# the running editor will not know the map exists until it is restarted, which
# makes "did it work?" harder to answer than it needs to be.

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
$script = Join-Path $toolsDir 'author-hub-map.py'

foreach ($required in @($uproject, $script)) {
  if (-not (Test-Path $required)) { throw "missing: $required" }
}

Write-Host "engine : $editorCmd"
Write-Host "project: $uproject"
Write-Host "script : $script"
Write-Host ''

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

$umap = Join-Path $projectDir 'Content\Wonderland\Maps\WonderlandHub.umap'
if (Test-Path $umap) {
  $size = (Get-Item $umap).Length
  Write-Host "WROTE $umap ($size bytes)"
} else {
  throw "the commandlet finished but $umap does not exist"
}

exit $code
