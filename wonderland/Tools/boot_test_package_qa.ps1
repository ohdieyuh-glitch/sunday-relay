# Boot the PACKAGED Wonderland and run the gameplay and private-beta regression inside it (wl.Qa.PackageCheck), boot it
# AGAIN to see what the first run saved come back (wl.Qa.PackagePersist), then a THIRD time on save files this script
# corrupts on purpose (wl.Qa.PackageHostile).
#
# The game runs the checks itself (WonderlandQaCommands.cpp), writes a WLQA line per check and a frame per stage, and
# quits; this script waits for each boot, then collects the lines and frames. 1920x1200 windowed: the founder's own
# screen, so the UI lays out at the DPI scale it uses there.
#
# ISOLATED: every boot runs with -userdir=<Out>\userdir, a fresh profile, so the QA -- which clears contracts, resets
# colours and changes skins -- can never touch a real player's %LOCALAPPDATA%\Wonderland (Second Wonderland's review).
# A CRASH IS A FAILURE: RC1 crashed on both boots and the old summary read "0 PASS, 0 FAIL". Now any assertion, fatal
# error or missing "WLQA END" fails the run, and the script exits 1.
# NO NETWORK LISTENER: a player's session must hold no listening socket once it has settled. The engine's trace control
# port (TCP 1985, every interface) opens on the first frame and the game closes it on the next (WonderlandBeta.cpp);
# every boot is sampled about 28 s in (the world is up by ~17 s), and any listener the game still holds is a failure.
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
$script:NetLines = @()
$script:Interfered = @()

# A PERSON AT THE KEYBOARD IS NOT A DEFECT. This laptop is the founder's and is often in use while the QA runs: RC4's first
# run lost Q05 to a keystroke into the game window (the map closed with no code path asking). The QA injects no input of
# its own, so any input while the GAME is the foreground window is a person's, and that boot's checks are void, not failed.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class WonderlandQaGuard {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint LastInputTick() { var l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return l.dwTime; }
  public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
}
'@

function Test-Listeners([string]$Tag) {
  # UNREAL INSIGHTS OPEN ON THIS PC makes the engine connect to it and start a trace worker thread, and the game then
  # rightly leaves the trace port alone (a tester never runs Insights): the reading would say nothing about the build.
  if (Get-Process UnrealInsights* -ErrorAction SilentlyContinue) { $script:NetLines += "QNET $Tag SKIPPED: Unreal Insights is open on this PC"; return }
  # the real game process, not the bootstrap: the one under <package>\Wonderland\Binaries
  $game = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*\Binaries\*" }
  if (-not $game) { $script:NetLines += "QNET $Tag SKIPPED: the game process was not found"; return }
  foreach ($g in $game) {
    $tcp = @(Get-NetTCPConnection -OwningProcess $g.Id -State Listen -ErrorAction SilentlyContinue)
    $udp = @(Get-NetUDPEndpoint -OwningProcess $g.Id -ErrorAction SilentlyContinue)
    $desc = (($tcp | ForEach-Object { "tcp $($_.LocalAddress):$($_.LocalPort)" }) + ($udp | ForEach-Object { "udp $($_.LocalAddress):$($_.LocalPort)" })) -join ', '
    if ($tcp.Count -eq 0 -and $udp.Count -eq 0) { $script:NetLines += "QNET $Tag PASS | pid $($g.Id): no listening socket" }
    else { $script:NetLines += "QNET $Tag FAIL | pid $($g.Id) listens: $desc"; $script:Problems += "$Tag LISTENER" }
  }
}

function Invoke-Boot([string]$ExecCmds, [int]$Limit, [string]$Tag) {
  $t0 = Get-Date
  $argList = '-windowed -ResX=1920 -ResY=1200 -nosound -log -userdir="' + $UserDir + '" -ExecCmds="' + $ExecCmds + '"'
  $p = Start-Process -FilePath $Exe -ArgumentList $argList -PassThru
  "[$Tag] launched bootstrap pid $($p.Id) at $(Get-Date -Format HH:mm:ss): $ExecCmds"
  # the bootstrap exe hands off to the real game process under the package folder; wait for every one of them to end.
  # Every half second: was there input, and was the game the foreground window when it came? (the guard above)
  $lastTick = [WonderlandQaGuard]::LastInputTick()
  $sampled = $false
  $hits = 0
  $deadline = (Get-Date).AddSeconds($Limit)
  $nextAlive = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $tick = [WonderlandQaGuard]::LastInputTick()
    if ($tick -ne $lastTick) {
      $lastTick = $tick
      $fg = [WonderlandQaGuard]::ForegroundPid()
      $gamePids = @(Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" } | ForEach-Object { $_.Id })
      if ($gamePids -contains $fg) {
        $hits++
        if ($hits -le 5) { "[$Tag] HUMAN INPUT into the game window at t=$([int]((Get-Date) - $t0).TotalSeconds) s" }
      }
    }
    if ((Get-Date) -ge $nextAlive) {
      $alive = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
      if (-not $alive) { break }
      if (-not $sampled -and ((Get-Date) - $t0).TotalSeconds -ge 28) { Test-Listeners $Tag; $sampled = $true }
      $nextAlive = (Get-Date).AddSeconds(5)
    }
    Start-Sleep -Milliseconds 500
  }
  if ($hits -gt 0) { $script:Interfered += "$Tag ($hits input events into the game window)" }
  if (-not $sampled) { $script:NetLines += "QNET $Tag SKIPPED: the game ended before 28 s" }
  $left = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
  if ($left) { "[$Tag] TIMEOUT after $Limit s: stopping $($left.Id -join ',')"; $left | Stop-Process -Force; $script:Problems += "$Tag TIMEOUT" }
  "[$Tag] game ended after $([int]((Get-Date) - $t0).TotalSeconds) s"
  $log = Get-ChildItem $UserDir -Recurse -Filter 'Wonderland.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($log) {
    Copy-Item $log.FullName (Join-Path $Out "Wonderland_$Tag.log") -Force
    $lines = Select-String -Path $log.FullName -Pattern 'WLQA|WLBUILD|WLBETA|WLSAVE|WLTASK the saved|WLCOMMANDS the saved|WLSKIN the remembered|WLTERRITORY skipped|WLTRAVEL|WLDOG orbit stalled|LogWorldPartition: Display: .*Streaming|Fatal error|Assertion failed|Critical error|Unhandled Exception' | ForEach-Object { $_.Line }
    $lines | Set-Content -Encoding utf8 (Join-Path $Out "wlqa_lines_$Tag.txt")
    $crash = $lines | Where-Object { $_ -match 'Fatal error|Assertion failed|Critical error|Unhandled Exception' } | Select-Object -First 1
    if ($crash) { "[$Tag] CRASH: $crash"; $script:Problems += "$Tag CRASH" }
    if (-not ($lines | Where-Object { $_ -match 'WLQA END' })) { "[$Tag] INCOMPLETE: no WLQA END"; $script:Problems += "$Tag INCOMPLETE" }
    # A MINIMIZED GAME CAPTURES NOTHING (0x0): someone put the window away mid-run -- RC4's first QA lost eight frames so
    $blind = @($lines | Where-Object { $_ -match 'WLQA frame .* FAILED 0x0' }).Count
    if ($blind -gt 0) { "[$Tag] $blind frame(s) captured nothing: the game window was minimized"; $script:Interfered += "$Tag ($blind frames captured nothing: window minimized)" }
  } else { "[$Tag] NO LOG under $UserDir"; $script:Problems += "$Tag NO LOG" }
}

$SaveGames = Join-Path $UserDir 'Saved\SaveGames'
$Contracts = Join-Path $SaveGames 'WonderlandMissionContracts.sav'

Invoke-Boot 'wl.Qa.PackageCheck' $TimeoutSeconds 'run1'
# the first boot's sealed contracts, kept for the third boot to receive cut short
if (Test-Path $Contracts) { Copy-Item $Contracts (Join-Path $Out 'run1_contracts.sav') -Force }
# the second boot puts back the skin the package booted in, after checking the one the first boot chose
$run1 = Join-Path $Out 'wlqa_lines_run1.txt'
$bootSkin = 'relay_og'
if (Test-Path $run1) {
  $m = Select-String -Path $run1 -Pattern 'WLQA BOOT skin (\S+)' | Select-Object -First 1
  if ($m) { $bootSkin = $m.Matches[0].Groups[1].Value }
}
Invoke-Boot "wl.Qa.PackagePersist $bootSkin" 300 'run2'

# THE THIRD BOOT'S FILES, CORRUPTED ON PURPOSE (private beta, R8 / R9). Each is a shape a disk error, a sync tool or a
# hand edit can leave, and each crashed or misled the RC2 loaders:
New-Item -ItemType Directory -Force $SaveGames | Out-Null
New-Item -ItemType Directory -Force (Join-Path $UserDir 'Saved\Wonderland') | Out-Null
$sealed = Join-Path $Out 'run1_contracts.sav'
if (Test-Path $sealed) {
  # 1. the first boot's sealed contracts, cut to 60% (a write that stopped), and a stale temporary beside them
  $bytes = [System.IO.File]::ReadAllBytes($sealed)
  [System.IO.File]::WriteAllBytes($Contracts, [byte[]]$bytes[0..([int]($bytes.Length * 0.6))])
} else { $script:Problems += 'run1 left no contracts file to corrupt' }
$rng = New-Object System.Random 1985
$junk = New-Object byte[] 4096; $rng.NextBytes($junk)
[System.IO.File]::WriteAllBytes("$Contracts.tmp", $junk)
# 2. a command-presets file whose "class name" is 3,000 characters: no GVAS tag, so the engine's loader reads the name
#    from byte 0 -- an int32 length, then the characters -- and made an FName of it (fatal past 1,023)
$presets = New-Object System.Collections.Generic.List[byte]
$presets.AddRange([BitConverter]::GetBytes([int32]3001))
$presets.AddRange([byte[]](,65 * 3000)); $presets.Add(0)
$tail = New-Object byte[] 1024; $rng.NextBytes($tail); $presets.AddRange($tail)
[System.IO.File]::WriteAllBytes((Join-Path $SaveGames 'WonderlandCommandPresets.sav'), $presets.ToArray())
# 3. a remembered skin id of 2,000 characters, and 4. a discoveries file with one good id and one 2,000-character line
[System.IO.File]::WriteAllText((Join-Path $UserDir 'Saved\Wonderland\RelaySkin.txt'), ('x' * 2000))
[System.IO.File]::WriteAllText((Join-Path $UserDir 'Saved\Wonderland\TerritoriesFound.txt'), "noctis`n" + ('z' * 2000) + "`n")
# 5. a FLAME colour file of 2,000 characters (founder, 2026-10-01: Flame Color): the designed fire, and the next pick rewrites it
[System.IO.File]::WriteAllText((Join-Path $UserDir 'Saved\Wonderland\FlameColour.txt'), ('x' * 2000))
"hostile files planted: contracts cut to 60% + .tmp, presets with a 3,000-character class name, a 2,000-character skin id, a 2,000-character territory line, a 2,000-character flame colour"
Invoke-Boot 'wl.Qa.PackageHostile' 300 'run3'

$all = @()
foreach ($tag in 'run1', 'run2', 'run3') {
  $f = Join-Path $Out "wlqa_lines_$tag.txt"
  if (Test-Path $f) { $all += Get-Content $f | Where-Object { $_ -match 'WLQA' } }
}
$all | Set-Content -Encoding utf8 (Join-Path $Out 'wlqa_lines.txt')
$all | Where-Object { $_ -match 'WLQA (Q\S+ (PASS|FAIL)|END|BOOT|PERSIST|restored|ABORT|BEGIN hostile)' }
$script:NetLines
$script:NetLines | Set-Content -Encoding utf8 (Join-Path $Out 'qnet_lines.txt')
$pass = @($all | Where-Object { $_ -match 'WLQA Q\S+ PASS' }).Count + @($script:NetLines | Where-Object { $_ -match 'QNET \S+ PASS' }).Count
$fail = @($all | Where-Object { $_ -match 'WLQA Q\S+ FAIL' }).Count + @($script:NetLines | Where-Object { $_ -match 'QNET \S+ FAIL' }).Count
$shots = Get-ChildItem $UserDir -Recurse -Directory -Filter 'WLQA' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($shots) { Copy-Item (Join-Path $shots.FullName '*') $Out -Force; Get-ChildItem $Out -Filter *.png | ForEach-Object { "frame $($_.Name) $([int]($_.Length/1KB)) KB" } }
if ($fail -gt 0) { $script:Problems += "$fail FAIL" }
if ($pass -eq 0) { $script:Problems += 'NO CHECKS RAN' }
if ($script:Interfered.Count -gt 0) {
  # VOID, NOT FAILED: a person typed or clicked into the game while it was being measured
  "TOTAL: $pass PASS, $fail FAIL (three boots) -- QA INTERFERED (void; rerun on an idle PC): $($script:Interfered -join '; ')$(if ($script:Problems.Count) { ' | also: ' + ($script:Problems -join '; ') })"
  exit 2
}
if ($script:Problems.Count -gt 0) {
  "TOTAL: $pass PASS, $fail FAIL (three boots) -- QA FAILED: $($script:Problems -join '; ')"
  exit 1
}
"TOTAL: $pass PASS, $fail FAIL (three boots) -- QA PASSED"
