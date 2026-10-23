# b33_launch.ps1 -- W2DEV launcher/conductor for the B33 PACKAGE PRECONDITION runs (SC3). DIAGNOSTIC tool, W2DEV, not evidence by itself.
# What it does, in order (and it STAYS RUNNING as the run's conductor, holding the shared heavy lease, until b33_stop.ps1 asks it to stop):
#   0. THE ONE PINNED CANDIDATE: reads tools\b33\CANDIDATE.json (label, commit, game_exe_sha256, boot_exe_sha256, package_folder; the judge
#      reads the same file and VOIDs any other exe). BEFORE ANYTHING IS MADE (no run folder, no lease, also under -DryChecks) it REFUSES
#      (exit 2) unless CANDIDATE.json status is exactly "READY" (it ships PENDING: nothing can run until the lead fills it), and refuses a
#      -Package other than package_folder, a -Commit that is not candidate.commit (or a >= 7-char prefix of it), a game exe whose sha256 is not
#      game_exe_sha256 and a boot exe whose sha256 is not boot_exe_sha256. -CandidateFile <other json> is for the tests and is accepted only
#      with -DryChecks (RUN.json would record candidate.default false and the judge VOIDs that).
#   1. refuses if a Wonderland.exe already runs, the port is busy, or the package exe is missing; makes the run folder
#      <RunsRoot>\DIAGNOSTIC_b33_<scenario>_<utc> (or DIAGNOSTIC_b33_CONTROL_<scenario>_<utc> with -Control): THE COUNTED-RUNS FOLDER holds
#      ONLY counted runs (role JUDGED or CONTROL).
#      v3.1a (ruling 7a7faf P2-2; 8805ec item 5): a run that is never counted is written OUTSIDE it, under -NotCountedRoot (default: the
#      folder NOT_COUNTED_b33 beside -RunsRoot; refused if it is inside -RunsRoot): -Scenario survey -> SURVEY_b33_<utc> (role SURVEY);
#      -RelaySource or -ServerTree -> REHEARSAL_NOT_PREREG_b33_<scenario>_<utc> (role REHEARSAL_NOT_PREREG). The judge's run listing
#      excludes them by role (and, for older folders, by name, scenario and a NOT-PREREG server).
#   v3.1a RAM (ruling 7a7faf P2-4): the lease gate is enforced at >= 5.0 GB (-LeaseGb below 5.0 is refused, as v3); RUN.json records
#      lease_gb and the free-RAM readings at the start; the IN-RUN GUARD (-InRunGuardGb, default 1.1 GB, the B35 pattern) reads free RAM
#      every 3 s while the run is up and, below it, writes RAM_GUARD_TRIP.txt and stops the run (a STOP, never a verdict: the blocks that
#      did not end are INCOMPLETE under the frozen rules); RAM_LOG.json (min free, readings, the guard and whether it tripped) is written
#      before the close and the judge copies it into its report. 6.5 GB free at the queue is PRACTICE, not a criterion.
#      (B33 v3.1, tools\b33_v3_1: the counted naming; the rehearsal copy's DIAGNOSTIC_NOTPREREG_b33_* naming (8805ec) is copy-only and is
#      NOT promoted)
#   0b. v3.1 THE RELAY PIN (Q-B33-1 / T1 d63c15; the B35 v5.3.2 pattern): RELAY_PIN.json beside this launcher. Unless -RelaySource or
#      -ServerTree (both NOT-PREREG), the loopback relay IS the pin: status PINNED with a full 40-hex commit and tree of -SundayRelay, the
#      commit resolving to that tree; otherwise REFUSED before anything is made (-DryChecks too). -RelayPinFile <other json> is for the tests
#      and is accepted only with -DryChecks. An explicit -RelayCommit without -RelaySource is refused (the relay is the pin).
#   2. takes the shared lease: python -I heavy-lease.py acquire --owner WONDERLAND --job b33_<scenario>_<utc> --gb <LeaseGb> --pid <this PID>
#      (exit 5 = refused: retried every 30 s for -LeaseWaitMin minutes); records RAM free at start
#   3. THE LOOPBACK DEV SERVER FROM THE DEPLOYED BACKEND'S OWN CODE (PREREG_B33_PRECONDITION_v2 section 3): `git archive <RelayCommit>` (default
#      cbe584be) of -SundayRelay (relay-bridge, src, package.json: the whole import closure of relay-bridge/dev-social-server.ts, checked by
#      relay_import_closure.py) into the run folder; NODE_PATH = -NodeModulesFrom\node_modules, refused unless that tree's package-lock.json is
#      byte-identical to <RelayCommit>'s blob (git hash-object vs rev-parse <commit>:package-lock.json); esbuild bundles cbe584be's OWN
#      relay-bridge/dev-social-server.ts UNCHANGED to <run>\dev-social.mjs (the name its entry check needs) and node runs it on 127.0.0.1:<Port>
#      (loopback, in memory, dev sessions). RUN.json server: repo, full commit + tree, archived files (path + blob) list and its sha256, the tar's
#      sha256, bundle sha256, node_modules tree + lockfile blobs, prereg = true. -ServerTree <dir> is an explicit OVERRIDE only: it bundles
#      that tree's dev-social-server.ts instead and marks the run NOT-PREREG (RUN.json server.prereg = false; the judge VOIDs it).
#      v3.1k P83 (transport ring rehearsals, r16reh18): -RelaySource <git worktree> -RelayCommit <sha> (the commit is REQUIRED with it) runs
#      the relay from that worktree's repository at THAT commit, by the same git archive + esbuild path (never the working files); RUN.json
#      server and <run>\RELAY_SOURCE.json record the commit, tree, the worktree's HEAD and branch, whether HEAD is the commit, and its clean
#      status (git status --porcelain, also written to relay_worktree_status.txt). Such a run is NOT-PREREG (server.prereg = false: the judge
#      VOIDs it and still prints every scenario, R7-08). -RelaySource excludes -ServerTree. Without -RelaySource nothing changes.
#   4. starts TWO packaged clients from -Package: the SENDER and, 20 s later, the OBSERVER, each with its own -userdir, -windowed -ResX/-ResY
#      -WinX/-WinY (the client ignores the size: step 5b places the windows) -wldev and
#      -ExecCmds="wl.Social.Dev <identity> http://127.0.0.1:<Port>,wl.Remote.LogPeriod <s>"
#      (wl.Social.Dev = dev identity; wl.Remote.LogPeriod = logging only, disclosed; -wldev is needed for wl.Social.Dev). NO -wlframes (M2
#      ruling B-5); RUN.json disclosed.launch_switches is the exact switch list the judge compares with each client's own Command Line.
#      The candidate checks are step 0 (CANDIDATE.json; M2 review R4-13).
#      NO gameplay CVar. -RenderCvars adds rendering-only commands, disclosed in RUN.json (default none). THE PREREG B33 v3 JUDGED LAUNCH is
#      `-Package <pkg> -Commit <sha> -Scenario jumps|m4|survey -RenderCvars 'scalability 0'` (CONTROL adds -Control), so each client's
#      -ExecCmds is exactly "wl.Social.Dev <identity> http://127.0.0.1:<Port>,wl.Remote.LogPeriod 0.1,scalability 0"; the judge VOIDs any
#      other ExecCmds set (and a RUN.json whose disclosed.render_cvars is not exactly ["scalability 0"]); the launcher prints a NOTE when the
#      launch is not the prereg one (it still runs: a diagnostic). From cmd.exe pass -RenderCvars "scalability 0" (double quotes). -ForceLogFlush adds
#      -forcelogflush (default OFF: with it every log line is flushed and the file stamps fell up to 70 s behind at boot in b33a).
#      -Control (M1 ruling R-5, R2-19 must-fail control): the OBSERVER also gets exactly "wl.Remote.InterpEaseZ 30,wl.Remote.ReportTimeSamples 0,
#      wl.Remote.RttClock 0" (the r16reh16u values), disclosed, the run folder and RUN.json are labelled CONTROL: never a judged run.
#   5. waits for "WLWORLD joined" in both logs, watches for a Windows Defender Firewall prompt ("Windows Security Alert") and, if one shows,
#      says a PERSON must close it with X (never Allow); it never touches it
#   5b. WINDOW LAYOUT (the packaged clients IGNORE -ResX/-ResY: lead, B35 v4 shakedown 10-20, client areas came up 1600x1000): finds each
#      client's GAME process (the child Wonderland\Binaries\Win64\Wonderland.exe with that -userdir, never the boot stub) and its window, waits
#      for a stable client rect, then SetWindowPos(hwnd, 0, x, y, w, h, SWP_NOZORDER|SWP_NOACTIVATE) from a PER_MONITOR_AWARE_V2 thread
#      (b33_native.cs Win.Place): sender frame -SenderX,-FrameY, observer frame -ObserverX,-FrameY, both -FrameW x -FrameH (default the
#      verified 960x1080 split at x 0 / 960 -> ~940x1031 client areas). Re-reads frame + client rects; up to 3 tries; if a frame is off its
#      target by more than -LayoutTolPx (2) or the frames/client areas overlap, the layout is REFUSED: RUN.json records it (layout.ok false),
#      no READY is written and the run is closed (the drive also refuses to start without layout.ok and its own re-read match).
#   6. starts b33_frames.ps1 for the observer window (captures only while the drive's CAPTURE flag exists), writes RUN.json and READY
#   7. waits for <run>\STOP_REQUEST (b33_stop.ps1), a client exit, or -MaxMinutes; then runs b33_stop.ps1 -FromLauncher (kills ONLY the pids it
#      started, verified by pid + start time; hashes every log after the run closed; releases the lease)
# Inputs : -Package <unpacked package folder with Wonderland.exe> -Commit <client commit> [-Scenario jumps|m4|survey|all] [-Control] ...
# Outputs: the run folder: RUN.json (exe sha256 boot + game, commit, RAM free at start, lease, pids + start times, command lines, disclosed CVars),
#          LAUNCH_LOG.txt, sender\ observer\ (userdirs with Saved\Logs\Wonderland.log), frames\, srv_out.txt, then RUN_CLOSE.json + SHA256SUMS_AT_CLOSE.txt
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File b33_launch.ps1 -Package <dir> -Commit <sha> -Scenario jumps        (run it in the background)
#       ... -DryChecks : every input check (candidate, package, cbe584be, lockfile, archive list) and the PLANNED client arguments + the
#                        disclosed block RUN.json would carry, recorded in <run>\DRYCHECKS.json; nothing started
param(
  [Parameter(Mandatory)][string]$Package,
  [Parameter(Mandatory)][string]$Commit,
  [ValidateSet('jumps', 'm4', 'survey', 'all')][string]$Scenario = 'jumps',
  [switch]$Control,
  [string]$RunsRoot = 'C:\dev\iwonder\_qa_handoff\integration\r16reh16w_submission_20261020\diagnostics',
  [int]$Port = 8796,
  [string]$SenderName = 'wlautoA', [string]$ObserverName = 'wlautoB',
  [double]$LeaseGb = 5.0, [int]$LeaseWaitMin = 30, [double]$InRunGuardGb = 1.1, [string]$NotCountedRoot = '',
  [string]$SundayRelay = 'C:\dev\iwonder\sunday-relay', [string]$RelayCommit = 'cbe584be', [string]$RelaySource = '',
  [string]$NodeModulesFrom = 'C:\dev\iwonder\_r16fix_relay_pristine_20261020',
  [string]$ServerTree = '',
  [double]$LogPeriod = 0.1,
  [string[]]$RenderCvars = @(),
  [switch]$ForceLogFlush,
  [int]$ResX = 940, [int]$ResY = 1031, [int]$WinY = 0,
  [int]$FrameW = 960, [int]$FrameH = 1080, [int]$FrameY = 0, [int]$SenderX = 0, [int]$ObserverX = 960, [int]$LayoutTolPx = 2,
  [int]$MaxMinutes = 45, [int]$JoinTimeoutSec = 360,
  [switch]$NoFrames, [double]$Fps = 5,
  [switch]$DryChecks,
  [string]$CandidateFile = '',  # '' = CANDIDATE.json beside this launcher, THE pinned candidate; another file only with -DryChecks (tests)
  [string]$RelayPinFile = ''    # v3.1: '' = RELAY_PIN.json beside this launcher, THE relay pin; another file only with -DryChecks (tests)
)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'b33_native.cs')
. (Join-Path $PSScriptRoot 'b33_layout.ps1')
$leaseTool = 'C:\dev\iwonder\_qa_handoff\julius_readiness\landing\heavy-lease.py'
$CONTROL_CVARS = @('wl.Remote.InterpEaseZ 30', 'wl.Remote.ReportTimeSamples 0', 'wl.Remote.RttClock 0')
# ---- 0. THE ONE pinned candidate (CANDIDATE.json; b33_judge.py reads the same file): every refusal here comes before anything is made
$candDefault = Join-Path $PSScriptRoot 'CANDIDATE.json'
if (-not $CandidateFile) { $CandidateFile = $candDefault }
$candIsDefault = ([IO.Path]::GetFullPath($CandidateFile) -eq [IO.Path]::GetFullPath($candDefault))
function Refuse0([string]$why) { Write-Host "RESULT refused (candidate check, nothing made): $why"; exit 2 }
if (-not $candIsDefault -and -not $DryChecks) { Refuse0 "-CandidateFile $CandidateFile is not $candDefault (another candidate file is for -DryChecks tests only)" }
if (-not (Test-Path $CandidateFile)) { Refuse0 "no candidate file $CandidateFile" }
try { $cand = Get-Content -Raw -Encoding UTF8 $CandidateFile | ConvertFrom-Json } catch { Refuse0 "$CandidateFile is not valid JSON: $($_.Exception.Message)" }
$candStatus = [string]$cand.status
if ($candStatus.Trim() -cne 'READY') { Refuse0 "CANDIDATE.json status is '$candStatus', not READY ($CandidateFile): nothing runs until the lead fills it. $($cand.pending_note)" }
foreach ($k in 'game_exe_sha256', 'boot_exe_sha256') { if ([string]$cand.$k -notmatch '^[0-9a-fA-F]{64}$') { Refuse0 "CANDIDATE.json $k is not a sha256: '$($cand.$k)'" } }
foreach ($k in 'commit', 'package_folder', 'label') { if (-not [string]$cand.$k) { Refuse0 "CANDIDATE.json has no $k" } }
$candCommit = ([string]$cand.commit).ToLower()
if ($Commit.Length -lt 7 -or -not $candCommit.StartsWith($Commit.ToLower())) { Refuse0 "-Commit $Commit is not CANDIDATE.json's commit $candCommit (or a >= 7-char prefix of it)" }
if ([IO.Path]::GetFullPath($Package).TrimEnd('\') -ne [IO.Path]::GetFullPath([string]$cand.package_folder).TrimEnd('\')) { Refuse0 "-Package $Package is not CANDIDATE.json's package_folder $($cand.package_folder)" }
$boot = Join-Path $Package 'Wonderland.exe'
$game = Join-Path $Package 'Wonderland\Binaries\Win64\Wonderland.exe'
foreach ($p in $boot, $game) { if (-not (Test-Path $p)) { Refuse0 "package exe not found: $p" } }
$bootSha = (Get-FileHash $boot -Algorithm SHA256).Hash.ToLower(); $gameSha = (Get-FileHash $game -Algorithm SHA256).Hash.ToLower()
if ($gameSha -ne ([string]$cand.game_exe_sha256).ToLower()) { Refuse0 "the game exe sha256 $gameSha is not the candidate's $($cand.game_exe_sha256) ($($cand.label); M2 review R4-13)" }
if ($bootSha -ne ([string]$cand.boot_exe_sha256).ToLower()) { Refuse0 "the boot exe sha256 $bootSha is not the candidate's $($cand.boot_exe_sha256) ($($cand.label))" }
# ---- 0b. v3.1 THE RELAY PIN (before anything is made; -DryChecks too)
$pinDefault = Join-Path $PSScriptRoot 'RELAY_PIN.json'
if (-not $RelayPinFile) { $RelayPinFile = $pinDefault }
$pinIsDefault = ([IO.Path]::GetFullPath($RelayPinFile) -eq [IO.Path]::GetFullPath($pinDefault))
if (-not $pinIsDefault -and -not $DryChecks) { Refuse0 "-RelayPinFile $RelayPinFile is not $pinDefault (another relay pin file is for -DryChecks tests only)" }
$relayPinRec = $null
if (-not $RelaySource -and -not $ServerTree) {
  if ($PSBoundParameters.ContainsKey('RelayCommit')) { Refuse0 "-RelayCommit without -RelaySource: in B33 v3.1 the counted relay IS RELAY_PIN.json (a -RelaySource run is NOT-PREREG)" }
  $rpin = $null; try { $rpin = Get-Content -Raw -Encoding UTF8 $RelayPinFile | ConvertFrom-Json } catch { $rpin = $null }
  if ($null -eq $rpin -or [string]$rpin.status -cne 'PINNED' -or [string]$rpin.commit -cnotmatch '^[0-9a-f]{40}$' -or [string]$rpin.tree -cnotmatch '^[0-9a-f]{40}$') {
    Refuse0 ("RELAY_PIN.json ($RelayPinFile) is not PINNED with a full 40-hex commit and tree (status '{0}'): the counted loopback relay is the pin; nothing runs until the lead fills it" -f $(if ($rpin) { $rpin.status } else { 'unreadable' }))
  }
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $pc = (& git -c safe.directory=* -C $SundayRelay rev-parse "$($rpin.commit)^{commit}" 2>$null | Out-String).Trim(); $pt = (& git -c safe.directory=* -C $SundayRelay rev-parse "$($rpin.commit)^{tree}" 2>$null | Out-String).Trim() } finally { $ErrorActionPreference = $old }
  if ($pc -ne [string]$rpin.commit -or $pt -ne [string]$rpin.tree) { Refuse0 "the relay pin $($rpin.commit) resolves to '$pc' (tree '$pt') in $SundayRelay, not commit $($rpin.commit) with tree $($rpin.tree)" }
  $RelayCommit = [string]$rpin.commit
  $relayPinRec = [ordered]@{ file = $RelayPinFile; file_sha256 = (Get-FileHash $RelayPinFile -Algorithm SHA256).Hash.ToLower(); default = $pinIsDefault
    status = [string]$rpin.status; label = [string]$rpin.label; commit = [string]$rpin.commit; tree = [string]$rpin.tree }
}
$candRec = [ordered]@{ file = $CandidateFile; file_sha256 = (Get-FileHash $CandidateFile -Algorithm SHA256).Hash.ToLower(); default = $candIsDefault
  status = $candStatus; label = [string]$cand.label; commit = [string]$cand.commit; game_exe_sha256 = [string]$cand.game_exe_sha256
  boot_exe_sha256 = [string]$cand.boot_exe_sha256; package_folder = [string]$cand.package_folder }
foreach ($c in $RenderCvars) { if ($c -match '^\s*wl\.') { throw "-RenderCvars takes rendering commands only (no wl.*): $c" } }
$utc = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$tag = $(if ($Control) { "CONTROL_$Scenario" } else { $Scenario })
# v3.1a (7a7faf P2-2): only counted runs (JUDGED / CONTROL) go into the counted-runs folder
$notCounted = ($Scenario -eq 'survey') -or [bool]$RelaySource -or [bool]$ServerTree
$runRole = $(if ($Control) { 'CONTROL' } elseif ($RelaySource -or $ServerTree) { 'REHEARSAL_NOT_PREREG' } elseif ($Scenario -eq 'survey') { 'SURVEY' } else { 'JUDGED' })
if ($Control -and $notCounted) { Refuse0 "-Control runs are counted CONTROL runs: not with -Scenario survey, -RelaySource or -ServerTree" }
if (-not $NotCountedRoot) { $NotCountedRoot = Join-Path (Split-Path ([IO.Path]::GetFullPath($RunsRoot).TrimEnd('\')) -Parent) 'NOT_COUNTED_b33' }
$rrFull = [IO.Path]::GetFullPath($RunsRoot).TrimEnd('\') + '\'; $ncFull = [IO.Path]::GetFullPath($NotCountedRoot).TrimEnd('\') + '\'
if ($ncFull.StartsWith($rrFull, [StringComparison]::OrdinalIgnoreCase) -or $rrFull.StartsWith($ncFull, [StringComparison]::OrdinalIgnoreCase)) { Refuse0 "-NotCountedRoot $NotCountedRoot must be OUTSIDE the counted-runs folder $RunsRoot (and not contain it)" }
if ($LeaseGb -lt 5.0) { Refuse0 "-LeaseGb $LeaseGb is below the enforced gate 5.0 GB (PREREG B33 v3 / v3.1a)" }
if ($runRole -eq 'SURVEY') { $run = Join-Path $NotCountedRoot ("SURVEY_b33_{0}" -f $utc) }
elseif ($runRole -eq 'REHEARSAL_NOT_PREREG') { $run = Join-Path $NotCountedRoot ("REHEARSAL_NOT_PREREG_b33_{0}_{1}" -f $tag, $utc) }
else { $run = Join-Path $RunsRoot ("DIAGNOSTIC_b33_{0}_{1}" -f $tag, $utc) }
New-Item -ItemType Directory -Force $run | Out-Null
$LL = Join-Path $run 'LAUNCH_LOG.txt'
function Say([string]$t) { $l = "$((Get-Date).ToUniversalTime().ToString('o')) $t"; Add-Content -Path $LL -Value $l -Encoding utf8; Write-Host $l }
Say ("B33 launcher (W2DEV) DIAGNOSTIC, dev loopback, dev identities: never scoring evidence. role={0} scenario={1}" -f $(if ($Control) { 'CONTROL (must-fail control, never a judged run)' } else { 'JUDGED' }), $Scenario)
if (Get-Process -Name Wonderland -ErrorAction SilentlyContinue) { if ($DryChecks) { Say 'DRYCHECKS note: a Wonderland.exe is running (a real launch would refuse)' } else { Say 'RESULT refused: a Wonderland.exe is already running'; exit 2 } }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { if ($DryChecks) { Say "DRYCHECKS note: port $Port is in use (a real launch would refuse)" } else { Say "RESULT refused: port $Port is in use"; exit 2 } }
Say "CANDIDATE $($candRec.label) ($CandidateFile sha256 $($candRec.file_sha256)$(if (-not $candIsDefault) { ', NOT the default file: TEST ONLY' }))"
Say "package $Package boot sha256 $bootSha game exe sha256 $gameSha commit $Commit (both exes = the candidate's)"
function RunNative([string]$exe, [string[]]$argv, [string]$cwd, [string]$outFile) {
  # a native tool, waited for, stdout + stderr to files (Windows PowerShell 5.1 turns native stderr into terminating errors under Stop)
  $p = Start-Process -FilePath $exe -ArgumentList $argv -WorkingDirectory $cwd -Wait -PassThru -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError ($outFile + '.err')
  return $p.ExitCode
}
function GitOut([string[]]$a) {
  # git's answer, or $null when git fails (EAP Continue here: PowerShell 5.1 would turn git's stderr into a terminating error under Stop)
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $o = & git -c safe.directory=* @a 2>$null; if ($LASTEXITCODE -ne 0) { return $null }; return (($o | Out-String).Trim()) } finally { $ErrorActionPreference = $old }
}
if ($RelaySource) {
  # v3.1k P83: the ring relay from a worktree at ONE explicit commit (never the default cbe584be by accident, never with -ServerTree)
  if ($ServerTree) { Say 'RESULT refused: -RelaySource and -ServerTree exclude each other'; exit 2 }
  if (-not $PSBoundParameters.ContainsKey('RelayCommit')) { Say 'RESULT refused: -RelaySource needs an explicit -RelayCommit <sha> (the commit the relay runs from is recorded)'; exit 2 }
  if (-not (Test-Path (Join-Path $RelaySource '.git'))) { Say "RESULT refused: -RelaySource $RelaySource is not a git worktree (no .git)"; exit 2 }
}
$serverPrereg = (-not $ServerTree) -and (-not $RelaySource)
$serverArchive = -not $ServerTree          # the prereg cbe584be OR the -RelaySource commit: both are a git archive of ONE recorded commit
$relayRepo = $(if ($RelaySource) { $RelaySource } else { $SundayRelay })
$ringRec = $null
if ($serverArchive) {
  # ---- the server's inputs are checked BEFORE the lease (refusal costs nothing)
  $relayFull = GitOut @('-C', $relayRepo, 'rev-parse', "$RelayCommit^{commit}")
  if (-not $relayFull) { Say "RESULT refused: $RelayCommit is not a commit in $relayRepo"; exit 2 }
  $relayTree = GitOut @('-C', $relayRepo, 'rev-parse', "$RelayCommit^{tree}")
  if ($RelaySource) {
    $wtHead = GitOut @('-C', $RelaySource, 'rev-parse', 'HEAD')
    $wtBranch = GitOut @('-C', $RelaySource, 'rev-parse', '--abbrev-ref', 'HEAD')
    $wtStatus = GitOut @('-C', $RelaySource, 'status', '--porcelain=v1', '--untracked-files=all')
    $stFile = Join-Path $run 'relay_worktree_status.txt'
    [IO.File]::WriteAllText($stFile, $(if ($null -eq $wtStatus) { "git status FAILED`n" } else { ($wtStatus -replace "`r", '') + "`n" }), (New-Object System.Text.UTF8Encoding($false)))
    $ringRec = [ordered]@{ relay_source = $RelaySource; relay_commit_given = $RelayCommit; commit = $relayFull; tree = $relayTree
      worktree_head = $wtHead; worktree_branch = $wtBranch; head_is_relay_commit = ($wtHead -eq $relayFull)
      worktree_clean = ($null -ne $wtStatus -and $wtStatus -eq ''); worktree_status_lines = $(if ($wtStatus) { @($wtStatus -split "`n").Count } else { 0 })
      worktree_status_file = 'relay_worktree_status.txt'; runs_from = 'git archive of the COMMIT (relay-bridge, src, package.json), never the working files'
      prereg = $false; note = 'NOT-PREREG ring relay (transport ring rehearsal, r16reh18): the judge VOIDs the run and still prints every scenario (R7-08)' }
    $ringRec | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $run 'RELAY_SOURCE.json') -Encoding utf8
    Say ("server: RING RELAY -RelaySource {0} at {1} (tree {2}); worktree HEAD {3} ({4}), HEAD is the commit: {5}, clean: {6} -- NOT-PREREG" -f $RelaySource, $relayFull, $relayTree, $wtHead, $wtBranch, $ringRec.head_is_relay_commit, $ringRec.worktree_clean)
  }
  $lockA = GitOut @('-C', $relayRepo, 'rev-parse', "$($RelayCommit):package-lock.json")
  $lockFile = Join-Path $NodeModulesFrom 'package-lock.json'
  $lockB = $(if (Test-Path $lockFile) { GitOut @('hash-object', $lockFile) } else { $null })
  if (-not $lockA -or $lockA -ne $lockB) { Say "RESULT refused: $NodeModulesFrom\package-lock.json (blob $lockB) is not byte-identical to $RelayCommit's (blob $lockA): no NODE_PATH from it"; exit 2 }
  $esb = Join-Path $NodeModulesFrom 'node_modules\.bin\esbuild.cmd'
  if (-not (Test-Path $esb)) { Say "RESULT refused: no esbuild in $NodeModulesFrom\node_modules"; exit 2 }
  $archived = GitOut @('-C', $relayRepo, 'ls-tree', '-r', $relayFull, '--', 'relay-bridge', 'src', 'package.json')
  if (-not $archived) { Say "RESULT refused: nothing to archive at $relayFull"; exit 2 }
  Say "server: $(if ($RelaySource) { 'ring relay' } else { 'sunday-relay' }) $relayFull (tree $relayTree); package-lock blob $lockA identical in $NodeModulesFrom"
} else {
  Say "server: OVERRIDE -ServerTree $ServerTree -- this run is NOT-PREREG (PREREG_B33_PRECONDITION_v2 section 3 names cbe584be's own server)"
}
# ---- the clients' arguments and the disclosed block, fixed BEFORE -DryChecks / the lease (RUN.json carries these very objects)
$logCvars = @("wl.Remote.LogPeriod $LogPeriod")
function ClientArgs([string]$ud, [int]$winX, [string]$ident, [string[]]$extra) {
  # empty entries dropped: an empty [string[]] argument can arrive as one '' (that was the trailing comma on the observer's -ExecCmds)
  $cmds = @(@("wl.Social.Dev $ident http://127.0.0.1:$Port") + $logCvars + $RenderCvars + $extra | Where-Object { $_ -and $_.Trim() })
  $flush = $(if ($ForceLogFlush) { ' -forcelogflush' } else { '' })
  return "-userdir=`"$ud`" -windowed -ResX=$ResX -ResY=$ResY -WinX=$winX -WinY=$WinY -wldev$flush -ExecCmds=`"$($cmds -join ',')`""   # no -wlframes (M2 B-5)
}
$udS = Join-Path $run 'sender'; $udO = Join-Path $run 'observer'
$argS = ClientArgs $udS $SenderX $SenderName @()
$obsExtra = @(); if ($Control) { $obsExtra = $CONTROL_CVARS }   # an explicit array: $(if ... else { @() }) gives $null, i.e. one '' entry
$argO = ClientArgs $udO $ObserverX $ObserverName $obsExtra
$disclosed = [ordered]@{
  logging_cvars = $logCvars; render_cvars = @($RenderCvars); control_cvars_observer = @($obsExtra)
  switches = @('-wldev (needed by wl.Social.Dev)', "-windowed -ResX=$ResX -ResY=$ResY -WinX/-WinY (ignored by the client; the launcher places the windows)") + $(if ($ForceLogFlush) { @('-forcelogflush') } else { @() })
  # THE EXACT LAUNCH SWITCH LIST (M2 ruling B-5): the judge VOIDs any switch in a client's own LogInit Command Line that is not in this list
  launch_switches = @('-userdir', '-windowed', '-ResX', '-ResY', '-WinX', '-WinY', '-wldev', '-ExecCmds') + $(if ($ForceLogFlush) { @('-forcelogflush') } else { @() })
  gameplay_cvars = @()
}
$PREREG_RENDER = @('scalability 0')   # PREREG B33 v3 judged launch (the judge's PREREG_RENDER_CVARS is authoritative; this only prints the NOTE)
$preregLaunch = $serverPrereg -and ((@($RenderCvars) -join '|') -ceq ($PREREG_RENDER -join '|')) -and ($LogPeriod -eq 0.1) -and (-not $ForceLogFlush)
if (-not $preregLaunch) { Say "NOTE: NOT the PREREG B33 v3 judged launch (-RenderCvars 'scalability 0', -LogPeriod 0.1, no -ForceLogFlush, cbe584be server): the judge VOIDs this run" }
Say "planned SENDER args: $argS"
Say "planned OBSERVER args: $argO"
if ($DryChecks) {
  # every input check above passed; record them and stop: no lease, no build, no server, no client
  $dc = [ordered]@{ drychecks = $true; role = $runRole; counted = (-not $notCounted); run_folder = $run; lease_gb = $LeaseGb; in_run_guard_gb = $InRunGuardGb; utc = (Get-Date).ToUniversalTime().ToString('o'); exe_sha256 = $gameSha; boot_sha256 = $bootSha; commit = $Commit; prereg_server = $serverPrereg
    candidate = $candRec; prereg_launch = $preregLaunch; server_port = $Port; disclosed = $disclosed
    planned = [ordered]@{ sender = [ordered]@{ identity = $SenderName; args = $argS; cmdline = "$boot $argS" }; observer = [ordered]@{ identity = $ObserverName; args = $argO; cmdline = "$boot $argO" } } }
  if ($serverArchive) {
    $listText = ($archived -replace "`r", '') + "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    $listSha = -join ($sha.ComputeHash((New-Object System.Text.UTF8Encoding($false)).GetBytes($listText)) | ForEach-Object { $_.ToString('x2') })
    $dc.server = [ordered]@{ prereg = $serverPrereg; repo = $relayRepo; commit = $relayFull; tree = $relayTree; ring = $ringRec; relay_pin = $relayPinRec; package_lock_blob_commit = $lockA; package_lock_blob_node_modules = $lockB
      package_lock_identical = ($lockA -eq $lockB); node_modules_from = $NodeModulesFrom; archive_files = @($archived -split "`n" | Where-Object { $_ }).Count; archive_file_list_sha256 = $listSha }
  } else { $dc.server = [ordered]@{ prereg = $false; tree_dir = $ServerTree } }
  $dc | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $run 'DRYCHECKS.json') -Encoding utf8
  Say 'DRYCHECKS: inputs valid; nothing started (no lease, no build, no server, no client)'
  exit 0
}
# ---- 2. lease
$job = "b33_{0}_{1}" -f $tag, $utc
$leaseId = $null; $tries = [Math]::Max(1, [int]($LeaseWaitMin * 2))
for ($i = 0; $i -lt $tries -and -not $leaseId; $i++) {
  $out = & python -I $leaseTool acquire --owner WONDERLAND --job $job --gb $LeaseGb --pid $PID 2>&1
  if ($LASTEXITCODE -eq 0) { $leaseId = ($out | Select-Object -Last 1).ToString().Trim() }
  else { if ($i % 6 -eq 0) { Say "waiting for the lease (exit $LASTEXITCODE): $out" }; Start-Sleep -Seconds 30 }
}
if (-not $leaseId) { Say 'RESULT NO_LEASE (exit 5 from heavy-lease.py every time)'; exit 5 }
$os = Get-CimInstance Win32_OperatingSystem
$freeGb = [Math]::Round($os.FreePhysicalMemory / 1MB, 3)
$availMb = $null; try { $availMb = [Math]::Round((Get-Counter '\Memory\Available MBytes' -ErrorAction Stop).CounterSamples[0].CookedValue, 0) } catch { }
Say "lease $leaseId; RAM free at start $freeGb GB (Win32_OperatingSystem.FreePhysicalMemory), Available MBytes $availMb"
$state = @{ server = $null; sender = $null; observer = $null; frames = $null }
function ProcRec($id) {
  # v3.1f P62 (T-1 / L11): never throws; a process that is gone or exiting (no StartTime) gives no record (the stop then never touches it)
  try {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $p) { return $null }
    $st = $null; try { $st = $p.StartTime } catch { $st = $null }
    if ($null -eq $st) { return $null }
    return [ordered]@{ pid = $id; name = $p.ProcessName; start_utc = $st.ToUniversalTime().ToString('o') }
  } catch { return $null }
}
function ClientPids([string]$userdir) { @(Get-CimInstance Win32_Process -Filter "Name='Wonderland.exe'" | Where-Object { $_.CommandLine -like "*$userdir*" } | ForEach-Object { [int]$_.ProcessId }) }
function WindowOf([int[]]$ids) { foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { return $p } }; return $null }
function GamePid([string]$userdir) {
  # the GAME process (the packaged Wonderland\Binaries\Win64\Wonderland.exe child with this -userdir), never the boot stub
  $g = @(Get-CimInstance Win32_Process -Filter "Name='Wonderland.exe'" | Where-Object { $_.CommandLine -like "*$userdir*" -and $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($game)) })
  if ($g.Count -eq 1) { return [int]$g[0].ProcessId }
  return 0
}
function StableClient([IntPtr]$h, [double]$timeoutSec = 60) {
  # the client rect, once it has stayed the same for 3 reads 0.5 s apart (the game resizes itself while it starts)
  $t0 = Get-Date; $prev = $null; $same = 0
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutSec) {
    $c = ConvertTo-Rect ([B33.Win]::ClientOnScreen($h))
    if ((Test-RectUsable $c 64 64) -and $prev -and (Test-RectNear $c $prev 0)) { $same++; if ($same -ge 2) { return $c } } else { $same = 0 }
    $prev = $c; Start-Sleep -Milliseconds 500
  }
  return $null
}
function RamGuardTrips([double]$freeGb, [double]$guardGb) {
  # v3.1a (7a7faf P2-4): the in-run guard trips when free RAM is BELOW the guard (a stop; it never decides a verdict); 0 disables it
  return ($guardGb -gt 0 -and $freeGb -lt $guardGb)
}
function WatchFirewall([double]$sec) {
  $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt $sec) {
    $w = [B33.Win]::FindVisibleTitle('Windows Security Alert')
    if ($w) { Say "FIREWALL PROMPT VISIBLE: $w -- a PERSON must close it with the X button (never Allow). The tools never touch it."; return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}
$exitCode = 0
try {
  # ---- 3. dev server
  $mjs = Join-Path $run 'dev-social.mjs'   # this name: the bundle's entry check (/dev-social(-server)?\.(m?js|ts)$/) starts the listener
  $banner = "import { createRequire } from 'module'; import { fileURLToPath as __wlF } from 'url'; import { dirname as __wlD } from 'path'; const require = createRequire(import.meta.url); const __filename = __wlF(import.meta.url); const __dirname = __wlD(__filename);"
  if ($serverArchive) {
    $src = Join-Path $run 'relay_src'; $tar = Join-Path $run 'relay_src.tar'
    $git = (Get-Command git).Source
    if ((RunNative $git @('-c', 'safe.directory=*', '-C', "`"$relayRepo`"", 'archive', '--format=tar', '-o', "`"$tar`"", $relayFull, 'relay-bridge', 'src', 'package.json') $run (Join-Path $run 'relay_archive.txt')) -ne 0) { throw 'git archive failed (relay_archive.txt)' }
    $tarSha = (Get-FileHash $tar -Algorithm SHA256).Hash.ToLower()
    $listFile = Join-Path $run 'relay_archive_files.txt'
    [IO.File]::WriteAllText($listFile, ($archived -replace "`r", '') + "`n", (New-Object System.Text.UTF8Encoding($false)))
    $listSha = (Get-FileHash $listFile -Algorithm SHA256).Hash.ToLower()
    $nFiles = @($archived -split "`n" | Where-Object { $_ }).Count
    New-Item -ItemType Directory -Force $src | Out-Null
    if ((RunNative "$env:SystemRoot\System32\tar.exe" @('-xf', "`"$tar`"", '-C', "`"$src`"") $run (Join-Path $run 'relay_extract.txt')) -ne 0) { throw 'tar extract failed (relay_extract.txt)' }
    $entrySha = (Get-FileHash (Join-Path $src 'relay-bridge\dev-social-server.ts') -Algorithm SHA256).Hash.ToLower()
    $env:NODE_PATH = Join-Path $NodeModulesFrom 'node_modules'
    try {
      $code = RunNative $esb @('relay-bridge\dev-social-server.ts', '--bundle', '--platform=node', '--format=esm', "`"--outfile=$mjs`"", "`"--banner:js=$banner`"", '--log-level=warning') $src (Join-Path $run 'relay_build.txt')
      if ($code -ne 0 -or -not (Test-Path $mjs)) { throw 'esbuild failed (relay_build.txt)' }
    } finally { Remove-Item Env:\NODE_PATH -ErrorAction SilentlyContinue }
    if (@(Get-ChildItem -LiteralPath $src -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue).Count -gt 0) { throw "reparse point inside ${src}: not deleting it" }
    Remove-Item -LiteralPath $src -Recurse -Force; Remove-Item -LiteralPath $tar -Force
    $mjsSha = (Get-FileHash $mjs -Algorithm SHA256).Hash.ToLower()
    $serverRec = [ordered]@{ prereg = $serverPrereg
      kind = $(if ($RelaySource) { "NOT-PREREG RING RELAY (-RelaySource): $RelayCommit's relay-bridge/dev-social-server.ts from $RelaySource, unchanged (dev sessions, in-memory store, loopback)" } else { "THE RELAY PIN (RELAY_PIN.json): sunday-relay $RelayCommit's OWN relay-bridge/dev-social-server.ts, unchanged (dev sessions, in-memory store, loopback)" })
      ring = $ringRec; relay_pin = $relayPinRec
      repo = $relayRepo; commit = $relayFull; tree = $relayTree; archive_paths = @('relay-bridge', 'src', 'package.json'); archive_files = $nFiles
      archive_file_list = 'relay_archive_files.txt'; archive_file_list_sha256 = $listSha; archive_tar_sha256 = $tarSha; entry_sha256 = $entrySha
      node_modules_from = $NodeModulesFrom; package_lock_blob_commit = $lockA; package_lock_blob_node_modules = $lockB; package_lock_identical = $true
      bundle = 'dev-social.mjs'; bundle_sha256 = $mjsSha; port = $Port }
    $where = $(if ($RelaySource) { "RING RELAY $RelaySource $relayFull (NOT-PREREG)" } else { "sunday-relay $relayFull" })
  } else {
    Push-Location $ServerTree
    try { & (Join-Path $ServerTree 'node_modules\.bin\esbuild.cmd') (Join-Path $ServerTree 'relay-bridge\dev-social-server.ts') --bundle --platform=node --format=esm "--outfile=$mjs" "--banner:js=$banner" --log-level=warning | Out-Null } finally { Pop-Location }
    $mjsSha = (Get-FileHash $mjs -Algorithm SHA256).Hash.ToLower()
    $serverRec = [ordered]@{ prereg = $false; kind = 'NOT-PREREG OVERRIDE: -ServerTree'; tree_dir = $ServerTree; head = (GitOut @('-C', $ServerTree, 'rev-parse', 'HEAD'))
      bundle = 'dev-social.mjs'; bundle_sha256 = $mjsSha; port = $Port }
    $where = "OVERRIDE $ServerTree (NOT-PREREG)"
  }
  $srv = Start-Process (Get-Command node).Source -ArgumentList @("`"$mjs`"", "$Port") -WorkingDirectory $run -PassThru -WindowStyle Hidden -RedirectStandardOutput "$run\srv_out.txt" -RedirectStandardError "$run\srv_err.txt"
  $state.server = $srv.Id
  $ok = $false; for ($k = 0; $k -lt 60 -and -not $ok; $k++) { Start-Sleep -Milliseconds 250; if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { $ok = $true } }
  if (-not $ok) { throw 'the dev server did not listen (srv_err.txt)' }
  $serverRec.pid = $srv.Id
  $serverRec.procs = @(ProcRec $srv.Id)   # b33_stop.ps1 stops exactly this process (pid + start time)
  Say "dev server pid $($srv.Id) on 127.0.0.1:$Port from $where (bundle sha256 $mjsSha)"
  # ---- 4. clients
  New-Item -ItemType Directory -Force $udS, $udO | Out-Null   # $argS / $argO / $disclosed were fixed before the lease (see -DryChecks)
  Say "launch SENDER: $boot $argS"
  $null = Start-Process $boot -ArgumentList $argS -PassThru
  $t0 = Get-Date; $wS = $null
  while (-not $wS -and ((Get-Date) - $t0).TotalSeconds -lt 120) { Start-Sleep -Seconds 1; $wS = WindowOf (ClientPids $udS) }
  if (-not $wS) { throw 'the sender window did not appear in 120 s' }
  [void](WatchFirewall 20)
  Say "launch OBSERVER: $boot $argO"
  $null = Start-Process $boot -ArgumentList $argO -PassThru
  $t0 = Get-Date; $wO = $null
  while (-not $wO -and ((Get-Date) - $t0).TotalSeconds -lt 120) { Start-Sleep -Seconds 1; $wO = WindowOf (ClientPids $udO) }
  if (-not $wO) { throw 'the observer window did not appear in 120 s' }
  [void](WatchFirewall 20)
  # ---- 5. joined
  $logS = Join-Path $udS 'Saved\Logs\Wonderland.log'; $logO = Join-Path $udO 'Saved\Logs\Wonderland.log'
  $t0 = Get-Date; $jS = $false; $jO = $false
  while (-not ($jS -and $jO) -and ((Get-Date) - $t0).TotalSeconds -lt $JoinTimeoutSec) {
    Start-Sleep -Seconds 2
    if (-not $jS -and (Test-Path $logS)) { $jS = [bool](Select-String -Path $logS -Pattern 'WLWORLD joined' -Quiet) }
    if (-not $jO -and (Test-Path $logO)) { $jO = [bool](Select-String -Path $logO -Pattern 'WLWORLD joined' -Quiet) }
    if ([B33.Win]::FindVisibleTitle('Windows Security Alert')) { [void](WatchFirewall 1) }
  }
  Say "joined: sender $jS observer $jO (log file stamps may lag the game at boot; the drive waits for a fresh log)"
  if (-not ($jS -and $jO)) { throw 'both clients did not join a world in time' }
  $pS = @(ClientPids $udS); $pO = @(ClientPids $udO)   # @(): a one-element result would unroll to a scalar ($pS + $pO would ADD two pids)
  $state.sender = $pS; $state.observer = $pO
  # ---- 5b. window layout: the game windows, placed and verified in physical pixels (PER_MONITOR_AWARE_V2 thread context)
  $gS = GamePid $udS; $gO = GamePid $udO
  if (-not $gS -or -not $gO) { throw "could not tell each client's GAME process (sender $gS, observer $gO)" }
  $hS = (Get-Process -Id $gS).MainWindowHandle; $hO = (Get-Process -Id $gO).MainWindowHandle
  if ($hS -eq [IntPtr]::Zero -or $hO -eq [IntPtr]::Zero) { throw 'a game process has no main window' }
  Say ("game pids: sender {0}, observer {1}; per-monitor-v2 thread context available: {2}" -f $gS, $gO, [B33.Win]::PerMonitorV2Available())
  $c0S = StableClient $hS; $c0O = StableClient $hO
  Say ("client rects before placement (physical px): sender {0}, observer {1}" -f (Format-Rect $c0S), (Format-Rect $c0O))
  $targets = Get-LayoutTargets $FrameW $FrameH $FrameY $SenderX $ObserverX
  $layoutWhy = @('not placed'); $fS = $null; $fO = $null; $cS = $null; $cO = $null
  for ($try = 1; $try -le 3 -and $layoutWhy.Count -gt 0; $try++) {
    [void][B33.Win]::Place($hS, $targets.sender.left, $targets.sender.top, $FrameW, $FrameH)
    [void][B33.Win]::Place($hO, $targets.observer.left, $targets.observer.top, $FrameW, $FrameH)
    Start-Sleep -Milliseconds 1500
    $cS = StableClient $hS 20; $cO = StableClient $hO 20
    $fS = ConvertTo-Rect ([B33.Win]::FrameRect($hS)); $fO = ConvertTo-Rect ([B33.Win]::FrameRect($hO))
    $layoutWhy = Test-Layout $targets $fS $fO $cS $cO $LayoutTolPx
    Say ("layout try {0}: sender frame {1} client {2}; observer frame {3} client {4}; {5}" -f $try, (Format-Rect $fS), (Format-Rect $cS), (Format-Rect $fO), (Format-Rect $cO), $(if ($layoutWhy.Count) { 'NOT OK: ' + ($layoutWhy -join '; ') } else { 'OK' }))
  }
  $layout = [ordered]@{ ok = ($layoutWhy.Count -eq 0); why = @($layoutWhy); tolerance_px = $LayoutTolPx; method = 'SetWindowPos(hwnd,0,x,y,w,h,SWP_NOZORDER|SWP_NOACTIVATE) from a PER_MONITOR_AWARE_V2 thread; rects re-read the same way (physical px)'
    target_sender_frame = $targets.sender; target_observer_frame = $targets.observer; resx_resy_ignored_by_client = $true
    before_sender_client = $c0S; before_observer_client = $c0O }
  # ---- 6. frames + RUN.json
  if (-not $NoFrames) {
    New-Item -ItemType Directory -Force (Join-Path $run 'frames') | Out-Null
    $fr = Start-Process powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'b33_frames.ps1') + '"'), '-Run', ('"' + $run + '"'), '-ObserverPids', "$gO", '-Fps', "$Fps") -PassThru -WindowStyle Hidden
    $state.frames = $fr.Id
    Say "frames capture pid $($fr.Id) (captures only while the drive's CAPTURE flag exists)"
  }
  $runRec = [ordered]@{
    run_id = (Split-Path $run -Leaf); label = $(if ($serverPrereg) { 'DIAGNOSTIC B33 package precondition (dev loopback, dev identities; never scoring evidence)' } elseif ($RelaySource) { 'DIAGNOSTIC B33 NOT-PREREG (server override -RelaySource; dev loopback; never scoring evidence)' } else { 'DIAGNOSTIC B33 NOT-PREREG (server override -ServerTree; dev loopback; never scoring evidence)' })
    prereg_server = $serverPrereg
    role = $runRole; control = [bool]$Control; scenario = $Scenario; counted = (-not $notCounted); in_run_guard_gb = $InRunGuardGb
    package = $Package; exe_sha256 = $gameSha; exe_path = $game; boot_sha256 = $bootSha; commit = $Commit
    candidate = $candRec; prereg_launch = $preregLaunch
    ram_free_gb_at_start = $freeGb; ram_available_mb_at_start = $availMb; lease_id = $leaseId; lease_gb = $LeaseGb; launcher_pid = $PID
    started_utc = (Get-Date).ToUniversalTime().ToString('o')
    server = $serverRec
    sender = [ordered]@{ identity = $SenderName; userdir = $udS; log = $logS; pids = $pS; game_pid = $gS; procs = @($pS | ForEach-Object { ProcRec $_ }); cmdline = "$boot $argS"; frame_rect = $fS; client_rect = $cS }
    observer = [ordered]@{ identity = $ObserverName; userdir = $udO; log = $logO; pids = $pO; game_pid = $gO; procs = @($pO | ForEach-Object { ProcRec $_ }); cmdline = "$boot $argO"; frame_rect = $fO; client_rect = $cO }
    layout = $layout
    frames = [ordered]@{ pid = $state.frames; procs = @($(if ($state.frames) { ProcRec $state.frames })); fps = $Fps }
    disclosed = $disclosed   # the very object fixed before the lease (launch_switches = THE EXACT LAUNCH SWITCH LIST, M2 ruling B-5)
  }
  $runRec | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $run 'RUN.json') -Encoding utf8
  if (-not $layout.ok) { Say ('LAYOUT REFUSED: ' + ($layoutWhy -join '; ') + ' -- no READY; closing the run'); throw 'window layout refused' }
  Set-Content -Path (Join-Path $run 'READY') -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ascii
  Say "READY: RUN.json written. Next: b33_drive.ps1 -Run `"$run`" -Mode <jumps|m4>, then b33_stop.ps1 -Run `"$run`", then b33_judge.py `"$run`""
  # ---- 7. conductor wait (v3.1a: with the in-run RAM guard; a STOP, never a verdict)
  $t0 = Get-Date
  $ramMin = $freeGb; $ramN = 0; $ramTrip = $null
  while ($true) {
    Start-Sleep -Seconds 3
    try { $fr = [Math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 3); $ramN++; if ($fr -lt $ramMin) { $ramMin = $fr } } catch { $fr = $null }
    if ($null -ne $fr -and (RamGuardTrips $fr $InRunGuardGb)) {
      $ramTrip = (Get-Date).ToUniversalTime().ToString('o')
      Set-Content -Path (Join-Path $run 'RAM_GUARD_TRIP.txt') -Value ("{0} free {1} GB < in-run guard {2} GB: the run is STOPPED (never a verdict; unfinished blocks are INCOMPLETE)" -f $ramTrip, $fr, $InRunGuardGb) -Encoding ascii
      Say ("RAM GUARD: free {0} GB < {1} GB: stopping the run (a stop, never a verdict)" -f $fr, $InRunGuardGb); break
    }
    if (Test-Path (Join-Path $run 'STOP_REQUEST')) { Say 'STOP_REQUEST seen'; break }
    if (-not (Get-Process -Id ($pS + $pO) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Wonderland' })) { Say 'both clients ended'; break }
    $goneS = -not (Get-Process -Id $pS -ErrorAction SilentlyContinue); $goneO = -not (Get-Process -Id $pO -ErrorAction SilentlyContinue)
    if ($goneS -or $goneO) { Say ("a client ended (sender gone {0}, observer gone {1})" -f $goneS, $goneO); break }
    if (((Get-Date) - $t0).TotalMinutes -gt $MaxMinutes) { Say "MaxMinutes $MaxMinutes reached"; break }
    if ([B33.Win]::FindVisibleTitle('Windows Security Alert')) { [void](WatchFirewall 1) }
  }
  # v3.1a: the RAM record, written before the close so the stop hashes it (descriptive: the judge copies it; it decides nothing)
  [ordered]@{ lease_gb = $LeaseGb; ram_free_gb_at_start = $freeGb; ram_available_mb_at_start = $availMb; in_run_guard_gb = $InRunGuardGb
    in_run_min_free_gb = $ramMin; in_run_readings = $ramN; in_run_interval_s = 3; guard_tripped = ($null -ne $ramTrip); guard_trip_utc = $ramTrip } |
    ConvertTo-Json | Set-Content -Path (Join-Path $run 'RAM_LOG.json') -Encoding utf8
} catch {
  Say ("LAUNCH ERROR: {0}" -f $_.Exception.Message); $exitCode = 3
} finally {
  # the stop script needs RUN.json; on an early error, write what is known so it can still kill only what this launcher started
  # v3.1f P62: every finally step in its own try (T-1: a throw here skipped the stop and the lease release)
  try {
  if (-not (Test-Path (Join-Path $run 'RUN.json'))) {
    $partial = [ordered]@{ run_id = (Split-Path $run -Leaf); role = $runRole; scenario = $Scenario; control = [bool]$Control; exe_sha256 = $gameSha; commit = $Commit; lease_id = $leaseId; launcher_pid = $PID; partial = $true
      server = [ordered]@{ pid = $state.server; procs = @($(if ($state.server) { ProcRec $state.server })) }
      sender = [ordered]@{ procs = @(ClientPids (Join-Path $run 'sender') | ForEach-Object { ProcRec $_ }) }
      observer = [ordered]@{ procs = @(ClientPids (Join-Path $run 'observer') | ForEach-Object { ProcRec $_ }) }
      frames = [ordered]@{ procs = @($(if ($state.frames) { ProcRec $state.frames })) } }
    $partial | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $run 'RUN.json') -Encoding utf8
  }
  } catch { Say ("FINALLY: the partial RUN.json could not be written: {0}" -f $_.Exception.Message) }
  # v3.1e: the stop's report goes to STOP_LOG.txt and the console, NEVER into LAUNCH_LOG.txt: the stop hashes LAUNCH_LOG.txt into
  # SHA256SUMS_AT_CLOSE.txt, and appending "stop: ..." lines after that made every closed run's LAUNCH_LOG.txt fail its close sum
  $stopLines = @()
  try { $stopLines = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'b33_stop.ps1') -Run $run -FromLauncher | ForEach-Object { "$((Get-Date).ToUniversalTime().ToString('o')) stop: $_" }) }
  catch { $stopLines += "$((Get-Date).ToUniversalTime().ToString('o')) stop: FAILED TO RUN: $($_.Exception.Message)" }
  try { Set-Content -Path (Join-Path $run 'STOP_LOG.txt') -Value $stopLines -Encoding utf8 } catch { }
  foreach ($l in $stopLines) { Write-Host $l }
}
exit $exitCode
