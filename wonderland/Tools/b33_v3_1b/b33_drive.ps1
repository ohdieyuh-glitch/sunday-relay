# b33_drive.ps1 -- W2DEV real-OS-input driver for the B33 SENDER client (SendInput only). DIAGNOSTIC tool, W2DEV, not evidence by itself.
# What it does: drives the SENDER window of a run started by b33_launch.ps1 through
#   -Mode jumps     : STAND block (>= 12 standing jumps, >= 1.5 s idle between), WALK block (W held, jump mid-stride, >= 12, walked passes on the
#                     runway with walked 180-degree turns by mouse), RUN block (W + LeftShift held on the straights, >= 12)
#   -Mode m4        : WALKS (no teleport, no wl.Dev.*) the route's approach to the named kerb, steps onto it by short W taps, checks it is ON the
#                     kerb from the sender's own "send motion ... z=" lines (z inside mount.kerb_z, x/y inside the box, IDLE), turns to walk_off.yaw,
#                     walks off (W only, never Space), lets it settle, walks the return route, repeats (-M4Repeats, default 10:
#                     Q-M2c-5 (b), EXACTLY 10 walk-off attempts per counted run, each followed by the return; no attempt is ever skipped or
#                     repeated because of its height: the drive does not read the drop at all)
#   -Mode survey    : the declared route survey (M2 ruling B-9), no jump and no counted fall: the jump runway (approach, then a walk to y_hi, a
#                     180-degree turn and a walk back to y_lo, in a SURVEY_RUNWAY block), then the M4 approach + mount; with -SurveyReturn also a
#                     walk-off in a SURVEY_WALKOFF block (its fall is printed by b33_survey_record.py and NEVER counted), the return route, the
#                     approach again and a second mount. b33_survey_record.py turns the run into a SURVEY_RECORD and checks a proposed route file.
#   -Mode calibrate : the mouse calibration only
#   -Mode all       : v3.1 (M2b review R7-01): ONE judged run = the jump blocks (as -Mode jumps) then the M4 blocks (as -Mode m4) in ONE drive,
#                     so each judged run carries all four scenarios and the CONTROL clearance condition (b) is reachable
# v3.1 ROUTE FOLLOWING (rehearsal survey 1, 10-20, DEV harness: a ~70-degree turn taken WHILE walking swung ~150 uu wide at (149;3440) and
#   walked the Dog off the path's east edge to the plaza slab at z -11.8, then NO-PROGRESS at (307;4194)):
#   - CORNER: when a leg needs a turn sharper than -TurnStopDeg (35), the drive stops, turns the camera while standing, then walks;
#   - LEFT-THE-PATH: on any walked leg, if the sender's own soles z falls more than -DropAbortUu (40) within 1.0 s of game time, the drive
#     aborts at once (no blind walking on whatever is below); a route that walks DOWN stairs needs a larger -DropAbortUu.
# v3.1b (rehearsal survey 2, 10-20, route v2: the corner waypoint (150;3440) was SEEN 28 uu past it (log lag), the Dog coasted 46 uu more
#   east and down (93.4 -> 72.2), the corner turn was computed from the PRE-stop position, and the next leg walked down to a z 35 terrace;
#   the 1-s drop guard never fired because the 58 uu descent was split across the stop):
#   - PRECISE ARRIVAL: at a corner waypoint and at the last waypoint of a route, W is released within -PreciseUu (120) of the point and the
#     rest is closed with short taps (each tap stops), never past the point; the corner turn is computed AFTER the stop;
#   - OFF-PATH: the soles z must stay within -FloorTolUu (15) of the highest z seen on the current leg (through its stop and taps), at any
#     speed; a waypoint written [x, y, z] must be reached within -FloorTolUu below its z;
#   - HEADING HOLD: each leg steers to a point 250 uu ahead ON the leg line (cross-track correction, re-measured every ~0.2-0.45 s); a
#     heading error larger than -TurnStopDeg mid-leg is turned standing, never while walking;
#   - CALIBRATION: -CalPasses (2) passes, +turn then -turn, the same counts; the mean is used; passes that differ by more than
#     -CalSpreadMaxPct (8 %) abort ("not repeatable"); rehearsal 1 / 2 measured 6.044 / 5.468 with one pass each (a 10 % spread).
# v3.1c (rehearsal survey 3, 10-20, route v3: the approach, the mount and the walk-off WORKED, but the walk-off went -16 deg (south of +x)
#   from the box's south edge (161.5;4449.8) and first landed on a step at z 27.5 = 85.6 uu by the pinned reader (< 100); the camera
#   estimate was 81.5 while the actor's own yaw read 72.2: mouse turns were added to it during the mount taps without re-measuring):
#   - MOUNT DEEPER: the mount ends only ON the kerb AND within -MountTolUu (15) of mount.to's y (route v4: 4476, the middle of the ruled
#     4450..4505); after every tap the camera estimate is re-anchored on the ACTOR yaw (the sender's own yaw=, the tap's direction);
#   - WALK-OFF HEADING: after the standing turn to walk_off.yaw, -WalkOffProbes (v3.1d: 8) PROBE taps of -WalkOffProbeMs (60) make the actor face
#     the camera; its yaw is read and the error turned out until it is within -WalkOffTolDeg (5); still off -> abort WALKOFF-HEADING (no
#     walk-off); no probe within 14 uu of the box's east side; after the walk-off the estimate is re-anchored on the measured heading.
#   - CALIBRATION (lead 10-20 + the jumps rehearsal from snapshot A: 2 passes 4.913 / 5.980 = 19.6 %, abort): the turn is read from the
#     ACTOR's logged yaw (send soles ... yaw=, one clean value per movement; the position heading is logged next to it), walks of at least
#     -CalWalkMinS (1.2) before and -CalAfterMinS (1.4) after the turn whatever the route says, -CalPasses (3) passes +/-/+, the MEDIAN;
#     a spread above -CalSpreadMaxPct (10 %) turns the Dog around (the provisional median) and re-runs the passes ONCE, then aborts.
#     Evidence (actor yaw, 168 counts): the first + turn of a session read +27.8 / +30.7 / +30.0 / +34.2 deg, every - turn -28.1 / -28.2:
#     the session's first big mouse turn is the outlier, the median of 3 ignores it.
# v3.1d (rehearsal survey 4: CAL passes +31.8 / -39.9 deg for the same 168 counts, then pass 3 walked into a wall and aborted "no heading
#   after the turn", although its actor yaw had turned): CALIBRATION IS A STARTING GAIN, NOT A GATE (the steering is closed-loop: legs
#   re-measure the walked heading, corners and the walk-off are probed on the actor's logged yaw):
#   - the passes go OUT AND BACK (a standing 180-deg turn before each pass after the first), so the walks stay on ground already walked;
#   - a pass that is blocked (moved < 25 uu after the turn) is skipped; a pass blocked after its turn is still measured (actor yaw);
#   - separate gains for + and - turns (the median of each sign; the overall median if a sign has no pass), each clamped to
#     -CalMinCpd..-CalMaxCpd (3.5..9.0); the spread is LOGGED, never a reason to stop;
#   - abort only for broken input: a turn the wrong way, or no turn (< -CalNoTurnDeg, 5 deg) for the commanded 40 deg;
#   - PACED MOUSE like a real high-rate mouse: every move is sent as -MouseChunk (1) count every -MouseIntervalMs (2) ms from C#
#     (B33.Inp.RelPaced), the input guard, the foreground and the cursor's window checked before every count. Why: the game has
#     bEnableMouseSmoothing=True (DefaultInput.ini:15 at a82b2a5d) and the Dog reads MouseX through the legacy BindAxisKey path, so
#     UE 5.8's UPlayerInput::SmoothMouse rescales every frame's mouse delta by DeltaTime / (learned seconds-per-sample x samples) and
#     EXTRAPOLATES a frame with no sample. With one 20-count step per ~16 ms against ~11 ms frames (the pinned pacing) a model of that
#     code delivers 0.97..1.60 x the counts (mean 1.31), the spread the rehearsals measured (6.86 counts/deg by the engine's constant
#     factors / 1.14..1.63 = the 4.2..6.0 seen); with several samples per frame it delivers 0.98..1.01 x (REHEARSAL_FINDINGS F28);
#   - a standing WARM-UP (+/- -CalWarmupCounts, 200) before the passes teaches the engine the sample rate (its start value is 8.3 ms per
#     sample, so a session's first turn is under-delivered ~5 % without it);
#   - the Dog turns at RotationRate 260 deg/s (RelayDogCharacter.cpp:713; rehearsal maxima 259-277) and only while W is held
#     (ComputeOrientToMovementRotation follows the input acceleration), so a 60-ms probe tap turns the actor <= ~16 deg: up to
#     -WalkOffProbes 8 walk-off probes and 8 corner probes (was 5 / 6); a tap moves the Dog ~3 uu (acceleration 900, NormalAcceleration);
#   - FRESH READINGS: a probe or re-anchor reads only a sample stamped >= 30 ms after W's last release (Latest-After), and the movement
#     heading that re-anchors the estimate only samples after the last mouse move (Heading -sinceMs): with the real turn rate and the
#     log's lag the model showed a stale reading passing as converged, and a re-anchor on the pre-turn heading winding the steering up.
# v3.1e (rehearsal survey 5: calibration 7.128 counts/deg, spread 1.3 % as predicted; route v4's eastward mount fell into a trough between
#   the path's north end and the strip: MOUNT-FAILED at (109.6,4477.8) z 52.6):
#   - route v5 (routes\b33_route_v5.json) steps onto the strip where rehearsal 3 did (an 18.7 uu step at y ~4391-4404) and mounts NORTH
#     on the strip top, so the walk-off turn is ~75-95 deg. Turning the ACTOR that far costs ~15-25 uu of the ~20 uu before the edge guard
#     (rehearsal 5: a 60-ms tap turned it 17-23 deg and moved it 4-5 uu), so the WALK-OFF HEADING is now measured from the Dog's own
#     DISPLACEMENT: from rest, CharacterMovement accelerates along the input (= camera) direction whatever the actor faces (rehearsal 5's
#     corner probes moved at 17.4-19.6 deg while the camera was at ~19-20 and the actor still turning). -WalkOffTaps (3) taps of
#     -WalkOffProbeMs (30) per round (~2 uu each), the bearing from a fresh position before to a fresh one after = the camera yaw; within
#     -WalkOffTolDeg (5) -> walk off, else turn the error out and measure again, at most -WalkOffProbes (3) rounds; never within 14 uu of
#     the box's east side. Corners keep the actor-yaw probe (-CornerProbeMs 60), which also counts only taps that moved the Dog;
#   - WAIT-IDLE counts only samples stamped after W's last release: with the log's lag, samples from BEFORE a tap read as "idle" and the
#     model's precise arrival and mount then decided on a stale position (one mount tap overshot 95 uu);
#   - MOUNT-DOWN: a mount tap that takes the Dog more than -FloorTolUu below where the mount started aborts at once (rehearsal 5's first tap
#     went 94.4 -> 50.0 and the drive tapped on until MOUNT-FAILED);
#   - the model holds W -SimKeyUpLagMs (19) longer than sent, like the game.
# v3.1f (rehearsal survey 6 on route v5: ON THE KERB, the walk-off heading by displacement (one round, error -0.9 deg) and a walk-off of
#   116.7 uu by the survey record; then the v4/v5 return could not leave the landing: a wall at x ~307 east of it, as in every walk-off):
#   - a DESCENT LEG: a waypoint [x, y, z, "down"] lets the leg to it go DOWN to its z (rehearsal 3 walked from the terrace's SE corner
#     (290.9,4169.7) 29.7 down to the slab (310.9,4151.8) -11.8, all WALK, and LEFT-THE-PATH aborted it); on that leg the drop and floor
#     guards become one absolute floor: z below the waypoint's z minus -FloorTolUu aborts OFF-PATH. Route v6 uses it once;
#   - a CAREFUL waypoint [x, y, z, "careful"(, "down")]: the leg to it starts with a standing turn whenever the heading is more than 4 deg
#     off (with the corner probe), and ends with a precise arrival. For short legs on narrow ground (the terrace): the model showed a
#     26-deg turn taken while walking, with the log's lag and a paced mouse turn, carrying the Dog off a 60-uu-wide terrace. Its corner check
#     is the displacement probe (3 x 30-ms taps, ~6 uu a round, the bearing = the camera): the actor-yaw probe's 60-ms taps walk ~6 uu
#     EACH in the uncorrected direction (up to 8 of them), which in the model under a 21 % gain error put the Dog off the landing's corridor;
#   - Walk-Off waits for 500 ms of IDLE before its On-Kerb check (three IDLE samples; rehearsal 7 aborted "not on the kerb" while on it);
#   - Mount-Kerb waits 500 ms IDLE after each tap (rehearsal 10 gave up "at the mount target but not on the kerb" at (142.3,4452.0) z 112.7);
#   - a TIGHT waypoint (token "tight") closes its precise arrival to 12 uu instead of 35: rehearsal 9b met rehearsal 1's stairs from the side
#     (the slab's west side at x 306.9) because the arrival before them stopped 33 uu short and the next leg cut the corner.
# Inputs : <Run>\RUN.json (sender pids + log), the route file (default routes\b33_route_v1.json), the live sender log.
# Outputs: <Run>\drive_<mode>_<utc>\timeline.csv (UTC ms per step: every key down/up, mouse move, click, block begin/end, abort), drive.log,
#          DRIVE_RECORD.txt (hashes of the drive, native code, route; parameters). It toggles <Run>\frames\CAPTURE around blocks (b33_frames.ps1).
# SAFETY (memory core-drive-real-input-harness): low-level keyboard+mouse hooks on their own thread; every event of ours carries a marker, so
#   ANY other key/mouse event (a person = HARDWARE, or other software = FOREIGN injected) aborts at once and releases our keys; a hook positive
#   control (+1/-1 px) must be seen first; QuietSec of silence before the first input; the foreground window's pid is checked before EVERY
#   input, WindowFromPoint's pid before the one click and the cursor's window before every mouse move; never forces focus past a shell surface;
#   keys released in finally. The sender is raised TOPMOST (z-order only, no activation) before the click and for the whole drive.
#   REHEARSAL PATCH P1 (REHEARSAL COPY ONLY, NOT-PREREG; lead 10-20 B35 rehearsal finding): a foreground game clips the cursor to its own
#   client rect, so before the cursor jumps to the click point the drive reads GetClipCursor and, if the clip does not contain the point,
#   releases it (ClipCursor NULL), verifies and records a NOTE; the jump is absolute (SetCursorPos), its arrival is verified (GetCursorPos),
#   and after the click the sender must own the foreground (its own clip then keeps the relative camera moves inside the sender).
# LAYOUT: refuses to start unless RUN.json says the launcher placed and verified both windows (layout.ok) AND its own re-read of both GAME
#   windows (frame + client rects, physical px via a PER_MONITOR_AWARE_V2 thread) matches RUN.json within layout.tolerance_px (2) with no
#   overlap; the click point is computed from the re-read client rect; the sender's frame rect is re-checked once a second while driving.
#   -DryRun sends NOTHING: a kinematic model (b33_native.cs B33.Sim, terrain MODEL from the route file) replaces the game and every input is
#   printed and written to the timeline instead (offline check of the plan logic; the model is not the game).
# Run (real) : powershell -NoProfile -ExecutionPolicy Bypass -File b33_drive.ps1 -Run <run folder> -Mode jumps
# Run (dry)  : powershell -NoProfile -ExecutionPolicy Bypass -File b33_drive.ps1 -Run <scratch folder> -Mode m4 -DryRun -SimAccel 900
#   (2026-10-23: -SimAccel 900 = the Dog's NormalAcceleration, as tests\test_drive_and_stop.ps1 uses. The default -SimAccel 0 is instant
#   acceleration: on route v11 it overshoots the standing corner at (85;4375) and aborts OFF-PATH, a model artefact, not a route fault)
param(
  [Parameter(Mandatory)][string]$Run,
  [ValidateSet('jumps', 'm4', 'survey', 'calibrate', 'all')][string]$Mode = 'jumps',
  [string]$Route = '',
  [switch]$DryRun,
  [double]$CountsPerDeg = 0,
  [switch]$SkipCalibration,
  [int]$StandJumps = 12, [int]$WalkJumps = 12, [int]$RunJumps = 12, [int]$M4Repeats = 10,
  [double]$QuietSec = 60, [double]$QuietMaxWaitSec = 900,
  [switch]$NoClick, [switch]$SurveyReturn,
  [double]$TurnStopDeg = 35, [double]$DropAbortUu = 40,
  [double]$PreciseUu = 120, [double]$FloorTolUu = 15, [int]$CalPasses = 3, [double]$CalSpreadMaxPct = 10,   # CalSpreadMaxPct: v3.1d logs only
  [double]$MountTolUu = 15, [int]$WalkOffProbes = 3, [double]$WalkOffProbeMs = 30, [double]$WalkOffTolDeg = 5, [double]$CornerProbeMs = 60,
  [int]$WalkOffTaps = 3, [double]$PassLatUu = 100, [switch]$NoAutoStop, [double]$BlockPostMs = 1600,
  [string]$RoutePinFile = '', [switch]$RoutePinCheckOnly,   # v3.1: '' = ROUTE_PIN.json beside the drive; another file / the check-only exit: tests
  [double]$CalWalkMinS = 1.2, [double]$CalAfterMinS = 1.4, [double]$SimCpdNegFactor = 1.0, [double]$SimAccel = 0,
  [double]$CalMinCpd = 3.5, [double]$CalMaxCpd = 9.0, [double]$CalNoTurnDeg = 5, [int]$MouseChunk = 1, [double]$MouseIntervalMs = 2,
  [int]$CalWarmupCounts = 200, [double]$SimActorTurnRate = 260, [double]$SimKeyUpLagMs = 19,
  [double]$SimLagMs = 0, [double]$SimCpd2 = 0, [double]$SimCpdSwitchCounts = 0, [double]$SimStallY = 0, [double]$SimStallMs = 0,
  [double]$SimCpd = 4.6, [double]$SimSpawnX = -330, [double]$SimSpawnY = -650, [double]$SimSpawnYaw = 56
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
if (-not $Route) { $Route = Join-Path $PSScriptRoot 'routes\b33_route_v1.json' }
# ---- v3.1 THE ROUTE PIN (Q-B33-1 condition 5): a LIVE -Mode m4 / -Mode all drive (the counted walk-offs) is refused, before any folder,
# input or hook, unless ROUTE_PIN.json is PINNED with a 64-hex route_sha256 and the -Route file hashes to it. -Mode survey is allowed (a
# survey is how the pin is chosen); -Mode jumps / calibrate do not walk the M4 route; a -DryRun never sends input. -RoutePinCheckOnly runs
# only this check (exit 0 = would run, 2 = refused) for the tests.
if (-not $RoutePinFile) { $RoutePinFile = Join-Path $PSScriptRoot 'ROUTE_PIN.json' }
function RoutePinVerdict {
  if ($Mode -notin @('m4', 'all')) { return 'not needed: -Mode ' + $Mode }
  $rp = $null; try { $rp = Get-Content -Raw -Encoding UTF8 $RoutePinFile | ConvertFrom-Json } catch { $rp = $null }
  if ($null -eq $rp -or [string]$rp.status -cne 'PINNED' -or [string]$rp.route_sha256 -cnotmatch '^[0-9a-f]{64}$') {
    return ("REFUSED: ROUTE_PIN.json ({0}) is not PINNED with a 64-hex route_sha256 (status '{1}'): the counted M4 route is chosen on a survey before data" -f $RoutePinFile, $(if ($rp) { $rp.status } else { 'unreadable' }))
  }
  $h = (Get-FileHash $Route -Algorithm SHA256).Hash.ToLower()
  if ($h -ne [string]$rp.route_sha256) { return ("REFUSED: -Route {0} (sha256 {1}) is not the pinned route {2}" -f $Route, $h, $rp.route_sha256) }
  return ('OK: the pinned route ' + $h)
}
if ($RoutePinCheckOnly) { $v = RoutePinVerdict; Write-Output "ROUTE PIN: $v"; if ($v -like 'REFUSED*') { exit 2 } else { exit 0 } }
if (-not $DryRun) { $v = RoutePinVerdict; if ($v -like 'REFUSED*') { Write-Output "RESULT $v; nothing started"; exit 2 } }
Add-Type -Path (Join-Path $PSScriptRoot 'b33_native.cs')
. (Join-Path $PSScriptRoot 'b33_layout.ps1')
$R = Get-Content -Raw -Path $Route | ConvertFrom-Json
$utc = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
if (-not (Test-Path $Run)) { if ($DryRun) { New-Item -ItemType Directory -Force $Run | Out-Null } else { throw "run folder not found: $Run" } }
$Out = Join-Path $Run ("drive_{0}{1}_{2}" -f $Mode, $(if ($DryRun) { '_DRYRUN' } else { '' }), $utc)
New-Item -ItemType Directory -Force $Out | Out-Null
$TL = Join-Path $Out 'timeline.csv'
$LOG = Join-Path $Out 'drive.log'
$U8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($TL, "utc_iso,utc_ms,seq,event,detail,x,y,z,motion,cam_yaw_est`n", $U8)
$S = @{ dry = [bool]$DryRun; seq = 0; cam = $null; cpd = $(if ($CountsPerDeg -gt 0) { $CountsPerDeg } else { [double]$R.counts_per_deg_prior });
        held = @{}; lastMouseMs = 0; lastWPressMs = -1e9; lastWUpMs = -1e9; baseOthers = 0; pids = @(); hwnd = [IntPtr]::Zero; frames = $null; capture = $false
        cpdPos = 0.0; cpdNeg = 0.0
        frame = $null; client = $null; lastRectMs = 0; tol = 2; legStart = 0; legDownFloor = -1e9; lastBlockEndMs = $null }
$S.cpdPos = $S.cpd; $S.cpdNeg = $S.cpd      # v3.1d: separate +/- gains (the calibration sets them)
$VK = @{ W = 0x57; LSHIFT = 0xA0; SPACE = 0x20 }
$script:sim = $null; $script:tail = $null
$script:empty = New-Object 'System.Collections.Generic.List[B33.Sample]'

function Say([string]$t) { $l = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString('HH:mm:ss.fff'), $t; Write-Host $l; [IO.File]::AppendAllText($LOG, $l + "`n", $U8) }
function NowMs { if ($S.dry -and $null -ne $script:sim) { return [double]($script:sim.Epoch + $script:sim.T) } return [double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Samples {   # the comma keeps the List (no unrolling)
  if ($S.dry -and $null -ne $script:sim) {
    if ($SimLagMs -le 0 -and $SimStallMs -le 0) { return , $script:sim.S }
    # -SimLagMs: the model's reports reach the drive this late, like the real log (rehearsal 2: the corner was seen ~28 uu past it)
    $all = $script:sim.S; $cut = $script:sim.Epoch + $script:sim.T - $SimLagMs; $n = $all.Count
    if ($SimStallMs -gt 0) {
      # v3.1k -SimStallY / -SimStallMs: ONCE, when the Dog first reaches y >= SimStallY, no new report reaches the drive for SimStallMs,
      # then all of them at once (survey 11: 2.4 s without a new sender line on the approach at y ~3150, then five samples together)
      if ($null -eq $script:stallT -and $n -gt 0 -and $all[$n - 1].Y -ge $SimStallY) { $script:stallT = $all[$n - 1].StampMs }
      if ($null -ne $script:stallT -and $cut -ge $script:stallT -and $cut -lt $script:stallT + $SimStallMs) { $cut = $script:stallT - 1 }
    }
    while ($n -gt 0 -and $all[$n - 1].StampMs -gt $cut) { $n-- }
    return , $all.GetRange(0, $n)
  }
  if (-not $S.dry -and $null -ne $script:tail) { return , $script:tail.S }
  return , $script:empty
}
function Latest {
  $ss = Samples
  for ($i = $ss.Count - 1; $i -ge 0; $i--) { if ($ss[$i].HasPos) { return $ss[$i] } }
  return $null
}
function Latest-After([double]$ms, [double]$timeoutMs = 2000) {
  # v3.1d: the newest position sample STAMPED at or after $ms, waiting for it up to $timeoutMs (the log reaches the drive late:
  # rehearsal 2, -SimLagMs). The actor turns only while W is held, so a sample stamped after W's release shows where it stopped.
  $t0 = NowMs
  while ($true) {
    $q = Latest
    if ($q -and (SampleMs $q) -ge $ms) { return $q }
    if ((NowMs) - $t0 -gt $timeoutMs) { return $null }
    Wait 40
  }
}
function SampleMs($smp) { if ($S.dry) { return [double]$smp.StampMs } return [double]$script:tail.TimeOf($smp) }
$script:stallT = $null
function Passed-Leg([double]$px, [double]$py, [double]$fx, [double]$fy, [double]$tx, [double]$ty, [double]$latTol) {
  # v3.1k (P76): TRUE when (px, py) is PAST the waypoint along the leg line (fx, fy) -> (tx, ty) and within latTol of that line.
  # Composition 2: the steering swung x -30 -> +66 on the path north and passed the pass-through waypoint (0,3800) 64 uu to the side
  # (radius 50); the drive turned back 140 deg and its NO-PROGRESS timer fired. A pass-through waypoint that is passed is reached.
  $lx = $tx - $fx; $ly = $ty - $fy; $len = [Math]::Sqrt($lx * $lx + $ly * $ly)
  if ($latTol -le 0 -or $len -lt 1) { return $false }
  $ux = $lx / $len; $uy = $ly / $len
  $along = ($px - $fx) * $ux + ($py - $fy) * $uy
  $lat = [Math]::Abs(($px - $fx) * $uy - ($py - $fy) * $ux)
  return ($along -ge $len -and $lat -le $latTol)
}
function Nearest-Since([double]$sinceMs, [double]$tx, [double]$ty) {
  # v3.1k (P75): the nearest position sample to (tx, ty) among the samples stamped after $sinceMs, and the newest stamp seen. The sender
  # log reaches the drive in bursts (survey 11: no new line for 2.4 s, then five samples at once, two of them within 23 uu of the
  # waypoint (0,3300)); judging arrival by the newest sample alone walked past the waypoint and up the path to (-96,3579)
  $ss = Samples; $bq = $null; $bd = 1e9; $newest = $sinceMs
  for ($i = $ss.Count - 1; $i -ge 0; $i--) {
    $q = $ss[$i]
    if (-not $q.HasPos) { continue }
    $m = SampleMs $q
    if ($m -le $sinceMs) { break }
    if ($m -gt $newest) { $newest = $m }
    $dq = Dist $q.X $q.Y $tx $ty
    if ($dq -lt $bd) { $bd = $dq; $bq = $q }
  }
  return @{ q = $bq; d = $bd; newest = $newest }
}
function Row([string]$ev, [string]$det) {
  $S.seq++
  $ms = [long](NowMs); $p = Latest
  $iso = [DateTimeOffset]::FromUnixTimeMilliseconds($ms).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $px = ''; $py = ''; $pz = ''; $pm = ''
  if ($p) { $px = '{0:F1}' -f $p.X; $py = '{0:F1}' -f $p.Y; $pz = '{0:F1}' -f $p.Z; $pm = $p.Motion }
  $cy = ''; if ($null -ne $S.cam) { $cy = '{0:F1}' -f $S.cam }
  $line = '{0},{1},{2},{3},{4},{5},{6},{7},{8},{9}' -f $iso, $ms, $S.seq, $ev, ($det -replace ',', ';'), $px, $py, $pz, $pm, $cy
  [IO.File]::AppendAllText($TL, $line + "`n", $U8)
}
function Fail([string]$why) { throw "B33ABORT: $why" }
function Pump {
  if ($S.dry) { return }
  [void]$script:tail.Poll()
  if ($script:tail.Dev -gt 0) { Fail ("a WLDEV / wl.Dev line appeared in the sender log: " + $script:tail.LastDevLine) }
}
function Check-Guard {
  if ($S.dry) { return }
  if ([B33.Guard]::Others -ne $S.baseOthers) { Fail ("other input seen (a person or other software): " + [B33.Guard]::LastOther) }
  $fg = [B33.Win]::FgPid()
  if ($S.pids -notcontains [int]$fg) { Fail ("the sender is no longer the foreground window (foreground pid $fg, class " + [B33.Win]::FgClass() + ")") }
  if ($null -ne $S.frame -and ((NowMs) - $S.lastRectMs) -gt 1000) {
    # the sender window must stay where the launcher placed it (re-read once a second, physical px)
    $S.lastRectMs = NowMs
    $f = ConvertTo-Rect ([B33.Win]::FrameRect($S.hwnd))
    if (-not (Test-RectNear $f $S.frame $S.tol)) { Fail ('the sender window moved or resized: now {0}, placed {1}' -f (Format-Rect $f), (Format-Rect $S.frame)) }
  }
}
function Release-ClipFor([int]$x, [int]$y) {
  # REHEARSAL PATCH P1 (lead 10-20, B35 rehearsal): the FOREGROUND game clips the cursor to its own client rect (GetClipCursor measured
  # 970,39,1910,1070 with the right-hand client in front), so a jump to a point outside that clip stops at its edge ("cursor did not reach the
  # point"). Before the cursor jumps to (x, y): read the clip; if it does not contain the point, ClipCursor(NULL) (not an input event), verify
  # that the new clip contains the point (else abort) and record a NOTE with the old clip and the foreground pid.
  if ($S.dry) { return }
  $clip = ConvertTo-Rect ([B33.Win]::ClipRect())
  if ((Get-ClipAction $clip $x $y) -eq 'none') { return }
  $fgp = [B33.Win]::FgPid()
  $owner = [B33.Win]::PidAt([int](($clip.left + $clip.right) / 2), [int](($clip.top + $clip.bottom) / 2))
  [void][B33.Win]::ReleaseClip(); Start-Sleep -Milliseconds 50
  $clipNow = ConvertTo-Rect ([B33.Win]::ClipRect()); $vdesk = ConvertTo-Rect ([B33.Win]::VirtualDesktop())
  if (-not (Test-PointInRect $clipNow $x $y)) { Fail ("the cursor clip {0} could not be released for the point {1};{2} (clip now {3}; foreground pid {4}): no further input" -f (Format-Rect $clip), $x, $y, (Format-Rect $clipNow), $fgp) }
  Row 'NOTE' ("cursor clip released: was {0} (foreground pid {1}; pid under the clip's centre {2}); now {3} (virtual desktop {4})" -f (Format-Rect $clip), $fgp, $owner, (Format-Rect $clipNow), (Format-Rect $vdesk))
}
function Fresh {
  if ($S.dry) { return $true }
  $p = Latest; if (-not $p) { return $false }
  return ((NowMs) - (SampleMs $p)) -lt 1500
}
function Wait([double]$ms) {
  if ($S.dry) { $script:sim.Advance($ms); return }
  $end = (NowMs) + $ms; $staleSince = $null
  while ((NowMs) -lt $end) {
    Start-Sleep -Milliseconds ([int][Math]::Min(50, [Math]::Max(1, $end - (NowMs))))
    Check-Guard; Pump
    if (-not (Fresh)) { if ($null -eq $staleSince) { $staleSince = NowMs } elseif ((NowMs) - $staleSince -gt 2500) { Fail 'STALE-LOG: no fresh sender world report for 2.5 s' } } else { $staleSince = $null }
  }
}
function Key([string]$name, [bool]$down) {
  Check-Guard
  if ($down -and $name -eq 'W') {
    $gap = (NowMs) - $S.lastWPressMs
    if ($gap -lt 450) { Wait (450 - $gap) }   # never a double tap of W (DoubleTapWindow 0.32 s starts a run)
    $S.lastWPressMs = NowMs
  }
  if ($S.dry) { $script:sim.Key($name, $down); Say ("DRYRUN would send {0} {1}" -f $name, $(if ($down) { 'DOWN' } else { 'UP' })) }
  else { [void][B33.Inp]::Key([uint16]$VK[$name], $down) }
  if ($down) { $S.held[$name] = $true } else { $S.held.Remove($name); if ($name -eq 'W') { $S.lastWUpMs = NowMs } }
  Row $(if ($down) { 'KEY_DOWN' } else { 'KEY_UP' }) $name
}
function Tap([string]$name, [double]$ms) { Key $name $true; Wait $ms; Key $name $false }
function Mouse([int]$dx) {
  # v3.1d PACED: -MouseChunk counts every -MouseIntervalMs ms (C# B33.Inp.RelPaced checks the guard, the foreground and the cursor's
  # window before every chunk and stops on any of them); the dry run paces the model the same way (in whole 5-ms model steps)
  if ($dx -eq 0) { return }
  Check-Guard
  if (-not $S.dry -and $S.pids -notcontains [int][B33.Win]::CursorPid()) { Fail ('the mouse cursor is not over the sender window (the game has not captured the mouse; cursor over pid ' + [B33.Win]::CursorPid() + '): no mouse move sent') }
  $sent = 0
  if ($S.dry) {
    $left = $dx; $acc = 0.0
    while ($left -ne 0) {
      $c = [Math]::Max(-$MouseChunk, [Math]::Min($MouseChunk, $left))
      $script:sim.Mouse($c); $left -= $c; $sent += $c
      $acc += $MouseIntervalMs
      while ($acc -ge 5.0) { $script:sim.Advance(5.0); $acc -= 5.0 }     # the model steps 5 ms at a time
    }
    if ($acc -gt 0) { $script:sim.Advance($acc) }
  } else {
    $sent = [B33.Inp]::RelPaced($dx, $MouseChunk, $MouseIntervalMs, $S.baseOthers, [uint32[]]@($S.pids | ForEach-Object { [uint32]$_ }))
    if ($sent -ne $dx) { Check-Guard; Fail ("a mouse move stopped after {0} of {1} counts: other input, or the foreground / the cursor left the sender: no further input" -f $sent, $dx) }
  }
  if ($null -ne $S.cam) { $S.cam = Wrap180 ($S.cam + $sent / $(if ($sent -ge 0) { $S.cpdPos } else { $S.cpdNeg })) }
  $S.lastMouseMs = NowMs
  if ($S.dry) { Say ("DRYRUN would send mouse dx={0}" -f $sent) }
  Row 'MOUSE' ("dx={0}" -f $sent)
}
function TurnDeg([double]$deg) {
  # v3.1d: degrees -> counts with the measured gain of that direction (rehearsal 4: +31.8 / -39.9 deg for the same 168 counts)
  $g = $(if ($deg -ge 0) { $S.cpdPos } else { $S.cpdNeg })
  Mouse ([int][Math]::Round($deg * $g))
}
function ReleaseAll {
  foreach ($k in @($S.held.Keys)) {
    try { if ($S.dry) { $script:sim.Key($k, $false) } else { [void][B33.Inp]::Key([uint16]$VK[$k], $false) }; Row 'KEY_UP' "$k (release)" } catch { }
  }
  $S.held.Clear()
}
function Wrap180([double]$a) { $a = $a % 360.0; if ($a -gt 180) { $a -= 360 } elseif ($a -le -180) { $a += 360 }; return $a }
function Bearing($x0, $y0, $x1, $y1) { return [Math]::Atan2($y1 - $y0, $x1 - $x0) * 180.0 / [Math]::PI }
function Dist($x0, $y0, $x1, $y1) { return [Math]::Sqrt(($x1 - $x0) * ($x1 - $x0) + ($y1 - $y0) * ($y1 - $y0)) }
function Heading([double]$windowMs, [double]$sinceMs = -1e18) {
  # movement direction over the last windowMs of game time (W held: it is the camera yaw, AddMovementInput along the control rotation)
  # v3.1d: only samples stamped at or after $sinceMs (the end of the last mouse move): a paced turn lasts ~0.3-2.5 s and the log lags, so
  # a window reaching back into the turn re-anchored the estimate on the OLD heading and the next steer turned again (wind-up)
  $ss = Samples; if ($ss.Count -lt 2) { return $null }
  $last = $null
  for ($i = $ss.Count - 1; $i -ge 0; $i--) { if ($ss[$i].HasPos) { $last = $ss[$i]; break } }
  if (-not $last) { return $null }
  $first = $null
  for ($j = $i - 1; $j -ge 0; $j--) {
    if (-not $ss[$j].HasPos) { continue }
    if (($last.G - $ss[$j].G) * 1000.0 -gt $windowMs) { break }
    if ((SampleMs $ss[$j]) -lt $sinceMs) { break }
    $first = $ss[$j]
  }
  if (-not $first) { return $null }
  if ((Dist $first.X $first.Y $last.X $last.Y) -lt 25) { return $null }
  return Bearing $first.X $first.Y $last.X $last.Y
}
function SpeedNow {
  $ss = Samples; $a = $null; $b = $null
  for ($i = $ss.Count - 1; $i -ge 0; $i--) { if ($ss[$i].HasPos) { if (-not $b) { $b = $ss[$i] } elseif (-not $a) { $a = $ss[$i]; break } } }
  if (-not $a) { return 0.0 }
  $dt = $b.G - $a.G; if ($dt -le 0.02) { return 0.0 }
  return (Dist $a.X $a.Y $b.X $b.Y) / $dt
}
function LastIdleMs {
  # how long (game ms) the newest samples have all been IDLE (0 if the newest is not)
  $ss = Samples; if ($ss.Count -eq 0) { return 0 }
  $n = $ss.Count - 1; if ($ss[$n].Motion -ne 'IDLE') { return 0 }
  $j = $n; while ($j -gt 0 -and $ss[$j - 1].Motion -eq 'IDLE') { $j-- }
  return ($ss[$n].G - $ss[$j].G) * 1000.0
}
function Wait-Idle([double]$ms, [double]$timeoutMs = 8000) {
  # v3.1e: the newest sample must also be stamped after W's last release (+30 ms): a lagged log otherwise shows the IDLE samples from
  # before the tap and the caller reads a stale position
  $t0 = NowMs
  while ((LastIdleMs) -lt $ms -or -not (Latest-After ($S.lastWUpMs + 30) 0)) { if ((NowMs) - $t0 -gt $timeoutMs) { Fail ("the Dog did not stand still for {0} ms" -f $ms) }; Wait 60 }
}
function Steer([double]$tx, [double]$ty) {
  # one steering step toward (tx, ty) while W is held: re-anchor the camera estimate on the measured heading, then turn by the error (<= 45 deg)
  $p = Latest; if (-not $p) { return 999 }
  $h = Heading 450 ($S.lastMouseMs + 60)
  if ($null -ne $h -and ((NowMs) - $S.lastMouseMs) -gt 450) { $S.cam = $h }
  if ($null -eq $S.cam) { return 999 }
  $err = Wrap180 ((Bearing $p.X $p.Y $tx $ty) - $S.cam)
  if ([Math]::Abs($err) -gt 4) { TurnDeg ([Math]::Max(-45, [Math]::Min(45, $err))) }
  return $err
}
function Check-Drop([double]$sinceMs, [double]$tx, [double]$ty) {
  if ($S.legDownFloor -gt -1e8) { return }       # v3.1f: a declared descent leg; Check-Floor holds its absolute floor
  # v3.1 LEFT-THE-PATH: the sender's own soles z over the newest 1.0 s of game time (only samples since this leg began): a fall of more than
  # -DropAbortUu means the route left walkable ground: abort at once (rehearsal survey 1 fell 93.9 -> 35.7 -> -11.8 in under 0.9 s)
  $ss = Samples; $newest = $null
  for ($i = $ss.Count - 1; $i -ge 0; $i--) { if ($ss[$i].HasPos) { $newest = $ss[$i]; break } }
  if (-not $newest) { return }
  $zmax = $newest.Z
  for ($j = $i; $j -ge 0; $j--) {
    $q = $ss[$j]
    if (-not $q.HasPos) { continue }
    if (($newest.G - $q.G) -gt 1.0 -or (SampleMs $q) -lt $sinceMs) { break }
    if ($q.Z -gt $zmax) { $zmax = $q.Z }
  }
  if (($zmax - $newest.Z) -gt $DropAbortUu) {
    Fail ("LEFT-THE-PATH: z fell {0:F0} uu ({1:F1} -> {2:F1}) within 1 s at ({3:F0};{4:F0}) on the leg to ({5};{6}): the route leaves walkable ground here" -f ($zmax - $newest.Z), $zmax, $newest.Z, $newest.X, $newest.Y, $tx, $ty)
  }
}
function Check-Floor([string]$where) {
  # v3.1b OFF-PATH: the sender's own soles z since the current leg began must stay within -FloorTolUu of the highest z on the leg, at any
  # speed (rehearsal 2 stepped off the path's edge 93.4 -> 72.2 -> 58.7 -> 35.6 across a stop: no 1-s window saw 40 uu)
  if ($S.legStart -le 0) { return }
  if ($S.legDownFloor -gt -1e8) {                # v3.1f: a declared descent leg: only its absolute floor
    $q = Latest
    if ($q -and $q.Z -lt $S.legDownFloor) { Fail ("OFF-PATH {0}: z {1:F1} is below the descent leg's floor {2:F1} at ({3:F0};{4:F0})" -f $where, $q.Z, $S.legDownFloor, $q.X, $q.Y) }
    return
  }
  $ss = Samples; $newest = $null; $zmax = -1e9
  for ($i = $ss.Count - 1; $i -ge 0; $i--) {
    $q = $ss[$i]
    if (-not $q.HasPos) { continue }
    if ((SampleMs $q) -lt $S.legStart) { break }
    if (-not $newest) { $newest = $q }
    if ($q.Z -gt $zmax) { $zmax = $q.Z }
  }
  if (-not $newest) { return }
  if (($zmax - $newest.Z) -gt $FloorTolUu) {
    Fail ("OFF-PATH {0}: z {1:F1} is {2:F0} uu below this leg's highest z {3:F1} at ({4:F0};{5:F0}): the route leaves the walkable surface here" -f $where, $newest.Z, ($zmax - $newest.Z), $zmax, $newest.X, $newest.Y)
  }
}
function Precise-Arrive([double]$tx, [double]$ty, [double]$radius, [double]$closeUu = 35.0) {
  # v3.1b PRECISE ARRIVAL: release W within -PreciseUu (the log lags, so the Dog is closer than it looks), then short taps (each tap stops)
  # v3.1f: a "tight" waypoint closes to 12 uu instead of 35 (a stair foot must be met on its own line: rehearsal 9b)
  Stop-Walk; Check-Floor ("at the stop before ({0};{1})" -f $tx, $ty)
  $close = [Math]::Min($radius, $closeUu)
  for ($i = 1; $i -le 12; $i++) {
    $p = Latest; $d = Dist $p.X $p.Y $tx $ty
    if ($d -le $close) { break }
    if ($null -ne $S.cam) {
      $err = Wrap180 ((Bearing $p.X $p.Y $tx $ty) - $S.cam)
      if ([Math]::Abs($err) -gt 8) { TurnDeg ([Math]::Max(-90, [Math]::Min(90, $err))); Wait 150 }
    }
    Tap 'W' ([Math]::Max(80.0, [Math]::Min(250.0, 1000.0 * $d / 230.0 * 0.6)))
    Wait 500; Wait-Idle 200
    Check-Floor ("during the taps to ({0};{1})" -f $tx, $ty)
  }
  $p = Latest; $d = Dist $p.X $p.Y $tx $ty
  if ($d -gt $radius) { Fail ("PRECISE: could not close to ({0};{1}) with taps: d={2:F0} at ({3:F0};{4:F0})" -f $tx, $ty, $d, $p.X, $p.Y) }
  Row 'ARRIVED' ("({0};{1}) d={2:F0} precise" -f $tx, $ty, $d)
}
function Steer-Leg([double]$tx, [double]$ty, [double]$fx, [double]$fy, [double]$d) {
  # v3.1b HEADING HOLD: steer to a point 250 uu ahead ON the leg line from (fx, fy) (cross-track correction; without a from-point: the
  # waypoint), re-anchored on the measured heading; an error larger than -TurnStopDeg mid-leg is turned STANDING, never while walking
  $p = Latest; if (-not $p) { return }
  $cx = $tx; $cy = $ty
  if (-not [double]::IsNaN($fx)) {
    $lx = $tx - $fx; $ly = $ty - $fy; $len = [Math]::Sqrt($lx * $lx + $ly * $ly)
    if ($len -gt 1) {
      $ux = $lx / $len; $uy = $ly / $len
      $along = ($p.X - $fx) * $ux + ($p.Y - $fy) * $uy          # never $s: PowerShell names are case-insensitive and $S is the drive state
      $ahead = [Math]::Min($len, $along + 250.0)
      $cx = $fx + $ux * $ahead; $cy = $fy + $uy * $ahead
    }
  }
  $h = Heading 450 ($S.lastMouseMs + 60)
  if ($null -ne $h -and ((NowMs) - $S.lastMouseMs) -gt 450) { $S.cam = $h }
  if ($null -eq $S.cam) { return }
  $err = Wrap180 ((Bearing $p.X $p.Y $cx $cy) - $S.cam)
  if ([Math]::Abs($err) -gt $TurnStopDeg -and $d -gt 150) {
    Stop-Walk; Check-Floor 'at a mid-leg turn'
    $p = Latest; $err = Wrap180 ((Bearing $p.X $p.Y $cx $cy) - $S.cam)
    Row 'CORNER' ("mid-leg heading error {0:F0} deg: turned standing at ({1:F0};{2:F0})" -f $err, $p.X, $p.Y)
    TurnDeg ($err); Wait 300
    $p = Latest; [void](Probe-Heading (Bearing $p.X $p.Y $cx $cy) 6 8 'mid-leg turn' $false $CornerProbeMs)
    Key 'W' $true
    return
  }
  if ([Math]::Abs($err) -gt 4) { TurnDeg ([Math]::Max(-45, [Math]::Min(45, $err))) }
}
function Walk-To([double]$tx, [double]$ty, [double]$radius, [double]$fx = [double]::NaN, [double]$fy = [double]::NaN, [bool]$precise = $false,
                 [double]$zhint = [double]::NaN, [double]$timeoutS = 90, [bool]$down = $false, [bool]$careful = $false, [bool]$tight = $false) {
  Check-Floor ("before the leg to ({0};{1})" -f $tx, $ty)      # the previous leg's stop / coast still counts as the previous leg
  $S.legDownFloor = -1e9
  # v3.1k (P81): the standing corner stop that STARTS a declared descent leg is held to that leg's absolute floor, not to the previous
  # leg's highest z: the Dog coasts while it stops, and at a descent's top that coast goes down the declared descent (model, route v11
  # after P78: the stop before (240;2935) coasted from the bump's top 62.1 to 44.6, 17.5 uu, on the descent the next leg declares)
  if ($down -and -not [double]::IsNaN($zhint)) { $S.legDownFloor = $zhint - $FloorTolUu }
  # CORNER (v3.1): a leg that needs a sharper turn than -TurnStopDeg starts standing; v3.1b: the turn is computed AFTER the stop
  $p = Latest
  # v3.1f: a CAREFUL leg turns standing even when it is shorter than the arrival radius (rehearsal-9 model: short legs between tight stair
  # points skipped the turn and W started in the old heading)
  if ($p -and $null -ne $S.cam -and ((Dist $p.X $p.Y $tx $ty) -gt $radius -or ($careful -and (Dist $p.X $p.Y $tx $ty) -gt 12))) {
    $need = Wrap180 ((Bearing $p.X $p.Y $tx $ty) - $S.cam)
    if ([Math]::Abs($need) -gt $(if ($careful) { 4.0 } else { $TurnStopDeg })) {
      if ($S.held.ContainsKey('W')) {
        Stop-Walk; Check-Floor ("at the corner stop before ({0};{1})" -f $tx, $ty)
        $p = Latest; $need = Wrap180 ((Bearing $p.X $p.Y $tx $ty) - $S.cam)
      }
      Row 'CORNER' ("turn {0:F0} deg standing at ({1:F0};{2:F0}) before the leg to ({3};{4})" -f $need, $p.X, $p.Y, $tx, $ty)
      TurnDeg ($need); Wait 300
      $p = Latest
      if ($careful) { [void](Probe-Displacement (Bearing $p.X $p.Y $tx $ty) 4 3 ("careful corner before ({0};{1})" -f $tx, $ty) $false) }  # v3.1f: ~6 uu a round
      else { [void](Probe-Heading (Bearing $p.X $p.Y $tx $ty) 6 8 ("corner before ({0};{1})" -f $tx, $ty) $false $CornerProbeMs) }
    }
  }
  $S.legStart = NowMs
  if ($down) {
    if ([double]::IsNaN($zhint)) { Fail ("ROUTE: the descent leg to ({0};{1}) has no z" -f $tx, $ty) }
    $S.legDownFloor = $zhint - $FloorTolUu
    Row 'NOTE' ("descent leg to ({0};{1}): down to z {2:F1} allowed (floor {3:F1})" -f $tx, $ty, $zhint, $S.legDownFloor)
  }
  if ($careful -and $precise -and $PreciseUu -gt 0) {
    $p = Latest
    if ($p -and (Dist $p.X $p.Y $tx $ty) -le [Math]::Max($PreciseUu, $radius)) {
      # v3.1f: a careful leg that starts inside the precise zone is tapped from standing; W is never held in it
      Precise-Arrive $tx $ty $radius $(if ($tight) { 12.0 } else { 35.0 })
      if (-not [double]::IsNaN($zhint)) { $p = Latest; if ($p.Z -lt $zhint - $FloorTolUu) { Fail ("OFF-PATH at the waypoint ({0};{1}): z {2:F1}, the route expects ~{3:F1} there" -f $tx, $ty, $p.Z, $zhint) } }
      return
    }
  }
  if (-not $S.held.ContainsKey('W')) { Key 'W' $true }
  $t0 = NowMs; $p0 = Latest; $best = 1e9; $bestAt = NowMs
  $seenMs = $(if ($p0) { SampleMs $p0 } else { 0.0 })      # v3.1k (P75): every sample after this one is looked at, not only the newest
  $lfx = $fx; $lfy = $fy                                       # v3.1k (P76): the leg line for the pass rule (from the leg's start if no from-point)
  if ([double]::IsNaN($lfx) -and $p0) { $lfx = $p0.X; $lfy = $p0.Y }
  while ($true) {
    Wait 200
    Check-Drop $S.legStart $tx $ty
    Check-Floor ("on the leg to ({0};{1})" -f $tx, $ty)
    $p = Latest
    $d = Dist $p.X $p.Y $tx $ty
    $nr = Nearest-Since $seenMs $tx $ty; $seenMs = $nr.newest
    $dA = [Math]::Min($d, $nr.d)
    $burst = $(if ($nr.d -lt $d - 0.5) { " (nearest sample of a burst at ({0:F0};{1:F0}); newest d={2:F0})" -f $nr.q.X, $nr.q.Y, $d } else { '' })
    if ($precise -and $PreciseUu -gt 0 -and $dA -le [Math]::Max($PreciseUu, $radius)) { if ($burst) { Row 'NOTE' ("precise zone of ({0};{1}) seen in a burst{2}" -f $tx, $ty, $burst) }; Precise-Arrive $tx $ty $radius $(if ($tight) { 12.0 } else { 35.0 }); break }
    if ($dA -le $radius) { Row 'ARRIVED' ("({0};{1}) d={2:F0}{3}" -f $tx, $ty, $dA, $burst); break }
    if (-not $precise -and -not [double]::IsNaN($lfx) -and (Passed-Leg $p.X $p.Y $lfx $lfy $tx $ty $PassLatUu)) {
      Row 'ARRIVED' ("({0};{1}) d={2:F0} passed (beyond the waypoint along the leg, within {3:F0} uu of its line; P76)" -f $tx, $ty, $d, $PassLatUu); break
    }
    if ($d -lt $best - 40) { $best = $d; $bestAt = NowMs }
    if (((NowMs) - $t0) -gt 2500 -and $p0 -and (Dist $p0.X $p0.Y $p.X $p.Y) -lt 20) { Fail 'NO-MOVE: W is held but the sender does not move (keys not reaching the game?)' }
    if (((NowMs) - $bestAt) -gt 4500) { Fail ("NO-PROGRESS toward ({0};{1}): stuck at ({2:F0};{3:F0};{4:F0})" -f $tx, $ty, $p.X, $p.Y, $p.Z) }
    if (((NowMs) - $t0) -gt $timeoutS * 1000) { Fail ("TIMEOUT walking to ({0};{1})" -f $tx, $ty) }
    Steer-Leg $tx $ty $fx $fy $d
  }
  if (-not [double]::IsNaN($zhint)) {
    $p = Latest
    if ($p.Z -lt $zhint - $FloorTolUu) { Fail ("OFF-PATH at the waypoint ({0};{1}): z {2:F1}, the route expects ~{3:F1} there" -f $tx, $ty, $p.Z, $zhint) }
  }
}
function Walk-Route($pts, [double]$radius) {
  # v3.1b: a waypoint is [x, y] or [x, y, expected soles z]; corners (a turn sharper than -TurnStopDeg) and the last point arrive PRECISELY;
  # every leg steers along the line from the previous point
  $list = @($pts); $n = $list.Count
  for ($i = 0; $i -lt $n; $i++) {
    $pt = $list[$i]; $wx = [double]$pt[0]; $wy = [double]$pt[1]
    $fx = [double]::NaN; $fy = [double]::NaN
    if ($i -gt 0) { $fx = [double]$list[$i - 1][0]; $fy = [double]$list[$i - 1][1] }
    $precise = $true
    if ($i -lt $n - 1) {
      $here = Latest
      $inHd = $(if ($i -gt 0) { Bearing $fx $fy $wx $wy } elseif ($here) { Bearing $here.X $here.Y $wx $wy } else { $null })
      $outHd = Bearing $wx $wy ([double]$list[$i + 1][0]) ([double]$list[$i + 1][1])
      $precise = ($null -eq $inHd) -or ([Math]::Abs((Wrap180 ($outHd - $inHd))) -gt $TurnStopDeg)
    }
    $zh = [double]::NaN
    if (@($pt).Count -ge 3 -and $null -ne $pt[2]) { $zh = [double]$pt[2] }
    $tok = @(); for ($k = 3; $k -lt @($pt).Count; $k++) { $tok += [string]$pt[$k] }   # v3.1f: [x, y, z, "careful"?, "down"?]
    $dn = ($tok -contains 'down'); $cf = ($tok -contains 'careful'); $tg = ($tok -contains 'tight')
    if ($cf -or $tg) { $precise = $true }
    Walk-To $wx $wy $radius $fx $fy $precise $zh 90 $dn $cf $tg
  }
}
function Stop-Walk { if ($S.held.ContainsKey('LSHIFT')) { Key 'LSHIFT' $false }; if ($S.held.ContainsKey('W')) { Key 'W' $false }; Wait-Idle 250 }
function Capture([bool]$on) {
  if ($S.dry -or -not $S.frames) { return }
  $flag = Join-Path $S.frames 'CAPTURE'
  if ($on) { [IO.File]::WriteAllText($flag, "on`n") } elseif (Test-Path $flag) { Remove-Item -Force $flag }
  $S.capture = $on
}
function Block([string]$name, [bool]$begin) {
  Row $(if ($begin) { 'BLOCK_BEGIN' } else { 'BLOCK_END' }) $name
  if (-not $begin) { $S.lastBlockEndMs = NowMs; $S.lastBlockEndName = $name }   # v3.1k (P78): read AFTER the row, so never earlier than the row's stamp
  Capture $begin; Say ("{0} {1}" -f $(if ($begin) { 'BEGIN' } else { 'END' }), $name)
}
function Block-Gap([string]$why) {
  # v3.1k (P78; ruling Q-B33-1 condition 4; COMP3_DIAGNOSIS 1.5): the judge reads a block's sender samples to BLOCK_END + 1.6 s (judge
  # BLOCK_POST_S), so after a BLOCK_END the drive sends NO input and writes NO next BLOCK_BEGIN until its clock passes END + 1.601 s, and
  # then until the sender log shows TWO fresh IDLE reports stamped after END + 1.6 s (one lost report then still brackets the window with a
  # standing report). Composition 3: WALK's first key 0.139 s after STAND's end put WALK jump 1's take-off into STAND's sinking test.
  if ($null -eq $S.lastBlockEndMs) { return }
  $end = [double]$S.lastBlockEndMs; $edge = $end + $BlockPostMs
  while ((NowMs) -le $edge + 1) { Wait 20 }
  $t0 = NowMs; $k = 0
  while ($true) {
    $ss = Samples; $k = 0
    for ($i = $ss.Count - 1; $i -ge 0; $i--) {
      $q = $ss[$i]
      if (-not $q.HasPos) { continue }
      if ((SampleMs $q) -le $edge) { break }
      if ($q.Motion -ne 'IDLE') { $k = 0; break }      # the newest reports after the edge must be IDLE; a moving one restarts the count
      $k++
    }
    if ($k -ge 2) { break }
    if ((NowMs) - $t0 -gt 8000) { Fail ("BLOCK-GAP: no two fresh IDLE sender reports after {0}'s end + {1:F0} ms within 8 s ({2})" -f $S.lastBlockEndName, $BlockPostMs, $why) }
    Wait 40
  }
  Row 'BLOCK_GAP' ("after {0}'s end: {1:F0} ms, then {2} fresh IDLE reports stamped after END + {3:F0} ms; no input in between ({4})" -f $S.lastBlockEndName, ((NowMs) - $end), $k, $BlockPostMs, $why)
  $S.lastBlockEndMs = $null
}
function AirSince([double]$ms) { $ss = Samples; for ($i = $ss.Count - 1; $i -ge 0 -and (SampleMs $ss[$i]) -ge $ms; $i--) { if ($ss[$i].Air) { return $true } }; return $false }
function LandedAfterAir([double]$ms) {
  # an AIR sample at/after ms followed by a ground sample (scan back to ms, then forward)
  $ss = Samples; $i = $ss.Count - 1
  while ($i -gt 0 -and (SampleMs $ss[$i - 1]) -ge $ms) { $i-- }
  $sawAir = $false
  for (; $i -lt $ss.Count; $i++) { if ((SampleMs $ss[$i]) -lt $ms) { continue }; if ($ss[$i].Air) { $sawAir = $true } elseif ($sawAir) { return $true } }
  return $false
}

function Cal-Pass([int]$k, [int]$sign, [double]$cpd0, $c, [double]$walkS, [double]$afterS, [double]$win) {
  # one pass: walk straight, turn sign*turn_deg by the prior counts, walk straight; the turn read from the ACTOR yaw. -> the counts/deg, or
  # $null when the pass is not measurable (the Dog did not move after the turn: blocked); aborts only for broken input
  Key 'W' $true; Wait (1000 * $walkS)
  $q0 = Latest; $h0p = Heading 500
  $a0 = $(if ($q0 -and -not [double]::IsNaN($q0.Yaw)) { [double]$q0.Yaw } elseif ($null -ne $h0p) { $h0p } else { $null })
  if ($null -eq $a0) { Key 'W' $false; Wait-Idle 250; Row 'CAL_PASS' ("pass {0}: no heading before the turn (blocked?): skipped" -f $k); return $null }
  $S.cam = $a0
  $dx = $sign * [int][Math]::Round([double]$c.turn_deg * $cpd0)
  Mouse $dx; $pT = Latest
  Wait (1000 * $afterS)
  $q1 = Latest; $h1p = Heading $win
  Key 'W' $false; Wait-Idle 250
  $moved = $(if ($pT -and $q1) { Dist $pT.X $pT.Y $q1.X $q1.Y } else { 0 })
  if ($moved -lt 25) { Row 'CAL_PASS' ("pass {0}: the Dog moved {1:F0} uu after the turn (blocked): skipped" -f $k, $moved); return $null }
  $a1 = $(if (-not [double]::IsNaN($q1.Yaw)) { [double]$q1.Yaw } else { $h1p })
  if ($null -eq $a1) { Row 'CAL_PASS' ("pass {0}: no heading after the turn: skipped" -f $k); return $null }
  $d = Wrap180 ($a1 - $a0); $dsg = $d * $sign
  if ([Math]::Abs($d) -lt $CalNoTurnDeg) { Fail ("CAL: a {0} count move turned the walk by only {1:F1} deg: the mouse does not reach the camera; no further input" -f $dx, $d) }
  if ($dsg -lt 0) { Fail ("CAL: a {0} count move turned the walk the WRONG way ({1:F1} deg): sign wrong; no further input" -f $dx, $d) }
  $cpd = [Math]::Abs($dx) / $dsg
  $S.cam = $a1
  Row 'CAL_PASS' ("pass {0}: counts={1} actor yaw {2:F1}->{3:F1} turned {4:F1} deg (position heading {5}; moved {6:F0} uu after the turn) counts_per_deg={7:F3}" -f $k, $dx, $a0, $a1, $d, $(if ($null -ne $h0p -and $null -ne $h1p) { '{0:F1}->{1:F1}' -f $h0p, $h1p } else { 'n/a' }), $moved, $cpd)
  return [pscustomobject]@{ sign = $sign; cpd = $cpd }
}
function Median($xs) { $a = @($xs | Sort-Object); $n = $a.Count; if ($n % 2 -eq 1) { return [double]$a[($n - 1) / 2] }; return ([double]$a[$n / 2 - 1] + [double]$a[$n / 2]) / 2.0 }
function Clamp-Cpd([double]$v) { return [Math]::Max($CalMinCpd, [Math]::Min($CalMaxCpd, $v)) }
function Calibrate {
  # v3.1d: a STARTING GAIN, not a gate. -CalPasses passes (+, -, +, ...), OUT AND BACK (a standing 180-deg turn before each later pass, by
  # the gains measured so far); the turn read from the ACTOR yaw after walks of >= -CalWalkMinS / -CalAfterMinS; blocked passes skipped;
  # separate +/- gains (medians), clamped to -CalMinCpd..-CalMaxCpd; the spread is logged; aborts only for broken input (Cal-Pass)
  $c = $R.calibration
  $walkS = [Math]::Max([double]$c.walk_s, $CalWalkMinS); $afterS = [Math]::Max([double]$c.after_s, $CalAfterMinS)
  $win = 700.0
  if ($c.PSObject.Properties['after_window_ms']) { $win = [Math]::Max(700.0, [double]$c.after_window_ms) }
  $cpd0 = $S.cpd; $passes = [Math]::Max(1, $CalPasses)
  Say ("CALIBRATE: {0} pass(es) +/- out and back: walk {1} s, turn {2} deg by mouse (prior {3:F3} counts/deg), walk {4} s; actor yaw; a starting gain, not a gate" -f $passes, $walkS, $c.turn_deg, $cpd0, $afterS)
  if ($CalWarmupCounts -gt 0) {
    # standing: the camera turns out and back, the actor does not move; the engine learns the mouse sample rate first
    Mouse $CalWarmupCounts; Wait 200; Mouse (-$CalWarmupCounts); Wait 300
    Row 'CAL_WARMUP' ("standing +/-{0} counts at {1} count(s) / {2} ms (the engine's mouse sample rate; no measurement)" -f $CalWarmupCounts, $MouseChunk, $MouseIntervalMs)
  }
  $res = @()
  for ($k = 1; $k -le $passes; $k++) {
    if ($k -gt 1) { TurnDeg 180; Wait 400 }          # back over the ground just walked
    $r = Cal-Pass $k $(if ($k % 2 -eq 1) { 1 } else { -1 }) $cpd0 $c $walkS $afterS $win
    if ($r) {
      $res += $r
      $all = @($res | ForEach-Object { $_.cpd }); $pos = @($res | Where-Object { $_.sign -gt 0 } | ForEach-Object { $_.cpd }); $neg = @($res | Where-Object { $_.sign -lt 0 } | ForEach-Object { $_.cpd })
      $S.cpdPos = Clamp-Cpd $(if ($pos.Count) { Median $pos } else { Median $all })
      $S.cpdNeg = Clamp-Cpd $(if ($neg.Count) { Median $neg } else { Median $all })
    }
  }
  if ($res.Count -eq 0) { Fail 'CAL: no pass could be measured (the Dog was blocked in every pass): no further input' }
  $all = @($res | ForEach-Object { $_.cpd })
  $med = Median $all
  $spread = $(if ($all.Count -ge 2) { (($all | Measure-Object -Maximum).Maximum - ($all | Measure-Object -Minimum).Minimum) / $med * 100.0 } else { 0.0 })
  $S.cpd = Clamp-Cpd $med
  Row 'CAL' ("passes measured {0} of {1} ({2}); spread {3:F1}% (logged, not a gate); gains + {4:F3} / - {5:F3} (clamped {6}..{7}); counts_per_deg={8:F3}" -f $all.Count, $passes, (($all | ForEach-Object { '{0:F3}' -f $_ }) -join ' / '), $spread, $S.cpdPos, $S.cpdNeg, $CalMinCpd, $CalMaxCpd, $S.cpd)
  Say ("CALIBRATED counts/deg = {0:F3} (+ {1:F3} / - {2:F3}; spread {3:F1}%, logged)" -f $S.cpd, $S.cpdPos, $S.cpdNeg, $spread)
}

function Do-Jumps {
  $J = $R.jumps; $rw = $J.runway; $x = [double]$rw.x; $ylo = [double]$rw.y_lo; $yhi = [double]$rw.y_hi
  Walk-Route $J.approach ([double]$J.arrive_uu)
  Stop-Walk
  $S.legStart = 0      # v3.1b: the jump blocks go up and down by design; no route leg (OFF-PATH) is open until the next Walk-To
  # ---- STAND: standing jumps, >= 1.5 s idle between
  Wait-Idle 1500
  Block 'STAND' $true
  $n = 0; $miss = 0
  while ($n -lt $StandJumps) {
    Wait-Idle 1600 12000
    $t = NowMs; Tap 'SPACE' 120
    $ok = $false; $t1 = NowMs
    while ((NowMs) - $t1 -lt 1500) { Wait 60; if (AirSince ($t - 50)) { $ok = $true; break } }
    if (-not $ok) { $miss++; Row 'NOTE' 'JUMP-NOT-SEEN'; if ($miss -ge 3) { Fail 'three standing jumps not seen in the sender log' }; continue }
    $miss = 0; $n++
    $t2 = NowMs; while (-not (LandedAfterAir $t) -and (NowMs) - $t2 -lt 3000) { Wait 60 }
    Row 'JUMP' ("STAND {0}" -f $n)
  }
  Wait-Idle 1500
  Block 'STAND' $false
  Block-Gap 'before WALK'
  Pass-Block 'WALK' $WalkJumps $false $x $ylo $yhi
  Block-Gap 'before RUN'
  Pass-Block 'RUN' $RunJumps $true $x $ylo $yhi
  Block-Gap 'before the M4 approach'
  Stop-Walk; Wait 3000
}

function Pass-Block([string]$name, [int]$want, [bool]$runBlock, [double]$x, [double]$ylo, [double]$yhi) {
  # passes along the runway; a pass ends 300 uu before its end: stop, a 180-degree camera turn by mouse, walk on
  $p = Latest
  $toHi = ([Math]::Abs($p.Y - $yhi) -gt [Math]::Abs($p.Y - $ylo))
  $speedRun = 520.0; $speedJog = 230.0
  Block $name $true
  Key 'W' $true
  $n = 0; $straightSince = NowMs; $lastJumpMs = -1e9; $lastLandCheck = $null; $passes = 0; $t0 = NowMs
  while ($true) {
    if ($n -ge $want -and (LandedAfterAir $lastJumpMs)) { break }
    if (((NowMs) - $t0) -gt 240000) { Fail "$name block took more than 240 s" }
    $ty = $(if ($toHi) { $yhi } else { $ylo })
    Wait 80
    $p = Latest
    $rem = [Math]::Abs($ty - $p.Y)
    if ($rem -lt 300 -and (-not $p.Air)) {
      # END OF A PASS: stop, turn the camera 180 degrees by mouse while standing (no sideways arc), walk on (a walked turn, never a teleport)
      if ($S.held.ContainsKey('LSHIFT')) { Key 'LSHIFT' $false }
      Key 'W' $false; Wait-Idle 300
      $toHi = -not $toHi; $passes++; Row 'UTURN' ("pass {0} done at y={1:F0}" -f $passes, $p.Y)
      TurnDeg (180.0); Wait 300
      Key 'W' $true
      $straightSince = NowMs; continue
    }
    # steer to a point 400 uu ahead ON the runway line (cross-track correction), never past the pass end
    $dir = $(if ($toHi) { 1.0 } else { -1.0 })
    $cy = $p.Y + $dir * 400.0
    if ($toHi) { $cy = [Math]::Min($cy, $yhi) } else { $cy = [Math]::Max($cy, $ylo) }
    $err = Steer $x $cy
    if ([Math]::Abs($err) -gt 10) { $straightSince = NowMs }
    $straightMs = (NowMs) - $straightSince
    if ($runBlock) {
      if (-not $S.held.ContainsKey('LSHIFT') -and $straightMs -gt 500 -and $rem -gt 900) { Key 'LSHIFT' $true }
      if ($S.held.ContainsKey('LSHIFT') -and $rem -lt 560) { Key 'LSHIFT' $false }
    }
    $sp = SpeedNow
    $landed = ($lastJumpMs -lt 0) -or (LandedAfterAir $lastJumpMs)
    $sinceJump = (NowMs) - $lastJumpMs
    if ($n -lt $want -and $landed -and $sinceJump -gt 1100 -and $straightMs -gt 600 -and -not $p.Air) {
      if ($runBlock) { $okMove = ($p.Motion -eq 'RUN' -and $sp -ge 430 -and $rem -gt ($speedRun * 1.0 + 300)) }
      else { $okMove = ($p.Motion -eq 'WALK' -and $sp -ge 150 -and $sp -le 330 -and $rem -gt ($speedJog * 1.3 + 150)) }
      if ($okMove) {
        $tj = NowMs; Tap 'SPACE' 120; $lastJumpMs = $tj; $n++
        Row 'JUMP' ("{0} {1} speed {2:F0}" -f $name, $n, $sp)
      }
    }
  }
  if ($S.held.ContainsKey('LSHIFT')) { Key 'LSHIFT' $false }
  Key 'W' $false
  Wait-Idle 1500
  Block $name $false
}

function Mount-Kerb {
  # short W taps toward mount.to (each tap shorter as the target nears; presses >= 0.45 s apart, never a double tap); stops as soon as the
  # sender's own reports say ON the kerb, and gives up (no tap past it) when it is within 30 uu of the target without being on the kerb
  $M = $R.m4.mount; $tx = [double]$M.to[0]; $ty = [double]$M.to[1]
  Stop-Walk
  $S.legStart = 0      # v3.1b: the mount steps UP onto the kerb; On-Kerb decides, not the route floor
  $z0 = [double](Latest).Z  # v3.1e MOUNT-DOWN: a mount only goes up or stays level (rehearsal 5's first tap fell 94.4 -> 50.0 into a trough)
  for ($i = 1; $i -le [int]$M.max_taps; $i++) {
    $p = Latest
    $deep = ([Math]::Abs($p.Y - $ty) -le $MountTolUu)    # v3.1c: deep in the ruled box, not at its edge (rehearsal 3 stopped at y 4449.8)
    if ((On-Kerb) -and $deep) { Row 'ON_KERB' ("after {0} taps at ({1:F1};{2:F1};{3:F1}), |y - {4}| <= {5}" -f ($i - 1), $p.X, $p.Y, $p.Z, $ty, $MountTolUu); return $true }
    if ($i -gt 1) { Anchor-ActorYaw }                      # v3.1c: the last tap turned the actor to the camera: re-measure, do not add
    $d = Dist $p.X $p.Y $tx $ty
    # v3.1 (dry run of route v2: the second mount stopped at y 4443.6, 1.4 uu short of the fixed box, because "within 30 uu" also held
    # OUTSIDE the box): give up only INSIDE the kerb box near the target (then the height is what is wrong), or within 8 uu of the target
    $inBox = ($p.X -ge [double]$M.box_x[0] -and $p.X -le [double]$M.box_x[1] -and $p.Y -ge [double]$M.box_y[0] -and $p.Y -le [double]$M.box_y[1])
    if ((-not (On-Kerb)) -and (($inBox -and $d -le 30) -or $d -le 8)) { Row 'NOTE' ("at the mount target (d={0:F0}, in the kerb box: {1}) but not on the kerb: z {2:F1}" -f $d, $inBox, $p.Z); return $false }
    if ($null -ne $S.cam) {
      $err = Wrap180 ((Bearing $p.X $p.Y $tx $ty) - $S.cam)
      if ([Math]::Abs($err) -gt 6) { TurnDeg ([Math]::Max(-60, [Math]::Min(60, $err))) }
    }
    $tapMs = [Math]::Max(80.0, [Math]::Min([double]$M.tap_ms, 1000.0 * $d / 230.0 * 0.7))
    Tap 'W' $tapMs
    Wait 650
    Wait-Idle 500   # v3.1f: On-Kerb reads the newest THREE samples; 250 ms left a pre-stop sample in them (rehearsal 10: MOUNT-FAILED on the kerb)
    $q = Latest
    if ($q.Z -lt $z0 - $FloorTolUu) { Fail ("MOUNT-DOWN: a mount tap took the Dog DOWN from z {0:F1} to {1:F1} at ({2:F1};{3:F1}): not the way onto the kerb; no further taps" -f $z0, $q.Z, $q.X, $q.Y) }
  }
  $p = Latest
  return ((On-Kerb) -and ([Math]::Abs($p.Y - $ty) -le $MountTolUu))
}
function Probe-Displacement([double]$target, [double]$tol, [int]$rounds, [string]$where, [bool]$edgeGuard = $true) {
  # v3.1e: the camera yaw from the Dog's own displacement over -WalkOffTaps short taps (from rest the movement follows the input, i.e.
  # the camera, whatever the actor faces). Positions are fresh (stamped after W's release). -> $true when within $tol of $target.
  $M = $R.m4.mount
  $p0 = Latest-After ($S.lastWUpMs + 30)
  if (-not $p0) { Row 'NOTE' ("{0}: no fresh position: no heading check" -f $where); return $false }
  $unseen = 0
  for ($k = 1; $k -le $rounds; $k++) {
    for ($j = 1; $j -le $WalkOffTaps; $j++) {
      $q = Latest
      if ($edgeGuard -and $q.X -gt [double]$M.box_x[1] - 14) { Fail ("{0}: too close to the kerb edge to probe (x {1:F1}): no walk-off" -f $where, $q.X) }
      Tap 'W' $WalkOffProbeMs; Wait 250
    }
    Wait 350; Wait-Idle 200
    $p1 = Latest-After ($S.lastWUpMs + 30)
    if (-not $p1) { Row 'NOTE' ("{0}: no fresh position after the taps: no heading check" -f $where); return $false }
    $d = Dist $p0.X $p0.Y $p1.X $p1.Y
    if ($d -lt 2.0) {
      $unseen++
      Row 'NOTE' ("{0}: round {1}: {2} taps moved the Dog only {3:F1} uu: not measurable" -f $where, $k, $WalkOffTaps, $d)
      if ($unseen -ge 2) { return $false }
      $p0 = $p1; continue
    }
    $h = Bearing $p0.X $p0.Y $p1.X $p1.Y
    $err = Wrap180 ($target - $h)
    Row 'HEADING_PROBE' ("{0}: round {1}: moved {2:F1} uu from ({3:F1};{4:F1}) to ({5:F1};{6:F1}) at heading {7:F1} (the camera), wanted {8:F1}, error {9:F1} deg" -f $where, $k, $d, $p0.X, $p0.Y, $p1.X, $p1.Y, $h, $target, $err)
    $S.cam = Wrap180 $h
    if ([Math]::Abs($err) -le $tol) { return $true }
    TurnDeg ($err); Wait 300
    $p0 = $p1
  }
  return $false
}
function Probe-Heading([double]$target, [double]$tol, [int]$maxProbes, [string]$where, [bool]$edgeGuard, [double]$tapMs) {
  # v3.1c: short probe taps (-WalkOffProbeMs) make the ACTOR turn toward the camera (it turns only while it moves); its logged yaw is the
  # truth only once it has STOPPED turning: probe until two readings agree within 2 deg (converged), THEN compare with the target and turn
  # the error out (the following probes turn the actor to the corrected camera). -> $true when converged within $tol.
  # (Without the convergence rule a half-turned actor reads as a wrong camera: the model's precise taps then orbited the waypoint.)
  # v3.1d: every reading is STAMPED after the last release of W (Latest-After): with the log's lag a stale reading equalled the one before
  # the tap and passed as "converged" (the model with the Dog's real 260 deg/s then turned the camera the wrong way)
  # v3.1e: a tap of $tapMs; a reading counts as converged only if the Dog MOVED >= 0.5 uu during the tap (the tap was seen)
  $q = Latest-After ($S.lastWUpMs + 30); $prev = $(if ($q -and -not [double]::IsNaN($q.Yaw)) { [double]$q.Yaw } else { [double]::NaN })
  $px = $(if ($q) { [double]$q.X } else { [double]::NaN }); $py = $(if ($q) { [double]$q.Y } else { [double]::NaN }); $unseen = 0
  $M = $R.m4.mount
  for ($k = 1; $k -le $maxProbes; $k++) {
    $q = Latest
    if ($edgeGuard -and $q.X -gt [double]$M.box_x[1] - 14) { Fail ("{0}: too close to the kerb edge to probe (x {1:F1}): no walk-off" -f $where, $q.X) }
    Tap 'W' $tapMs; Wait 350; Wait-Idle 200
    $q = Latest-After ($S.lastWUpMs + 30)
    if (-not $q -or [double]::IsNaN($q.Yaw)) { Row 'NOTE' ("{0}: no actor yaw stamped after the probe in the sender log: no heading check" -f $where); return $false }
    $moved = $(if ([double]::IsNaN($prev)) { 999.0 } else { [Math]::Abs((Wrap180 ($q.Yaw - $prev))) })
    $step = $(if ([double]::IsNaN($px)) { 999.0 } else { Dist $px $py $q.X $q.Y })
    $prev = [double]$q.Yaw; $px = [double]$q.X; $py = [double]$q.Y
    $err = Wrap180 ($target - $q.Yaw)
    Row 'HEADING_PROBE' ("{0}: probe {1}: actor yaw {2:F1} (turned {3:F1} since the last reading; moved {4:F1} uu), wanted {5:F1}, error {6:F1} deg" -f $where, $k, (Wrap180 $q.Yaw), $moved, $step, $target, $err)
    if ($moved -le 2.0 -and $step -lt 0.5) {       # nothing moved: the game may not have seen the tap; never read that as converged
      $unseen++
      if ($unseen -ge 3) { Row 'NOTE' ("{0}: three probe taps moved nothing: no heading check" -f $where); return $false }
      continue
    }
    if ($moved -gt 2.0) { continue }               # still turning toward the camera: probe again before trusting it
    $S.cam = Wrap180 ([double]$q.Yaw)               # converged: the actor faces the camera
    if ([Math]::Abs($err) -le $tol) { return $true }
    TurnDeg ($err); Wait 300
  }
  return $false
}
function Anchor-ActorYaw {
  # v3.1c: after a tap the actor faces the camera's direction (bOrientRotationToMovement): re-anchor the camera estimate on the sender's own
  # yaw= field instead of adding mouse turns to an old estimate (rehearsal 3: estimate 81.5, actor 72.2 before the walk-off)
  $q = Latest-After ($S.lastWUpMs + 30)              # v3.1d: a reading from after the tap, never a stale one
  if (-not $q) { Row 'NOTE' 'no actor yaw stamped after the last tap: the camera estimate is kept'; return }
  if ($q -and -not [double]::IsNaN($q.Yaw)) {
    if ($null -ne $S.cam -and [Math]::Abs((Wrap180 ($q.Yaw - $S.cam))) -gt 3) { Row 'NOTE' ("camera estimate {0:F1} re-anchored on the actor yaw {1:F1}" -f $S.cam, $q.Yaw) }
    $S.cam = Wrap180 ([double]$q.Yaw)
  }
}
function On-Kerb {
  # ON the kerb = the newest 3 sender reports are IDLE with z inside kerb_z and x/y inside the box (the sender's own "send motion ... z=" + soles lines)
  # v3.1k (P77): a report is one "send motion" line plus its "send soles" line ~10 ms later. The NEWEST report may have only its motion line
  # yet (the drive read the log between the two lines: composition 3, MOUNT-FAILED on the kerb at (153.3,4451.4) z 113.0); it is skipped,
  # not counted as off the kerb. Any older report without a position still fails.
  $M = $R.m4.mount; $ss = Samples; $k = 0
  for ($i = $ss.Count - 1; $i -ge 0 -and $k -lt 3; $i--) {
    $q = $ss[$i]   # never $s: PowerShell names are case-insensitive and $S is the drive state
    if (-not $q.HasPos) { if ($i -eq $ss.Count - 1) { continue } return $false }
    if ($q.Motion -ne 'IDLE') { return $false }
    if ($q.Z -lt [double]$M.kerb_z[0] -or $q.Z -gt [double]$M.kerb_z[1]) { return $false }
    if ($q.X -lt [double]$M.box_x[0] -or $q.X -gt [double]$M.box_x[1] -or $q.Y -lt [double]$M.box_y[0] -or $q.Y -gt [double]$M.box_y[1]) { return $false }
    $k++
  }
  return ($k -eq 3)
}
function Walk-Off([string]$blockName) {
  $S.legStart = 0      # v3.1b: the walk-off fall is intended: no route leg (OFF-PATH) is open until the next Walk-To starts
  $W = $R.m4.walk_off
  Block $blockName $true
  Anchor-ActorYaw
  if ($null -eq $S.cam) { Fail 'no camera yaw estimate' }
  TurnDeg ((Wrap180 ([double]$W.yaw - $S.cam)))
  Wait 500
  Wait-Idle 1200
  # v3.1e WALK-OFF HEADING by displacement: short taps from rest move the Dog along the CAMERA; their bearing must be within
  # -WalkOffTolDeg of walk_off.yaw (turned out and re-measured within -WalkOffProbes rounds), else abort: no walk-off; never a tap
  # within 14 uu of the box's east side
  if ($WalkOffProbes -gt 0) {
    $okH = Probe-Displacement ([double]$W.yaw) $WalkOffTolDeg $WalkOffProbes 'WALKOFF-HEADING'
    if (-not $okH) { Fail ("WALKOFF-HEADING: the walk is not within {0} deg of walk_off.yaw {1} after {2} rounds: no walk-off" -f $WalkOffTolDeg, $W.yaw, $WalkOffProbes) }
  }
  Wait-Idle 500   # v3.1f: On-Kerb needs the newest THREE samples IDLE; the probe's Wait-Idle 200 can leave the third one WALK (rehearsal 7 aborted
                  # "not on the kerb" at (152.2,4459.8) z 112.9, on the kerb)
  if (-not (On-Kerb)) { Fail 'not on the kerb after the turn' }
  $ss = Samples; $zs = @(); for ($i = [Math]::Max(0, $ss.Count - 5); $i -lt $ss.Count; $i++) { $zs += $ss[$i].Z }
  $kz = ($zs | Sort-Object)[[int][Math]::Floor($zs.Count / 2)]
  $t = NowMs
  Key 'W' $true; Wait ([double]$W.hold_ms)
  $hw = Heading 600          # v3.1c: the walk-off's own movement heading (read before W is released; the Dog stands still afterwards)
  Key 'W' $false
  $t2 = NowMs; while (-not (LandedAfterAir $t) -and (NowMs) - $t2 -lt 4000) { Wait 60 }
  if (-not (AirSince $t)) { Row 'NO_FALL' ("kerb z {0:F1}" -f $kz); Block $blockName $false; Fail 'NO-FALL: the walk-off produced no FALL sample (no blind repeat)' }
  Wait-Idle 1700 8000
  $p = Latest
  if ($null -ne $hw) { $S.cam = $hw }       # v3.1c: the walk-off's own movement heading re-anchors the estimate for the return
  Row 'FALL' ("drive estimate: kerb z {0:F1} -> landed z {1:F1} = {2:F1} uu (the judge measures the official drop); walk heading {3}" -f $kz, $p.Z, ($kz - $p.Z), $(if ($null -ne $hw) { '{0:F1}' -f $hw } else { 'n/a' }))
  Block $blockName $false
  Block-Gap ("before the return after {0}" -f $blockName)   # v3.1k (P78): the same gap before the M4 return's first input
}
function Survey-Runway {
  # B-9: the jump runway walked end to end and back, with no jump (a wall on it = NO-PROGRESS = the survey says the runway is blocked)
  $J = $R.jumps; $rw = $J.runway; $x = [double]$rw.x
  Walk-Route $J.approach ([double]$J.arrive_uu)
  Block 'SURVEY_RUNWAY' $true
  Walk-To $x ([double]$rw.y_hi) 120
  Stop-Walk
  TurnDeg (180.0); Wait 300
  Walk-To $x ([double]$rw.y_lo) 120
  Stop-Walk
  Block 'SURVEY_RUNWAY' $false
  Row 'SURVEY_RUNWAY_OK' ("walked x {0}: y {1} -> {2} -> {3}" -f $x, $rw.y_lo, $rw.y_hi, $rw.y_lo)
}
function Do-M4([bool]$survey, [bool]$finalReturn = $false) {
  $M = $R.m4
  $reps = $(if ($survey) { 1 } else { $M4Repeats })
  for ($a = 1; $a -le $reps; $a++) {
    if ($a -eq 1) { Walk-Route $M.approach ([double]$M.arrive_uu) }
    else {
      Walk-Route $M.return ([double]$M.arrive_uu)
      $rest = @(); for ($i = [int]$M.rejoin_index; $i -lt $M.approach.Count; $i++) { $rest += , $M.approach[$i] }
      Walk-Route $rest ([double]$M.arrive_uu)
    }
    if (-not (Mount-Kerb)) { $p = Latest; Fail ("MOUNT-FAILED: not on the kerb (z {0:F1} at ({1:F1};{2:F1}))" -f $p.Z, $p.X, $p.Y) }
    if ($survey) {
      Say 'SURVEY: on the kerb'
      if ($SurveyReturn) { Walk-Off 'SURVEY_WALKOFF'; Walk-Route $M.return ([double]$M.arrive_uu); $rest = @(); for ($i = [int]$M.rejoin_index; $i -lt $M.approach.Count; $i++) { $rest += , $M.approach[$i] }; Walk-Route $rest ([double]$M.arrive_uu); if (-not (Mount-Kerb)) { Fail 'SURVEY: the return route did not lead back onto the kerb' }; Say 'SURVEY: return route verified' }
      return
    }
    Walk-Off ("M4_{0}" -f $a)
    Row 'NOTE' ("M4 attempt {0} of {1} done (Q-M2c-5: every attempt counts; its height is the judge's, never the drive's)" -f $a, $reps)
  }
  if ($finalReturn) {
    # Q-M2c-5 (-Mode all): EVERY attempt is followed by the return, the last one too (the loop's length is measured; the run ends off the landing)
    $tLoop = NowMs
    Walk-Route $M.return ([double]$M.arrive_uu)
    Row 'NOTE' ("return after the last attempt: {0:F1} s" -f (((NowMs) - $tLoop) / 1000.0))
  }
}

# ================================================================ main
$hashes = foreach ($f in @($MyInvocation.MyCommand.Path, (Join-Path $PSScriptRoot 'b33_native.cs'), $Route)) { "{0}  {1}" -f (Get-FileHash $f -Algorithm SHA256).Hash.ToLower(), $f }
$rec = @("B33 DRIVE (W2DEV b33_drive.ps1) DIAGNOSTIC tool, W2DEV, not evidence by itself", "mode=$Mode dry=$([bool]$DryRun) run=$Run utc=$utc",
         "stand=$StandJumps walk=$WalkJumps run=$RunJumps m4=$M4Repeats quiet_s=$QuietSec cpd_param=$CountsPerDeg skipcal=$([bool]$SkipCalibration) noclick=$([bool]$NoClick) turn_stop_deg=$TurnStopDeg drop_abort_uu=$DropAbortUu precise_uu=$PreciseUu floor_tol_uu=$FloorTolUu cal_passes=$CalPasses cal_cpd_range=$CalMinCpd..$CalMaxCpd cal_warmup_counts=$CalWarmupCounts mouse_chunk=$MouseChunk mouse_interval_ms=$MouseIntervalMs sim_actor_turn_rate=$SimActorTurnRate sim_key_up_lag_ms=$SimKeyUpLagMs corner_probe_ms=$CornerProbeMs walkoff_taps=$WalkOffTaps mount_tol_uu=$MountTolUu walkoff_probes=$WalkOffProbes walkoff_probe_ms=$WalkOffProbeMs walkoff_tol_deg=$WalkOffTolDeg sim_lag_ms=$SimLagMs sim_accel=$SimAccel") + $hashes
[IO.File]::WriteAllLines((Join-Path $Out 'DRIVE_RECORD.txt'), [string[]]$rec, $U8)
Copy-Item $Route (Join-Path $Out 'route.json')
Row 'START' ("mode={0} dry={1}" -f $Mode, [bool]$DryRun)
$hooked = $false; $topmost = $false; $script:aborted = $false
try {
  if ($S.dry) {
    $script:sim = New-Object B33.Sim($SimSpawnX, $SimSpawnY, $SimSpawnYaw, $SimCpd, [double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $script:sim.Cpd2 = $SimCpd2; $script:sim.SwitchCounts = $SimCpdSwitchCounts; $script:sim.CpdNegFactor = $SimCpdNegFactor; $script:sim.Accel = $SimAccel
    $script:sim.ActorTurnRate = $SimActorTurnRate   # v3.1d: the Dog's RotationRate yaw 260 deg/s (RelayDogCharacter.cpp:713); rehearsals: max 259-277
    $script:sim.KeyUpLagMs = $SimKeyUpLagMs         # v3.1e: rehearsal 5's 60-ms probe taps turned the actor ~20.5 deg = ~79 ms of W at 260 deg/s
    $T = $R.dry_run_terrain; $script:sim.Ground0 = [double]$T.ground_z
    foreach ($rc in $T.rects) { $script:sim.AddRect([double]$rc.x[0], [double]$rc.x[1], [double]$rc.y[0], [double]$rc.y[1], [double]$rc.z[0], [double]$rc.z[1], [string]$rc.axis) }
    $script:sim.Advance(600)
    Say ("DRY RUN: no input is sent; a kinematic MODEL (true counts/deg {0}) stands in for the game" -f $SimCpd)
  } else {
    $runJson = Get-Content -Raw (Join-Path $Run 'RUN.json') | ConvertFrom-Json
    $S.pids = @($runJson.sender.pids | ForEach-Object { [int]$_ })
    $S.frames = Join-Path $Run 'frames'; if (-not (Test-Path $S.frames)) { $S.frames = $null }
    # ---- WINDOW LAYOUT (the clients ignore -ResX/-ResY; the launcher placed and verified both windows): refuse unless it is still true now
    if (-not $runJson.layout -or -not $runJson.layout.ok) { Fail 'RUN.json has no verified window layout (layout.ok): no input sent' }
    $S.tol = [int]$runJson.layout.tolerance_px
    $gS = [int]$runJson.sender.game_pid; $gO = [int]$runJson.observer.game_pid
    $prS = Get-Process -Id $gS -ErrorAction SilentlyContinue; $prO = Get-Process -Id $gO -ErrorAction SilentlyContinue
    if (-not $prS -or $prS.MainWindowHandle -eq [IntPtr]::Zero) { Fail "the sender GAME process $gS has no window" }
    if (-not $prO -or $prO.MainWindowHandle -eq [IntPtr]::Zero) { Fail "the observer GAME process $gO has no window" }
    $S.hwnd = $prS.MainWindowHandle
    $fS = ConvertTo-Rect ([B33.Win]::FrameRect($S.hwnd)); $cS = ConvertTo-Rect ([B33.Win]::ClientOnScreen($S.hwnd))
    $fO = ConvertTo-Rect ([B33.Win]::FrameRect($prO.MainWindowHandle)); $cO = ConvertTo-Rect ([B33.Win]::ClientOnScreen($prO.MainWindowHandle))
    $rfS = ConvertFrom-JsonRect $runJson.sender.frame_rect; $rcS = ConvertFrom-JsonRect $runJson.sender.client_rect
    $rfO = ConvertFrom-JsonRect $runJson.observer.frame_rect; $rcO = ConvertFrom-JsonRect $runJson.observer.client_rect
    $lw = @()
    if (-not (Test-RectNear $fS $rfS $S.tol)) { $lw += ('sender frame {0} vs RUN.json {1}' -f (Format-Rect $fS), (Format-Rect $rfS)) }
    if (-not (Test-RectNear $cS $rcS $S.tol)) { $lw += ('sender client {0} vs RUN.json {1}' -f (Format-Rect $cS), (Format-Rect $rcS)) }
    if (-not (Test-RectNear $fO $rfO $S.tol)) { $lw += ('observer frame {0} vs RUN.json {1}' -f (Format-Rect $fO), (Format-Rect $rfO)) }
    if (-not (Test-RectNear $cO $rcO $S.tol)) { $lw += ('observer client {0} vs RUN.json {1}' -f (Format-Rect $cO), (Format-Rect $rcO)) }
    if (Test-RectOverlap $fS $fO) { $lw += ('the frames overlap: {0} / {1}' -f (Format-Rect $fS), (Format-Rect $fO)) }
    if (Test-RectOverlap $cS $cO) { $lw += ('the client areas overlap: {0} / {1}' -f (Format-Rect $cS), (Format-Rect $cO)) }
    if ($lw.Count) { Fail ('LAYOUT: the windows are not as the launcher placed them (> {0} px or overlapping): {1}' -f $S.tol, ($lw -join '; ')) }
    $S.frame = $fS; $S.client = $cS
    Row 'LAYOUT_OK' ('sender frame {0} client {1}; observer frame {2} client {3}' -f (Format-Rect $fS), (Format-Rect $cS), (Format-Rect $fO), (Format-Rect $cO))
    $script:tail = New-Object B33.LogTail([string]$runJson.sender.log)
    Say 'waiting for a fresh sender log (the file stamps lag at boot)'
    $t0 = NowMs; Pump
    while (-not (Fresh)) { if ((NowMs) - $t0 -gt 300000) { Fail 'the sender log never became fresh' }; Start-Sleep -Milliseconds 500; Pump }
    if (-not [B33.Guard]::Start()) { Fail 'low-level hooks could not be installed' }
    $hooked = $true
    Start-Sleep -Milliseconds 300
    $o0 = [B33.Guard]::Ours
    [void][B33.Inp]::Rel(1, 0); [void][B33.Inp]::Rel(-1, 0)
    Start-Sleep -Milliseconds 400
    if ([B33.Guard]::Ours - $o0 -lt 2) { Fail 'hook positive control failed (our own +1/-1 px move was not seen): no further input' }
    Row 'HOOK_OK' ("positive control seen: {0} events" -f ([B33.Guard]::Ours - $o0))
    Say ("PRESENCE GATE: waiting for {0} s with no key or mouse event from anyone (hands off the keyboard and mouse)" -f $QuietSec)
    $quietFrom = NowMs; $last = [B33.Guard]::Others; $tq = NowMs
    while ((NowMs) - $quietFrom -lt $QuietSec * 1000) {
      Start-Sleep -Milliseconds 200
      if ([B33.Guard]::Others -ne $last) { $last = [B33.Guard]::Others; $quietFrom = NowMs }
      if ((NowMs) - $tq -gt $QuietMaxWaitSec * 1000) { Fail ('PERSON-PRESENT: no quiet window within the wait (last: ' + [B33.Guard]::LastOther + ')') }
    }
    $S.baseOthers = [B33.Guard]::Others
    Row 'QUIET_OK' ("{0} s without other input" -f $QuietSec)
    $cls = [B33.Win]::FgClass()
    if (@('Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'ControlCenterWindow', 'Windows.UI.Core.CoreWindow', 'NotifyIconOverflowWindow') -contains $cls) { Fail "a shell surface is in front ($cls): leave an ordinary window focused (focus is never forced past the shell)" }
    [B33.Win]::ToFront($S.hwnd); Start-Sleep -Milliseconds 700
    if ($S.pids -notcontains [int][B33.Win]::FgPid()) { Fail 'the sender window could not be brought to the front: no input sent' }
    $S.baseOthers = [B33.Guard]::Others
    [B33.Win]::Topmost($S.hwnd, $true); $topmost = $true
    if (-not $NoClick) {
      # the click point comes from the RE-READ client rect (physical px, the same PER_MONITOR_AWARE_V2 context as the placement); the window
      # under the point must be the sender before the cursor moves there AND again right before the click (terminals can sit above the game)
      $done = $false
      $c = ConvertTo-Rect ([B33.Win]::ClientOnScreen($S.hwnd))
      if (-not (Test-RectNear $c $S.client $S.tol)) { Fail ('the sender client area changed before the click: {0} vs {1}' -f (Format-Rect $c), (Format-Rect $S.client)) }
      foreach ($pt in @(@(50, 72), @(50, 50), @(30, 60), @(70, 60))) {
        $q = Get-ClientPoint $c $pt[0] $pt[1]; $sx = $q.x; $sy = $q.y
        $pid_ = [B33.Win]::PidAt($sx, $sy)
        if ($S.pids -contains [int]$pid_) {
          Check-Guard
          Release-ClipFor $sx $sy   # REHEARSAL PATCH P1: a clip left by the other game would stop the cursor at its edge
          [void][B33.Win]::MoveCursor($sx, $sy); Start-Sleep -Milliseconds 80   # an ABSOLUTE jump (SetCursorPos): no relative deltas over the other game
          $at = [B33.Win]::CursorXY()
          if ($at.X -ne $sx -or $at.Y -ne $sy) {
            Row 'NOTE' ("cursor did not reach the click point {0};{1}: it is at {2};{3} (clip now {4}, foreground pid {5}): next point" -f $sx, $sy, $at.X, $at.Y, (Format-Rect (ConvertTo-Rect ([B33.Win]::ClipRect()))), [B33.Win]::FgPid())
            continue
          }
          if ($S.pids -notcontains [int][B33.Win]::PidAt($sx, $sy)) { continue }
          Check-Guard
          if ($S.pids -notcontains [int][B33.Win]::CursorPid()) { continue }
          [void][B33.Inp]::Click(); Row 'CLICK' ("client {0}%;{1}% screen {2};{3} (client rect {4})" -f $pt[0], $pt[1], $sx, $sy, (Format-Rect $c)); $done = $true; break
        }
        Row 'NOTE' ("click point {0}%;{1}% ({2};{3}) belongs to pid {4}: skipped" -f $pt[0], $pt[1], $sx, $sy, $pid_)
      }
      if (-not $done) { Fail 'no click point inside the sender window could be reached and belongs to the sender (see the NOTE rows)' }
      Wait 800
      # REHEARSAL PATCH P1: after the click the SENDER must own the foreground; it may clip the cursor to its own client rect, which keeps the
      # relative camera moves inside the sender (Mouse() still checks the cursor's window before every move)
      $fgAfter = [B33.Win]::FgPid()
      $clipAfter = ConvertTo-Rect ([B33.Win]::ClipRect())
      if ($S.pids -notcontains [int]$fgAfter) { Fail ("after the click the sender does not own the foreground (foreground pid {0}; clip {1}): no further input" -f $fgAfter, (Format-Rect $clipAfter)) }
      Row 'NOTE' ("after the click: foreground = sender pid {0}; cursor clip {1} ({2})" -f $fgAfter, (Format-Rect $clipAfter),
        $(if ((Test-PointInRect $clipAfter $c.left $c.top) -and (Test-PointInRect $clipAfter ($c.right - 1) ($c.bottom - 1)) -and (($clipAfter.right - $clipAfter.left) -le ($c.right - $c.left) + 2 * $S.tol) -and (($clipAfter.bottom - $clipAfter.top) -le ($c.bottom - $c.top) + 2 * $S.tol)) { 'clipped to the sender client area' } else { 'not clipped to the sender client area' }))
    }
  }
  if (-not $SkipCalibration) { Calibrate } else { Row 'CAL' ("skipped; counts_per_deg={0:F3}" -f $S.cpd) }
  switch ($Mode) {
    'calibrate' { }
    'jumps' { Do-Jumps }
    'm4' { Do-M4 $false }
    'survey' { Survey-Runway; Do-M4 $true }
    'all' { Do-Jumps; Do-M4 $false $true }   # v3.1 R7-01: one judged run, all four scenarios; Q-M2c-5: 10 attempts, each with its return
  }
  Row 'END' 'ok'
  Say 'DONE'
} catch {
  $msg = $_.Exception.Message
  Row 'ABORT' $msg
  Say ("ABORT: {0}" -f $msg)
  $script:aborted = $true
} finally {
  ReleaseAll
  Capture $false
  if ($topmost) { [B33.Win]::Topmost($S.hwnd, $false) }
  if ($hooked) { [B33.Guard]::Stop() }
  if ($S.dry) {
    Say ("DRY RUN: B33.Inp calls = {0} (must be 0)" -f [B33.Inp]::Calls); Row 'DRYRUN_INP_CALLS' ([string][B33.Inp]::Calls)
    if ($null -ne $script:sim) { $script:sim.WriteLog((Join-Path $Out 'DRYRUN_model_sender.log')); Say 'DRY RUN: the model sender log (client line formats) is DRYRUN_model_sender.log' }
  }
  Say ("timeline: {0}" -f $TL)
  # v3.1k (P80): an aborted drive asks the run's conductor to close the run AT ONCE (the same STOP_REQUEST b33_stop.ps1 writes), so the
  # lease and both clients are released within seconds (composition 3: nobody ran the stop after the abort; the run held the lease and
  # the idle clients for 12.5 min). Never in a dry run; -NoAutoStop leaves the run open for a look before b33_stop.ps1.
  if ($script:aborted -and -not $S.dry -and -not $NoAutoStop) {
    try {
      if (Test-Path (Join-Path $Run 'RUN.json')) {
        Set-Content -Path (Join-Path $Run 'STOP_REQUEST') -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ascii
        Say 'AUTO-STOP: wrote STOP_REQUEST; the conductor closes the run (kills only its recorded pids, hashes the logs, releases the lease)'
      }
    } catch { Say ("AUTO-STOP failed: {0}; run b33_stop.ps1 -Run now" -f $_.Exception.Message) }
  }
}
if ($script:aborted) { exit 1 }
exit 0
