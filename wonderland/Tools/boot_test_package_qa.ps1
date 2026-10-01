# Boot the PACKAGED Wonderland and run the post-completion gameplay regression inside it (wl.Qa.PackageCheck), then boot
# it AGAIN to see what the first run saved come back (wl.Qa.PackagePersist).
#
# boot_test_package.ps1 proves the package boots and streams; this proves the fixes are IN it: Jack Flame's secondary on
# fire, tie and suit (read off his materials), rim -> centre travel, the world map's layout at three zooms, TW01 / TW02 /
# MG01 from the map, a Mission Contract on every skin judged act by act (hands on the canon's, every act reached, the
# circle never jammed), every skin's body at Relay OG's height, and -- across a restart -- the chosen skin and colour.
# The game runs the checks itself (WonderlandQaCommands.cpp), writes a WLQA line per check and a frame per stage, and
# quits; this script waits for each boot, then collects the lines and frames. 1920x1200 windowed: the founder's own
# screen, so the UI lays out at the DPI scale it uses there.
param([Parameter(Mandatory = $true)][string]$Exe,
      [Parameter(Mandatory = $true)][string]$Out,
      [int]$TimeoutSeconds = 2400,
      [string]$SourceSkins = '')
$PkgDir = Split-Path (Split-Path $Exe -Parent) -Parent
New-Item -ItemType Directory -Force $Out | Out-Null
# AN INSTALLED BUILD (the beta release ships Engine/Build/InstalledProjectBuild.txt) keeps its saves and logs in
# %LOCALAPPDATA%\Wonderland\Saved; a plain staged build keeps them beside the exe.
$Root = Split-Path $Exe -Parent
$Installed = Test-Path (Join-Path $Root 'Engine\Build\InstalledProjectBuild.txt')
$Saved = if ($Installed) { Join-Path $env:LOCALAPPDATA 'Wonderland\Saved' } else { Join-Path $Root 'Wonderland\Saved' }
"saved folder: $Saved (installed build: $Installed)"
# THE FIGURES THE PACKAGE WEARS ARE THE ONES IN THE TREE: the skins are staged loose (NonUFS), so a stale copy would
# bring back an old head or a body without its `body` record. Compared byte for byte, before anything boots.
if ($SourceSkins) {
  $staged = Join-Path (Split-Path $Exe -Parent) 'Wonderland\RelaySkins'
  $report = foreach ($src in Get-ChildItem $SourceSkins -Filter *.wlvox) {
    $dst = Join-Path $staged $src.Name
    if (-not (Test-Path $dst)) { "SKINFILE $($src.Name) MISSING from the package" }
    elseif ((Get-FileHash $src.FullName).Hash -eq (Get-FileHash $dst).Hash) { "SKINFILE $($src.Name) same" }
    else { "SKINFILE $($src.Name) DIFFERENT" }
  }
  $report | Set-Content -Encoding utf8 (Join-Path $Out 'skinfiles.txt')
  $report
}
$Log = Join-Path $Saved 'Logs\Wonderland.log'
$Shots = Join-Path $Saved 'Screenshots\WLQA'
if (Test-Path $Shots) { Remove-Item -Recurse -Force $Shots }

function Invoke-Boot([string]$ExecCmds, [int]$Limit, [string]$Tag) {
  $t0 = Get-Date
  $argList = '-windowed -ResX=1920 -ResY=1200 -nosound -log -ExecCmds="' + $ExecCmds + '"'
  $p = Start-Process -FilePath $Exe -ArgumentList $argList -PassThru
  "[$Tag] launched bootstrap pid $($p.Id) at $(Get-Date -Format HH:mm:ss): $ExecCmds"
  # the bootstrap exe hands off to the real game process under the package folder; wait for every one of them to end
  Start-Sleep -Seconds 20
  $deadline = (Get-Date).AddSeconds($Limit)
  while ((Get-Date) -lt $deadline) {
    $alive = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
    if (-not $alive) { break }
    Start-Sleep -Seconds 5
  }
  $left = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
  if ($left) { "[$Tag] TIMEOUT after $Limit s: stopping $($left.Id -join ',')"; $left | Stop-Process -Force }
  "[$Tag] game ended after $([int]((Get-Date) - $t0).TotalSeconds) s"
  if (Test-Path $Log) {
    Copy-Item $Log (Join-Path $Out "Wonderland_$Tag.log") -Force
    $lines = Select-String -Path $Log -Pattern 'WLQA|WLTRAVEL|WLDOG orbit stalled|LogWorldPartition: Display: .*Streaming|Fatal|Assertion failed' | ForEach-Object { $_.Line }
    $lines | Set-Content -Encoding utf8 (Join-Path $Out "wlqa_lines_$Tag.txt")
  } else { "[$Tag] NO LOG at $Log" }
}

Invoke-Boot 'wl.Qa.PackageCheck' $TimeoutSeconds 'run1'
# the second boot puts back the skin the package booted in, after checking the one the first boot chose
$run1 = Join-Path $Out 'wlqa_lines_run1.txt'
$bootSkin = 'relay_og'
if (Test-Path $run1) {
  $m = Select-String -Path $run1 -Pattern 'WLQA BOOT skin (\S+)' | Select-Object -First 1
  if ($m) { $bootSkin = $m.Matches[0].Groups[1].Value }
}
Invoke-Boot "wl.Qa.PackagePersist $bootSkin" 300 'run2'

$all = @()
foreach ($tag in 'run1', 'run2') {
  $f = Join-Path $Out "wlqa_lines_$tag.txt"
  if (Test-Path $f) { $all += Get-Content $f | Where-Object { $_ -match 'WLQA' } }
}
$all | Set-Content -Encoding utf8 (Join-Path $Out 'wlqa_lines.txt')
$all | Where-Object { $_ -match 'WLQA (Q\S+ (PASS|FAIL)|END|BOOT|PERSIST|restored|ABORT)' }
$pass = @($all | Where-Object { $_ -match 'WLQA Q\S+ PASS' }).Count
$fail = @($all | Where-Object { $_ -match 'WLQA Q\S+ FAIL' }).Count
"TOTAL: $pass PASS, $fail FAIL (both boots)"
if (Test-Path $Shots) { Copy-Item (Join-Path $Shots '*') $Out -Force; Get-ChildItem $Out -Filter *.png | ForEach-Object { "frame $($_.Name) $([int]($_.Length/1KB)) KB" } }
