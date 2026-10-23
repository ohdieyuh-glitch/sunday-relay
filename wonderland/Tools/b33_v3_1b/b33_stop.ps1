# b33_stop.ps1 -- W2DEV stop script for a B33 run started by b33_launch.ps1. DIAGNOSTIC tool, W2DEV, not evidence by itself.
# What it does: asks the run's conductor (b33_launch.ps1) to stop by writing <Run>\STOP_REQUEST and waits for <Run>\RUN_CLOSE.json; if the
#   conductor is gone (or with -FromLauncher, when the conductor itself calls it) it does the close itself:
#   1. kills ONLY the processes recorded in RUN.json (frames capture, both clients, the dev server), each verified by pid AND process start time
#      (a pid that was reused by another program is never touched); anything else is left alone
#   2. after they are gone, hashes every log and record of the run (SHA256SUMS_AT_CLOSE.txt; C0.3: logs hashed after the run closes),
#      including RAM_LOG.json and RAM_TRACE.csv when they exist (2026-10-23)
#   3. releases the shared lease (heavy-lease.py release --lease <id>) and writes RUN_CLOSE.json
# Inputs : -Run <run folder>. Outputs: RUN_CLOSE.json, SHA256SUMS_AT_CLOSE.txt (the dev-social.mjs bundle is hashed in RUN.json and removed).
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File b33_stop.ps1 -Run <run folder>
# v3.1f P62 (the B14/B18 rehearsal's finding T-1, fix L11; the same pattern was here): a process that is exiting can return a NULL StartTime
#   (or throw on it); converting that StartTime to UTC then threw "You cannot call a method on a null-valued expression" and, with
#   ErrorActionPreference Stop, the stop died BEFORE the hashes, the lease release and RUN_CLOSE. Now ProcState never throws, and every close
#   step (each kill, the hashes, the lease release, RUN_CLOSE) runs in its own try; a failed step is written to RUN_CLOSE.json close_errors.
param([Parameter(Mandatory)][string]$Run, [switch]$FromLauncher, [int]$WaitSec = 120)
$ErrorActionPreference = 'Stop'
$leaseTool = 'C:\dev\iwonder\_qa_handoff\julius_readiness\landing\heavy-lease.py'
$rj = Join-Path $Run 'RUN.json'
$close = Join-Path $Run 'RUN_CLOSE.json'
if (-not (Test-Path $rj)) { Write-Output "no RUN.json in ${Run}: nothing to stop"; exit 2 }
$R = Get-Content -Raw $rj | ConvertFrom-Json
if (Test-Path $close) { Write-Output "already closed: $close"; exit 0 }
if (-not $FromLauncher) {
  Set-Content -Path (Join-Path $Run 'STOP_REQUEST') -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ascii
  $lp = $null; try { $lp = Get-Process -Id ([int]$R.launcher_pid) -ErrorAction Stop } catch { }
  if ($lp) {
    $t0 = Get-Date
    while (-not (Test-Path $close) -and ((Get-Date) - $t0).TotalSeconds -lt $WaitSec) { Start-Sleep -Seconds 1 }
    if (Test-Path $close) { Write-Output "the conductor closed the run: $close"; exit 0 }
    Write-Output "the conductor (pid $($R.launcher_pid)) did not close the run in $WaitSec s: closing it here"
  } else { Write-Output "the conductor is gone: closing the run here" }
}
function ProcState($rc) {
  # v3.1f P62: never throws. 'ours' = the recorded live process (pid AND start time within 2 s, and its name); 'gone' = no such pid, or it is
  # exiting (no StartTime); 'other' = the pid now belongs to another process; 'unverified' = the record cannot be checked (never killed)
  try {
    $p = Get-Process -Id $rc.pid -ErrorAction SilentlyContinue
    if (-not $p) { return 'gone' }
    $st = $null; try { $st = $p.StartTime } catch { $st = $null }
    if ($null -eq $st) { return 'gone' }
    $want = [DateTime]::Parse($rc.start, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    if ([Math]::Abs(($st.ToUniversalTime() - $want).TotalSeconds) -gt 2 -or ($rc.name -and $p.ProcessName -ne $rc.name)) { return 'other' }
    return 'ours'
  } catch { return 'unverified' }
}
# ---- 1. kill only our own processes (pid + start time)
$killed = @(); $skipped = @(); $closeErrors = @()
$recs = @()
foreach ($grp in 'frames', 'sender', 'observer', 'server') {
  $g = $R.$grp
  if ($null -eq $g) { continue }
  foreach ($p in @($g.procs)) { if ($null -ne $p -and $p.pid) { $recs += [pscustomobject]@{ group = $grp; pid = [int]$p.pid; name = [string]$p.name; start = [string]$p.start_utc } } }
}
try { if (Test-Path (Join-Path $Run 'frames')) { Set-Content -Path (Join-Path $Run 'frames\STOP') -Value 'stop' -Encoding ascii; Start-Sleep -Seconds 2 } } catch { $closeErrors += "frames STOP: $($_.Exception.Message)" }
foreach ($rc in $recs) {   # never $r: PowerShell names are case-insensitive and $R is RUN.json
  $state = ProcState $rc
  if ($state -eq 'gone') { $skipped += "$($rc.group) pid $($rc.pid): already gone"; continue }
  if ($state -ne 'ours') { $skipped += "$($rc.group) pid $($rc.pid): NOT ours ($state): left alone"; continue }
  try {
    $nm = ''; try { $nm = (Get-Process -Id $rc.pid -ErrorAction SilentlyContinue).ProcessName } catch { }
    Stop-Process -Id $rc.pid -Force -ErrorAction Stop
    $killed += "$($rc.group) pid $($rc.pid) ($nm)"
  } catch {
    if ((ProcState $rc) -eq 'gone') { $skipped += "$($rc.group) pid $($rc.pid): exited during the stop" }
    else { $closeErrors += "kill $($rc.group) pid $($rc.pid): $($_.Exception.Message)" }
  }
}
$t0 = Get-Date
while ((Get-Date) - $t0 -lt [TimeSpan]::FromSeconds(30)) {
  $alive = @($recs | Where-Object { $killed -match "pid $($_.pid) " -and (ProcState $_) -eq 'ours' })
  if ($alive.Count -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 1
# ---- 2. hash after close (P62: in its own try)
$sums = @(); $logSha = [ordered]@{}; $nFrames = 0
try {
$files = @()
# 2026-10-23 (Skywalker ruling 1 on 3c040da4, F1): RAM_LOG.json and RAM_TRACE.csv (D-5) are hashed too; like every entry here, a missing
# file is skipped (Test-Path), never a close error
foreach ($rel in 'RUN.json', 'LAUNCH_LOG.txt', 'srv_out.txt', 'srv_err.txt', 'sender\Saved\Logs\Wonderland.log', 'observer\Saved\Logs\Wonderland.log', 'frames\index.csv', 'frames\frames.log', 'RAM_LOG.json', 'RAM_TRACE.csv') {
  $f = Join-Path $Run $rel; if (Test-Path $f) { $files += Get-Item $f }
}
$files += @(Get-ChildItem -Path $Run -Recurse -File -Include 'timeline.csv', 'drive.log', 'DRIVE_RECORD.txt', 'route.json' -ErrorAction SilentlyContinue)
foreach ($f in $files) {
  $h = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
  $relPath = $f.FullName.Substring($Run.Length).TrimStart('\')
  $sums += "$h  $relPath"
  if ($relPath -like '*Wonderland.log') { $logSha[$relPath] = $h }
}
$nFrames = @(Get-ChildItem -Path (Join-Path $Run 'frames') -Filter 'f_*.jpg' -ErrorAction SilentlyContinue).Count
Set-Content -Path (Join-Path $Run 'SHA256SUMS_AT_CLOSE.txt') -Value $sums -Encoding utf8
} catch { $closeErrors += "hashes: $($_.Exception.Message)" }
try { $mjs = Join-Path $Run 'dev-social.mjs'; if (Test-Path $mjs) { Remove-Item -Force $mjs } } catch { $closeErrors += "bundle removal: $($_.Exception.Message)" }
# ---- 3. lease
$relOut = ''
try { if ($R.lease_id) { $relOut = (& python -I $leaseTool release --lease $R.lease_id 2>&1 | Out-String).Trim() } } catch { $closeErrors += "lease release: $($_.Exception.Message)" }
$closeRec = [ordered]@{ closed_utc = (Get-Date).ToUniversalTime().ToString('o'); by = $(if ($FromLauncher) { 'conductor' } else { 'b33_stop.ps1' })
  killed = $killed; skipped = $skipped; log_sha256 = $logSha; frames_jpg = $nFrames; lease_id = $R.lease_id; lease_release = $relOut
  sums_file = 'SHA256SUMS_AT_CLOSE.txt'; sums_sha256 = $(try { (Get-FileHash (Join-Path $Run 'SHA256SUMS_AT_CLOSE.txt') -Algorithm SHA256).Hash.ToLower() } catch { '' })
  close_errors = $closeErrors }
try { $closeRec | ConvertTo-Json -Depth 4 | Set-Content -Path $close -Encoding utf8 } catch { Write-Output "RUN_CLOSE.json could not be written: $($_.Exception.Message)" }
foreach ($e in $closeErrors) { Write-Output "CLOSE ERROR $e" }
Write-Output ("closed: killed {0}, skipped {1}, lease release: {2}" -f $killed.Count, $skipped.Count, $relOut)
foreach ($k in $killed) { Write-Output "killed $k" }
foreach ($s in $skipped) { Write-Output "skipped $s" }
