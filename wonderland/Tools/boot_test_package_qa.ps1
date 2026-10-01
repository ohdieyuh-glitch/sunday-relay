# Boot the PACKAGED Wonderland and run the gameplay and private-beta regression inside it (wl.Qa.PackageCheck), then boot
# it AGAIN to see what the first run saved come back (wl.Qa.PackagePersist).
#
# The game runs the checks itself (WonderlandQaCommands.cpp), writes a WLQA line per check and a frame per stage, and
# quits; this script waits for each boot, then collects the lines and frames. 1920x1200 windowed: the founder's own
# screen, so the UI lays out at the DPI scale it uses there.
#
# ISOLATED: every boot runs with -userdir=<Out>\userdir, a fresh profile, so the QA -- which clears contracts, resets
# colours and changes skins -- can never touch a real player's %LOCALAPPDATA%\Wonderland (Second Wonderland's review).
# A CRASH IS A FAILURE: RC1 crashed on both boots and the old summary read "0 PASS, 0 FAIL". Now any assertion, fatal
# error or missing "WLQA END" fails the run, and the script exits 1.
param([Parameter(Mandatory = $true)][string]$Exe,
      [Parameter(Mandatory = $true)][string]$Out,
      [int]$TimeoutSeconds = 2400,
      [string]$SourceSkins = '',
      [string]$UserDir = '')
$PkgDir = Split-Path (Split-Path $Exe -Parent) -Parent
New-Item -ItemType Directory -Force $Out | Out-Null
if (-not $UserDir) { $UserDir = Join-Path $Out 'userdir' }
if (Test-Path $UserDir) { Remove-Item -Recurse -Force $UserDir }
New-Item -ItemType Directory -Force $UserDir | Out-Null
$UserDir = (Resolve-Path $UserDir).Path
"isolated profile: $UserDir"
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
$script:Problems = @()

function Invoke-Boot([string]$ExecCmds, [int]$Limit, [string]$Tag) {
  $t0 = Get-Date
  $argList = '-windowed -ResX=1920 -ResY=1200 -nosound -log -userdir="' + $UserDir + '" -ExecCmds="' + $ExecCmds + '"'
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
  if ($left) { "[$Tag] TIMEOUT after $Limit s: stopping $($left.Id -join ',')"; $left | Stop-Process -Force; $script:Problems += "$Tag TIMEOUT" }
  "[$Tag] game ended after $([int]((Get-Date) - $t0).TotalSeconds) s"
  $log = Get-ChildItem $UserDir -Recurse -Filter 'Wonderland.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($log) {
    Copy-Item $log.FullName (Join-Path $Out "Wonderland_$Tag.log") -Force
    $lines = Select-String -Path $log.FullName -Pattern 'WLQA|WLBUILD|WLTRAVEL|WLDOG orbit stalled|LogWorldPartition: Display: .*Streaming|Fatal error|Assertion failed|Critical error|Unhandled Exception' | ForEach-Object { $_.Line }
    $lines | Set-Content -Encoding utf8 (Join-Path $Out "wlqa_lines_$Tag.txt")
    $crash = $lines | Where-Object { $_ -match 'Fatal error|Assertion failed|Critical error|Unhandled Exception' } | Select-Object -First 1
    if ($crash) { "[$Tag] CRASH: $crash"; $script:Problems += "$Tag CRASH" }
    if (-not ($lines | Where-Object { $_ -match 'WLQA END' })) { "[$Tag] INCOMPLETE: no WLQA END"; $script:Problems += "$Tag INCOMPLETE" }
  } else { "[$Tag] NO LOG under $UserDir"; $script:Problems += "$Tag NO LOG" }
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
$shots = Get-ChildItem $UserDir -Recurse -Directory -Filter 'WLQA' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($shots) { Copy-Item (Join-Path $shots.FullName '*') $Out -Force; Get-ChildItem $Out -Filter *.png | ForEach-Object { "frame $($_.Name) $([int]($_.Length/1KB)) KB" } }
if ($fail -gt 0) { $script:Problems += "$fail FAIL" }
if ($pass -eq 0) { $script:Problems += 'NO CHECKS RAN' }
if ($script:Problems.Count -gt 0) {
  "TOTAL: $pass PASS, $fail FAIL (both boots) -- QA FAILED: $($script:Problems -join '; ')"
  exit 1
}
"TOTAL: $pass PASS, $fail FAIL (both boots) -- QA PASSED"
