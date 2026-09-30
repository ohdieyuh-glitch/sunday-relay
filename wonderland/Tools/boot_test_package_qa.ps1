# Boot the PACKAGED Wonderland and run the post-completion gameplay regression inside it (wl.Qa.PackageCheck).
#
# boot_test_package.ps1 proves the package boots and streams; this proves the fixes are IN it: Jack Flame's secondary on
# fire, tie and suit, rim -> centre travel, the world map's layout at three zooms, TW01 / TW02 / MG01 from the map, and a
# Mission Contract from the Tartarus rim. The game runs the checks itself (WonderlandQaCommands.cpp), writes a WLQA line
# per check and a frame per stage, resets the colours it changed and quits; this script waits for that, then collects
# the lines and frames. 1920x1200 windowed: the founder's own screen, so the UI lays out at the DPI scale it uses there.
param([Parameter(Mandatory = $true)][string]$Exe,
      [Parameter(Mandatory = $true)][string]$Out,
      [int]$TimeoutSeconds = 900)
$PkgDir = Split-Path (Split-Path $Exe -Parent) -Parent
New-Item -ItemType Directory -Force $Out | Out-Null
$Saved = Join-Path (Split-Path $Exe -Parent) 'Wonderland\Saved'
$Log = Join-Path $Saved 'Logs\Wonderland.log'
$Shots = Join-Path $Saved 'Screenshots\WLQA'
if (Test-Path $Shots) { Remove-Item -Recurse -Force $Shots }
$t0 = Get-Date
$argList = '-windowed -ResX=1920 -ResY=1200 -nosound -log -ExecCmds="wl.Qa.PackageCheck"'
$p = Start-Process -FilePath $Exe -ArgumentList $argList -PassThru
"launched bootstrap pid $($p.Id) at $(Get-Date -Format HH:mm:ss)"
# the bootstrap exe hands off to the real game process under the package folder; wait for every one of them to end
Start-Sleep -Seconds 20
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  $alive = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
  if (-not $alive) { break }
  Start-Sleep -Seconds 5
}
$left = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
if ($left) { "TIMEOUT after $TimeoutSeconds s: stopping $($left.Id -join ',')"; $left | Stop-Process -Force }
"game ended after $([int]((Get-Date) - $t0).TotalSeconds) s"
if (Test-Path $Log) {
  Copy-Item $Log (Join-Path $Out 'Wonderland.log') -Force
  $lines = Select-String -Path $Log -Pattern 'WLQA|WLTRAVEL|LogWorldPartition: Display: .*Streaming|Fatal|Assertion failed' | ForEach-Object { $_.Line }
  $lines | Set-Content -Encoding utf8 (Join-Path $Out 'wlqa_lines.txt')
  $lines | Where-Object { $_ -match 'WLQA' }
} else { "NO LOG at $Log" }
if (Test-Path $Shots) { Copy-Item (Join-Path $Shots '*') $Out -Force; Get-ChildItem $Out -Filter *.png | ForEach-Object { "frame $($_.Name) $([int]($_.Length/1KB)) KB" } }
