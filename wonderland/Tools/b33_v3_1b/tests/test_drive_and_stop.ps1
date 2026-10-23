# test_drive_and_stop.ps1 -- tests of b33_drive.ps1 (DRY RUN only: NO input is sent) and b33_stop.ps1. DIAGNOSTIC tool, W2DEV, not evidence by itself.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File tests\test_drive_and_stop.ps1
# Writes only under tests\dryrun_out\ and tests\stop_fixture\. Starts two harmless sleeping powershell processes for the stop test and ends them.
#  D1 calibrate dry run: recovers the model's counts/deg within 3 %; B33.Inp calls = 0
#  D2 jumps dry run: completes; the model's sender log sliced by b33_slicer.py gives >= 12 STANDING, WALKING and RUNNING jumps; Inp calls 0
#  D3 m4 dry run: completes 5 walk-offs; the slicer lists 5 walk-off falls, all >= 100.0 uu; Inp calls 0
#  D4 MUST ABORT: the model's mouse turns the other way (-SimCpd negative): the calibration aborts ("CAL:") and no block starts
#  D5 MUST ABORT: a route whose kerb box is wrong: MOUNT-FAILED, no M4 block, no walk-off
#  L1-L4 window-layout helpers (b33_layout.ps1): 2 px tolerance, overlap, the layout check (verified 960x1080 split passes; the clients' own
#        1600x1000 windows and a 3 px offset are refused), the click point from the re-read client rect
#  L5/L6 the REAL-mode drive refuses before any hook or input when RUN.json has no verified layout, or the sender GAME window is not there
#  L7-L9 R8-04 cursor clip (B35 rehearsal finding; no input, ClipCursor is never called here): L7 the clip decision (the measured clip
#        (970,39)-(1910,1070) vs the sender point 480;783 -> release; inside -> none; edges exclusive; a whole-desktop clip -> none);
#        L8 b33_native.cs ClipRect / VirtualDesktop / CursorXY read sane values (read only); L9 the click path order in the drive: release the
#        clip -> absolute jump -> arrival check -> click -> foreground check, the release verified, NOTEd and skipped in a dry run
#  L10 v3.1d paced mouse (B33.Inp.RelPaced): it stops BEFORE the first chunk when other input was seen since the base count, or when the
#        foreground window is not one of the given pids (returns 0; B33.Inp.Calls unchanged: nothing is sent)
#  C1-C3 b33_launch.ps1 -DryChecks (no lease, nothing started): cbe584be's server inputs accepted (full commit, lockfile identical, archive
#        list counted), a node_modules tree with a different package-lock.json refused, -ServerTree marked NOT-PREREG
#  C4/C5 R4-13: a package whose game exe is not the candidate is refused at launch; B-5: no -wlframes, the exact switch list recorded
#  C6 THE PENDING MARKER REFUSES: a candidate file whose status is "PENDING z" (every other field matching the package) is refused before
#        anything is made (exit 2, no run folder); and the SHIPPED tools\b33\CANDIDATE.json, while not READY, refuses the same way; a
#        malformed candidate file (an unescaped quote) is refused too
#  C7 the other candidate refusals, each before anything is made: boot exe, -Commit, -Package folder; a non-default -CandidateFile without -DryChecks
#  C8 lead 10-20: with -RenderCvars 'scalability 0' the planned client arguments carry -ExecCmds="wl.Social.Dev <id> http://127.0.0.1:8796,
#        wl.Remote.LogPeriod 0.1,scalability 0", RUN.json's disclosed.render_cvars is ["scalability 0"] and prereg_launch is true (false + NOTE
#        without it); -Control appends exactly the three old values on the observer only; no client's -ExecCmds has an empty command (the
#        observer's used to end in a trailing comma: $(if ... else { @() }) passed one '' entry)
#  C9 launcher -> judge: a synthetic run whose Command Lines are C8's planned arguments PASSES the judge's launch checks; the same with one
#        more observer command (wl.Remote.RttClock 1, r.ScreenPercentage 50) is VOID; C1's launch without 'scalability 0' is VOID
#  V1-V3 B-9: the route survey record (ROUTE OK; the SURVEY_WALKOFF fall printed, never counted); a proposed route changing kerb_z REFUSED; a
#        proposed route moving a waypoint accepted
#  S1 b33_stop.ps1 kills the recorded process whose pid AND start time match, leaves alone one whose start time does not, hashes, closes
#     (-SkipS1 leaves S1 out: it starts two sleeping powershell processes, which a "launch nothing" reviewer may not want; R7 section 4)
# v3.1 (M2b ruling fea3fb7f; REHEARSAL findings):
#  D6 R7-01: -Mode all = ONE drive with the jump blocks then the M4 blocks: STAND, WALK, RUN and 5 M4_* blocks in one timeline; 0 input calls
#  D7 route v2 (routes\b33_route_v2.json) survey -SurveyReturn dry run: the runway, the approach with CORNER stops, the mount, the walk-off
#     and the return route back onto the kerb; 0 input calls
#  D8 v1's approach waypoints on v2's model terrain reach the kerb with the rules ON; the rule-OFF run (-TurnStopDeg 180) is printed only
#     (until v3.1b it swung off the edge: LEFT-THE-PATH; the v3.1b line-following now holds that corner in the model). Before v3.1b:
#     off the path's east edge and abort LEFT-THE-PATH; with the rule ON (default 35) the same waypoints reach the kerb
#  V4 R7-09: the survey record of a run that DROVE route v2: "NOT the pinned v1 ... bounded against v1", inside the bounds, ROUTE OK
# v3.1b (rehearsal survey 2):
#  D9  route v3 (the path centre line) survey + return with the model's reports 250 ms late (-SimLagMs, like the real log): two calibration
#      passes, PRECISE arrivals at the corners and the last points, the mount, the walk-off, the return and a second mount; 0 input calls
#  D10 a calibration that is not repeatable (the model's counts/deg changes from 4.6 to 6.0 after 170 counts): CAL aborts (> 8 %)
#  D11 the rehearsal-2 guard miss in the model: a GENTLE down-ramp (60 uu over 600 uu, ~23 uu/s) that the 1-s drop guard can never see:
#      the leg aborts OFF-PATH (the leg floor, -FloorTolUu 15); with the floor guard switched off (-FloorTolUu 1000) it does not
# v3.1c (rehearsal survey 3 + the jumps rehearsal): D3 / D6 / D9 / V1 now drive the PROPOSED route v4 with the model's acceleration
#      (-SimAccel 2048); D7 / D8 (routes v2 / v1, mount at x 163: no room for the walk-off probes) run with -WalkOffProbes 0;
#  D9  route v4 survey + return (reports 250 ms late, acceleration): the median calibration, precise arrivals, the eastward mount deep in
#      the box, the WALKOFF-HEADING probe within 5 deg, a walk-off the slicer qualifies (>= 100), the return on the slab, a second mount
#  D10 v3.1d calibration is a starting gain, not a gate: a +/- input asymmetry (-SimCpdNegFactor 1.2) gives separate gains + 4.6 / - 5.52
#      and goes on; a first-pass outlier (5.0 then 6.0 counts/deg) gives the median 6.0 and goes on (the spread is logged); the standing
#      +/-200-count warm-up (CAL_WARMUP) comes first
#  D12 heading drift (the model's counts/deg becomes 3.8 after the out-and-back calibration, 21 % off): the heading probes turn the
#      > 5 deg errors out (with the Dog's 260 deg/s the corner probe before (110,4470) already does), both M4 walk-offs of route v4 leave
#      within 5 deg and qualify by the slicer
#  D16 rehearsal 5's trough in the model (route v5's terrain): route v4's eastward mount stops with MOUNT-DOWN / OFF-PATH, never a mount
#      or a walk-off; route v5 (onto the strip at its small step, then north on it) mounts and its walk-off qualifies
# v3.1e (rehearsal survey 5): the walk-off heading is measured by displacement
# v3.1f (rehearsal survey 6): D3 / D6 / D9 / D12 / D16 / V1 drive the PROPOSED route v6 (v5 + rehearsal 3's return, careful points, a declared
#      descent); D17: v5's return against the landing's wall (rehearsal 6) and v6 without its declared descent (the guards still stop it)
#  D13 rehearsal 3's F-A reproduced: the mount at the box's south edge (161;4452) approached NE (v3) with the same drift: without probes
#      the walk-off lands on the step (z 27.5): the slicer's drop < 100 (excluded); with the v3.1e displacement probe the error is measured and
#      turned out and the walk-off qualifies (or, with no room, the drive refuses: no walk-off); never a short fall
#  D14 the jumps mode does not need fine heading: with the model's counts/deg 20 % off after calibration (every 180-deg U-turn misses by
#      ~36 deg) the runway passes still give >= 12 STANDING, WALKING and RUNNING jumps (the steering re-measures the walked heading)
#  D15 rehearsal 4's abort in the model: a wall across calibration pass 3 AFTER its turn: the pass is still measured from the actor yaw
#      (position heading n/a) and the run goes on; a spawn walled in on every side: every pass is skipped and the drive stops ("no pass
#      could be measured"), the only calibration abort left besides a wrong sign or no turn
# v3.1j (DEV exploration 3): D19 route v10 (PROPOSED; the return goes south on the terrace, over its bump, west down to the approach's own
#      path at (0,2908) and rejoins the approach): (a) survey + return with reports 250 ms late: two mounts, no abort, the tight corner
#      (240;2935) within 12 uu; (b) -Mode all: 10 M4 blocks, 10 qualifying falls, the final return, the model's loop times printed;
#      (c) v9 on v10's terrain (the upper flight walled, as exploration 2 found it in the game) stops at the flight. D18's v9 climb holds
#      only on v9's own (older) model terrain.
# v3.1k (survey 11): D20 the sender log reaches the drive in a burst: ONCE at y >= 3150 no report arrives for 2.4 s (-SimStallY /
#      -SimStallMs, survey 11's stall on the approach): the arrival at (0,3300) is judged by the NEAREST sample of the burst (P75), so the
#      leg arrives instead of walking on, and the v10 survey + return still re-mounts
# v3.1k (composition 2): D21 the pass rule (P76) on composition 2's own samples: a pass-through waypoint passed within 100 uu of its
#      leg line is reached; short of it, too far aside, or with -PassLatUu 0 it is not
# v3.1k (composition 3): D22 On-Kerb (P77): the newest report whose soles line has not arrived yet is skipped; the other rules hold
# v3.1k (composition 4): D23 route v11 (P79) differs from v10 only in the z hint of (0,2908) (26.8 -> 20.0) and its survey + return
#      re-mounts in the model; P80: an aborted live drive writes STOP_REQUEST (the conductor closes the run), a dry run never does
# v3.1k (P78, ruling Q-B33-1 condition 4): D24 after every BLOCK_END: >= 1.601 s with no input and no BLOCK_BEGIN, then 2 fresh IDLE
#      reports (BLOCK_GAP rows); the same checker FAILs a fixture with a 0.1 s gap and finds the old drive's overlaps in composition 5;
#      P81: a corner stop that starts a declared descent is held to that descent's floor (the v11 -Mode all run passes the bump 10 times)
param([switch]$SkipS1)
$ErrorActionPreference = 'Stop'
$b = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'dryrun_out'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null
$fails = 0
$v4route = Join-Path $b 'routes\b33_route_v4.json'
$v5route = Join-Path $b 'routes\b33_route_v5.json'     # v3.1e: route v5 (rehearsal 6 drove it)
$v6route = Join-Path $b 'routes\b33_route_v6.json'     # v3.1f: route v6 (rehearsals 7-8 drove it); D17 uses it
$v7route = Join-Path $b 'routes\b33_route_v7.json'     # v3.1f: route v7 (rehearsal 9b drove it); D18 uses it
$v8route = Join-Path $b 'routes\b33_route_v8.json'     # v3.1f: route v8 (composition 1 drove it); D18 uses it
$v9route = Join-Path $b 'routes\b33_route_v9.json'     # v3.1g: D3 / D6 / D9 / D12 / D16 / V1 drive the PROPOSED route v9
$v10route = Join-Path $b 'routes\b33_route_v10.json'   # v3.1j: D19 drives the PROPOSED route v10 (DEV exploration 3)
$v11route = Join-Path $b 'routes\b33_route_v11.json'   # v3.1k: D23 drives the PROPOSED route v11 (v10 + one z hint, composition 4)
$sim = @('-SimAccel', '900')     # v3.1d: the Dog's NormalAcceleration 900 (RelayDogCharacter.cpp:710); rehearsal 4 start-up ~800 uu/s^2
function Check([string]$name, [bool]$ok, [string]$detail = '') { if ($ok) { Write-Output "OK   $name $detail" } else { Write-Output "FAIL $name $detail"; $script:fails++ } }
function DryRun([string]$mode, [string[]]$extra) {
  $before = @(Get-ChildItem $out -Directory | ForEach-Object { $_.FullName })
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_drive.ps1') -Run $out -Mode $mode -DryRun @extra 2>&1
  $code = $LASTEXITCODE
  $d = Get-ChildItem $out -Directory | Where-Object { $before -notcontains $_.FullName } | Select-Object -First 1
  $tl = Import-Csv (Join-Path $d.FullName 'timeline.csv')
  return [pscustomobject]@{ code = $code; dir = $d.FullName; tl = $tl }
}
function InpCalls($r) { $row = $r.tl | Where-Object event -eq 'DRYRUN_INP_CALLS' | Select-Object -Last 1; if ($row) { [int]$row.detail } else { -1 } }
function Slice($r) { (& python -I -B (Join-Path $b 'b33_slicer.py') (Join-Path $r.dir 'DRYRUN_model_sender.log') | Select-Object -First 1) }

# D1
$r = DryRun 'calibrate' @()
$cal = ($r.tl | Where-Object event -eq 'CAL').detail
$cpd = [double](($cal -split 'counts_per_deg=')[1])
Check 'D1 calibrate' ($r.code -eq 0 -and [Math]::Abs($cpd - 4.6) / 4.6 -lt 0.03 -and (InpCalls $r) -eq 0) "cpd=$cpd inp=$(InpCalls $r)"
# D2
$r = DryRun 'jumps' @()
$head = Slice $r
$m = [regex]::Match($head, 'STANDING (\d+) WALKING (\d+) RUNNING (\d+)')
$ok = $m.Success -and [int]$m.Groups[1].Value -ge 12 -and [int]$m.Groups[2].Value -ge 12 -and [int]$m.Groups[3].Value -ge 12
Check 'D2 jumps' ($r.code -eq 0 -and $ok -and (InpCalls $r) -eq 0) $head
# D3
$r = DryRun 'm4' (@('-Route', $v9route) + $sim)
$txt = & python -I -B (Join-Path $b 'b33_slicer.py') (Join-Path $r.dir 'DRYRUN_model_sender.log')
$q = @($txt | Where-Object { $_ -match '^\s+\d+ \| .* \| YES \|' }).Count
Check 'D3 m4: EXACTLY 10 attempts by default (Q-M2c-5)' ($r.code -eq 0 -and $q -eq 10 -and (InpCalls $r) -eq 0 -and @($r.tl | Where-Object { $_.event -eq 'BLOCK_BEGIN' -and $_.detail -like 'M4_*' }).Count -eq 10) "qualifying falls $q"
# D4
$r = DryRun 'jumps' @('-SimCpd', '-4.6')
$ab = ($r.tl | Where-Object event -eq 'ABORT').detail
Check 'D4 inverted mouse aborts at calibration' ($r.code -eq 1 -and $ab -like '*CAL:*' -and -not ($r.tl | Where-Object event -eq 'BLOCK_BEGIN') -and (InpCalls $r) -eq 0) $ab
# D5
$route = Get-Content -Raw (Join-Path $b 'routes\b33_route_v1.json') | ConvertFrom-Json
$route.m4.mount.box_x = @(500.0, 520.0)
$bad = Join-Path $out 'route_bad_box.json'; $route | ConvertTo-Json -Depth 10 | Set-Content -Path $bad -Encoding utf8
$r = DryRun 'm4' @('-Route', $bad)
$ab = ($r.tl | Where-Object event -eq 'ABORT').detail
Check 'D5 wrong kerb box: MOUNT-FAILED (or v3.1e MOUNT-DOWN), no walk-off' ($r.code -eq 1 -and ($ab -like '*MOUNT-FAILED*' -or $ab -like '*MOUNT-DOWN*') -and -not ($r.tl | Where-Object { $_.event -eq 'BLOCK_BEGIN' }) -and (InpCalls $r) -eq 0) $ab
# D6 R7-01 one judged run = one drive with every block
$r = DryRun 'all' (@('-Route', $v9route) + $sim)
$bb = @($r.tl | Where-Object event -eq 'BLOCK_BEGIN' | ForEach-Object { $_.detail })
$ok6 = $r.code -eq 0 -and ($bb -contains 'STAND') -and ($bb -contains 'WALK') -and ($bb -contains 'RUN') -and @($bb | Where-Object { $_ -like 'M4_*' }).Count -eq 10 -and @($r.tl | Where-Object { $_.event -eq 'NOTE' -and $_.detail -like 'return after the last attempt*' }).Count -eq 1 -and (InpCalls $r) -eq 0 -and @(Get-ChildItem $r.dir -Filter 'timeline.csv').Count -eq 1
Check 'D6 -Mode all: STAND, WALK, RUN and 10 M4 blocks (Q-M2c-5) in ONE drive timeline (R7-01), the last one followed by its return' $ok6 ("blocks: " + ($bb -join ','))
# D7 / D8 route v2 and the rehearsal-1 failure, in their own dry-run folder (V1 keeps reading the v1 survey)
$v31 = Join-Path $out 'v31'; New-Item -ItemType Directory -Force $v31 | Out-Null
function DryRunAt([string]$dir, [string]$mode, [string[]]$extra) {
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_drive.ps1') -Run $dir -Mode $mode -DryRun @extra 2>&1
  $code = $LASTEXITCODE
  $d = Get-ChildItem $dir -Directory | Sort-Object Name | Select-Object -Last 1
  return [pscustomobject]@{ code = $code; dir = $d.FullName; tl = (Import-Csv (Join-Path $d.FullName 'timeline.csv')) }
}
$v2route = Join-Path $b 'routes\b33_route_v2.json'
$r7 = DryRunAt (Join-Path $v31 'survey_v2') 'survey' @('-Route', $v2route, '-SurveyReturn', '-WalkOffProbes', '0')
$ok7 = $r7.code -eq 0 -and @($r7.tl | Where-Object event -eq 'ON_KERB').Count -eq 2 -and @($r7.tl | Where-Object event -eq 'CORNER').Count -ge 3 -and
       @($r7.tl | Where-Object event -eq 'SURVEY_RUNWAY_OK').Count -eq 1 -and (InpCalls $r7) -eq 0
Check 'D7 route v2 survey + return dry run: runway, CORNER stops, mount, walk-off, return onto the kerb' $ok7 ("corners {0}; on_kerb {1}" -f @($r7.tl | Where-Object event -eq 'CORNER').Count, @($r7.tl | Where-Object event -eq 'ON_KERB').Count)
$rr = Get-Content -Raw $v2route | ConvertFrom-Json
$rr.m4.approach = @(@(0, 1000), @(0, 2600), @(0, 3300), @(180, 3450), @(180, 4380)); $rr.m4.arrive_uu = 70
$v1app = Join-Path $v31 'route_v1approach_on_v2terrain.json'; $rr | ConvertTo-Json -Depth 10 | Set-Content -Path $v1app -Encoding utf8
$r8a = DryRunAt (Join-Path $v31 'v1app_rule_off') 'm4' @('-Route', $v1app, '-TurnStopDeg', '180', '-M4Repeats', '1', '-WalkOffProbes', '0')
$ab8 = ($r8a.tl | Where-Object event -eq 'ABORT').detail
$r8b = DryRunAt (Join-Path $v31 'v1app_rule_on') 'm4' @('-Route', $v1app, '-M4Repeats', '1', '-WalkOffProbes', '0')
$ok8 = (InpCalls $r8a) -eq 0 -and $r8b.code -eq 0 -and @($r8b.tl | Where-Object event -eq 'ON_KERB').Count -eq 1 -and @($r8b.tl | Where-Object event -eq 'CORNER').Count -ge 1
Check 'D8 v1 waypoints on the model terrain reach the kerb with the v3.1 rules (rule-off outcome printed: the v3.1b line-following alone now holds this corner in the model; D11 tests the guard)' $ok8 ("rule off: exit {0} {1} | rule on: exit {2}" -f $r8a.code, $ab8, $r8b.code)

# D9-D11 v3.1b (rehearsal survey 2)
$v3route = Join-Path $b 'routes\b33_route_v3.json'
function SlicerFalls($r) { @(& python -I -B (Join-Path $b 'b33_slicer.py') (Join-Path $r.dir 'DRYRUN_model_sender.log') | Where-Object { $_ -match '^\s+\d+ \|' }) }
$r9 = DryRunAt (Join-Path $v31 'survey_v9_lag') 'survey' (@('-Route', $v9route, '-SurveyReturn', '-SimLagMs', '250') + $sim)
$wo9 = @($r9.tl | Where-Object { $_.event -eq 'HEADING_PROBE' -and $_.detail -like 'WALKOFF*' } | Select-Object -Last 1)
$f9 = @(SlicerFalls $r9)
$ok9 = $r9.code -eq 0 -and @($r9.tl | Where-Object event -eq 'ON_KERB').Count -eq 2 -and @($r9.tl | Where-Object event -eq 'CAL').Count -eq 1 -and
       @($r9.tl | Where-Object { $_.event -eq 'ARRIVED' -and $_.detail -like '*precise*' }).Count -ge 4 -and (InpCalls $r9) -eq 0 -and
       -not ($r9.tl | Where-Object event -eq 'ABORT') -and $wo9.Count -eq 1 -and ($f9[0] -match '\| YES \|')
Check 'D9 route v9 survey + return (late reports, acceleration): calibration, precise arrivals, the step onto the strip, the mount north on it, the walk-off heading by displacement, a qualifying walk-off, return, re-mount' $ok9 ("precise {0}; on_kerb {1}; last walk-off probe: {2}; first fall: {3}" -f @($r9.tl | Where-Object { $_.event -eq 'ARRIVED' -and $_.detail -like '*precise*' }).Count, @($r9.tl | Where-Object event -eq 'ON_KERB').Count, $(if ($wo9.Count) { $wo9[0].detail } else { 'none' }), $(if ($f9.Count) { $f9[0].Trim() } else { 'none' }))
$r10 = DryRunAt (Join-Path $v31 'cal_asym') 'calibrate' @('-SimCpdNegFactor', '1.2')
$cal10 = ($r10.tl | Where-Object event -eq 'CAL').detail
$r10b = DryRunAt (Join-Path $v31 'cal_outlier') 'calibrate' @('-SimCpd', '5.0', '-SimCpd2', '6.0', '-SimCpdSwitchCounts', '570')   # warm-up 400 + pass 1
$cal10b = ($r10b.tl | Where-Object event -eq 'CAL').detail
$cpd10b = $(if ($cal10b) { [double](($cal10b -split 'counts_per_deg=')[1]) } else { 0 })
$ok10 = $r10.code -eq 0 -and $cal10 -like '*gains + 4.600 / - 5.520*' -and (InpCalls $r10) -eq 0 -and @($r10.tl | Where-Object event -eq 'CAL_WARMUP').Count -eq 1 -and
        $r10b.code -eq 0 -and $cal10b -like '*spread 16.7%*not a gate*' -and [Math]::Abs($cpd10b - 6.0) / 6.0 -lt 0.03
Check 'D10 calibration is a starting gain: an asymmetry gives separate +/- gains, a first-pass outlier gives the median; neither stops the run' $ok10 ("asym: {0} | outlier: {1}" -f $cal10, $cal10b)
$rr = Get-Content -Raw $v3route | ConvertFrom-Json
$rr.m4.approach = @(@(0, 1000), @(600, 1000))
$rr.dry_run_terrain.rects = @([pscustomobject]@{ x = @(200, 800); y = @(900, 1100); z = @(10, -50); axis = 'x'; note = 'a gentle down-ramp (test fixture)' })
$ramp = Join-Path $v31 'route_gentle_ramp.json'; $rr | ConvertTo-Json -Depth 10 | Set-Content -Path $ramp -Encoding utf8
$r11a = DryRunAt (Join-Path $v31 'ramp_floor_on') 'm4' @('-Route', $ramp, '-M4Repeats', '1')
$r11b = DryRunAt (Join-Path $v31 'ramp_floor_off') 'm4' @('-Route', $ramp, '-M4Repeats', '1', '-FloorTolUu', '1000')
$ab11a = ($r11a.tl | Where-Object event -eq 'ABORT').detail; $ab11b = ($r11b.tl | Where-Object event -eq 'ABORT').detail
$ok11 = $r11a.code -eq 1 -and $ab11a -like '*OFF-PATH on the leg to (600;1000)*' -and $ab11b -notlike '*OFF-PATH*' -and $ab11b -notlike '*LEFT-THE-PATH*' -and (InpCalls $r11a) -eq 0
Check 'D11 a gentle descent (~23 uu/s, invisible to the 1-s drop guard) aborts OFF-PATH; with the floor guard off it does not' $ok11 ("on: {0} | off: {1}" -f $ab11a, $ab11b)
$drift = @('-SimLagMs', '250', '-SimCpd2', '3.8', '-SimCpdSwitchCounts', '2700') + $sim   # after the warm-up and the out-and-back calibration (~2560 counts)
# v3.1f: D12 uses a 10 % gain error (counts/deg 4.6 -> 4.18). With 21 % the model fails route v8's tight stair climb at its GUESSED wall
# corner (307,3530); the real calibrations since v3.1d read 7.0-7.16 counts/deg with spreads of 1.3-4.8 %. D13 keeps the 21 % fixture.
$drift12 = @('-SimLagMs', '250', '-SimCpd2', '4.18', '-SimCpdSwitchCounts', '2700') + $sim
$r12 = DryRunAt (Join-Path $v31 'v9_drift_m4x2') 'm4' (@('-Route', $v9route, '-M4Repeats', '2') + $drift12)
function ProbeErr($row) { [double](($row.detail -split 'error ')[1] -replace ' deg.*', '') }
$hp12 = @($r12.tl | Where-Object { $_.event -eq 'HEADING_PROBE' })
$big12 = @($hp12 | Where-Object { [Math]::Abs((ProbeErr $_)) -gt 5 }).Count
$lastWo12 = @(); $prev = $null                                   # the last walk-off probe before each FALL row
foreach ($row in $r12.tl) { if ($row.event -eq 'HEADING_PROBE' -and $row.detail -like 'WALKOFF*') { $prev = $row } elseif ($row.event -eq 'FALL' -and $prev) { $lastWo12 += $prev; $prev = $null } }
$f12 = @(SlicerFalls $r12)
$ok12 = $r12.code -eq 0 -and $big12 -ge 1 -and $lastWo12.Count -eq 2 -and @($lastWo12 | Where-Object { [Math]::Abs((ProbeErr $_)) -le 5 }).Count -eq 2 -and
        @($f12 | Where-Object { $_ -match '\| YES \|' }).Count -eq 2 -and (InpCalls $r12) -eq 0
Check 'D12 heading drift 10 %: the probes turn the > 5 deg errors out (corners or walk-off); both walk-offs leave within 5 deg and qualify' $ok12 ("probes {0} (errors > 5: {1}); last walk-off errors {2}; qualifying falls {3}" -f $hp12.Count, $big12, (($lastWo12 | ForEach-Object { '{0:F1}' -f (ProbeErr $_) }) -join ' / '), @($f12 | Where-Object { $_ -match '\| YES \|' }).Count)
$rf = Get-Content -Raw $v4route | ConvertFrom-Json
$rf.m4.approach = @(@(0, 1000), @(0, 2600), @(0, 3300), @(0, 3550), @(0, 3800), @(0, 4050), @(0, 4300), @(0, 4380), @(100, 4380)); $rf.m4.mount.to = @(161, 4452)
$faRoute = Join-Path $v31 'route_FA_edge_mount.json'; $rf | ConvertTo-Json -Depth 10 | Set-Content -Path $faRoute -Encoding utf8
$r13a = DryRunAt (Join-Path $v31 'FA_noprobe') 'm4' (@('-Route', $faRoute, '-M4Repeats', '1', '-WalkOffProbes', '0') + $drift)
$f13 = @(SlicerFalls $r13a)
$r13b = DryRunAt (Join-Path $v31 'FA_probe') 'm4' (@('-Route', $faRoute, '-M4Repeats', '1') + $drift)
$ab13 = ($r13b.tl | Where-Object event -eq 'ABORT').detail
$f13b = @(SlicerFalls $r13b)
$wr13 = @($r13b.tl | Where-Object { $_.event -eq 'HEADING_PROBE' -and $_.detail -like 'WALKOFF*' } | ForEach-Object { ProbeErr $_ })
$fixed13 = $r13b.code -eq 0 -and $wr13.Count -ge 2 -and [Math]::Abs($wr13[0]) -gt 5 -and [Math]::Abs($wr13[-1]) -le 5 -and $f13b.Count -ge 1 -and
           @($f13b | Where-Object { $_ -notmatch '\| YES \|' }).Count -eq 0
$refused13 = $r13b.code -eq 1 -and $ab13 -like '*WALKOFF-HEADING*' -and -not ($r13b.tl | Where-Object { $_.event -eq 'FALL' })
$ok13 = $f13.Count -ge 1 -and ($f13[0] -match '\| no \|') -and ($fixed13 -or $refused13)
$r14 = DryRunAt (Join-Path $v31 'jumps_drift20') 'jumps' (@('-SimCpd2', '5.52', '-SimCpdSwitchCounts', '2700') + $sim)
$m14 = [regex]::Match((& python -I -B (Join-Path $b 'b33_slicer.py') (Join-Path $r14.dir 'DRYRUN_model_sender.log') | Select-Object -First 1), 'STANDING (\d+) WALKING (\d+) RUNNING (\d+)')
$ok14 = $r14.code -eq 0 -and $m14.Success -and [int]$m14.Groups[1].Value -ge 12 -and [int]$m14.Groups[2].Value -ge 12 -and [int]$m14.Groups[3].Value -ge 12 -and (InpCalls $r14) -eq 0
Check 'D14 jumps with counts/deg 20 % off after calibration: still >= 12 standing / walking / running jumps (no fine heading needed)' $ok14 $m14.Value
$rw = Get-Content -Raw $v4route | ConvertFrom-Json
$rw.dry_run_terrain.rects = @($rw.dry_run_terrain.rects) + @([pscustomobject]@{ x = @(-200, -175); y = @(-180, -160); z = @(100, 100); axis = ''; note = 'a wall across calibration pass 3 after its turn (test)' })
$wallA = Join-Path $v31 'route_calwall_after_turn.json'; $rw | ConvertTo-Json -Depth 10 | Set-Content -Path $wallA -Encoding utf8
$r15a = DryRunAt (Join-Path $v31 'cal_wall_after_turn') 'calibrate' @('-Route', $wallA)
$p15 = ($r15a.tl | Where-Object { $_.event -eq 'CAL_PASS' -and $_.detail -like 'pass 3:*' }).detail
$rw = Get-Content -Raw $v4route | ConvertFrom-Json
$rw.dry_run_terrain.rects = @($rw.dry_run_terrain.rects) + @([pscustomobject]@{ x = @(-420, -240); y = @(-740, -560); z = @(100, 100); axis = ''; note = 'walls around the spawn (test)' },
                                                            [pscustomobject]@{ x = @(-345, -315); y = @(-665, -635); z = @(10, 10); axis = ''; note = 'the spawn floor inside them (test)' })
$wallB = Join-Path $v31 'route_calwall_enclosed.json'; $rw | ConvertTo-Json -Depth 10 | Set-Content -Path $wallB -Encoding utf8
$r15b = DryRunAt (Join-Path $v31 'cal_wall_enclosed') 'calibrate' @('-Route', $wallB)
$ab15 = ($r15b.tl | Where-Object event -eq 'ABORT').detail
$ok15 = $r15a.code -eq 0 -and $p15 -like '*position heading n/a*counts_per_deg=*' -and (($r15a.tl | Where-Object event -eq 'CAL').detail) -like 'passes measured 3 of 3*' -and
        $r15b.code -eq 1 -and @($r15b.tl | Where-Object { $_.event -eq 'CAL_PASS' -and $_.detail -like '*skipped*' }).Count -eq 3 -and $ab15 -like '*no pass could be measured*' -and (InpCalls $r15b) -eq 0
Check "D15 rehearsal 4's abort: a pass blocked after its turn is still measured (actor yaw) and the run goes on; a walled-in spawn stops it" $ok15 ("blocked after the turn: {0} | walled in: {1}" -f $p15, $ab15)
Check "D13 rehearsal 3's F-A in the model: edge mount + drift, no probe -> the walk-off lands short of 100 (excluded); with the v3.1e displacement probe -> the error is turned out and the walk-off qualifies (or a refusal)" $ok13 ("no probe: {0} | probe: {1}" -f $(if ($f13.Count) { $f13[0].Trim() } else { 'no fall' }), $(if ($ab13) { $ab13 } else { 'walk-off round errors ' + (($wr13 | ForEach-Object { '{0:F1}' -f $_ }) -join ' / ') + '; ' + (@($f13b | ForEach-Object { $_.Trim() }) -join ' || ') }))
$rt = Get-Content -Raw $v4route | ConvertFrom-Json
$rt.dry_run_terrain = (Get-Content -Raw $v9route | ConvertFrom-Json).dry_run_terrain      # route v4 on the terrain rehearsals 5-9 found
$v4t = Join-Path $v31 'route_v4_on_v5_terrain.json'; $rt | ConvertTo-Json -Depth 10 | Set-Content -Path $v4t -Encoding utf8
$r16 = DryRunAt (Join-Path $v31 'v4_trough') 'm4' (@('-Route', $v4t, '-M4Repeats', '1') + $sim)
$ab16 = ($r16.tl | Where-Object event -eq 'ABORT').detail
$r16b = DryRunAt (Join-Path $v31 'v9_m4_once') 'm4' (@('-Route', $v9route, '-M4Repeats', '1') + $sim)
$f16 = @(SlicerFalls $r16b)
$y16 = @($f16 | Where-Object { $_ -match '\| YES \|' })
$ok16 = $r16.code -eq 1 -and -not ($r16.tl | Where-Object event -eq 'ON_KERB') -and -not ($r16.tl | Where-Object event -eq 'FALL') -and
        ($ab16 -like '*MOUNT-DOWN*' -or $ab16 -like '*OFF-PATH*' -or $ab16 -like '*LEFT-THE-PATH*') -and
        $r16b.code -eq 0 -and @($r16b.tl | Where-Object event -eq 'ON_KERB').Count -eq 1 -and $y16.Count -eq 1 -and (InpCalls $r16b) -eq 0
Check "D16 rehearsal 5's trough: route v4 stops at it (no mount, no walk-off); route v9 steps onto the strip and walks off qualifying" $ok16 ("v4: {0} | v5: {1}" -f $ab16, $(if ($y16.Count) { $y16[0].Trim() } else { 'no qualifying fall' }))
$r5 = Get-Content -Raw $v5route | ConvertFrom-Json
$r5.dry_run_terrain = (Get-Content -Raw $v6route | ConvertFrom-Json).dry_run_terrain       # route v5 on the landing area rehearsal 6 found
$v5t = Join-Path $v31 'route_v5_on_v6_terrain.json'; $r5 | ConvertTo-Json -Depth 10 | Set-Content -Path $v5t -Encoding utf8
$r17a = DryRunAt (Join-Path $v31 'v5_return_wall') 'survey' (@('-Route', $v5t, '-SurveyReturn') + $sim)
$ab17a = ($r17a.tl | Where-Object event -eq 'ABORT').detail
$r6n = Get-Content -Raw $v6route | ConvertFrom-Json
$r6n.m4.return = @($r6n.m4.return | ForEach-Object { , @(@($_) | Where-Object { -not ($_ -is [string] -and $_ -eq 'down') }) })                  # no declared descent
$v6n = Join-Path $v31 'route_v6_no_down.json'; $r6n | ConvertTo-Json -Depth 10 | Set-Content -Path $v6n -Encoding utf8
$r17b = DryRunAt (Join-Path $v31 'v6_no_down') 'survey' (@('-Route', $v6n, '-SurveyReturn') + $sim)
$ab17b = ($r17b.tl | Where-Object event -eq 'ABORT').detail
$ok17 = $r17a.code -eq 1 -and $ab17a -like '*PRECISE: could not close to (380;4455)*' -and @($r17a.tl | Where-Object event -eq 'FALL').Count -eq 1 -and
        $r17b.code -eq 1 -and ($ab17b -like '*LEFT-THE-PATH*' -or $ab17b -like '*OFF-PATH*') -and $ab17b -like '*(334;4138)*'
Check "D17 rehearsal 6's return in the model: v5's return cannot leave the landing (the wall east of it, as in the game); v6 without its declared descent stops at the terrace stairs (the guards still hold)" $ok17 ("v5: {0} | v6 no 'down': {1}" -f $ab17a, $ab17b)
$r7t = Get-Content -Raw $v7route | ConvertFrom-Json
$r7t.dry_run_terrain = (Get-Content -Raw $v8route | ConvertFrom-Json).dry_run_terrain       # route v7 on the slab's west side rehearsal 9b found
$v7t = Join-Path $v31 'route_v7_on_v8_terrain.json'; $r7t | ConvertTo-Json -Depth 10 | Set-Content -Path $v7t -Encoding utf8
$r18 = DryRunAt (Join-Path $v31 'v7_stair_side') 'survey' (@('-Route', $v7t, '-SurveyReturn') + $sim)
$ab18 = ($r18.tl | Where-Object event -eq 'ABORT').detail
$tight18 = @($r9.tl | Where-Object { $_.event -eq 'ARRIVED' -and $_.detail -match '^\((255;3475|230;3462|205;3456)\) d=(\d+) precise' -and [int]$Matches[2] -le 12 })
$ok18 = $r18.code -eq 1 -and ($ab18 -like '*NO-PROGRESS*' -or $ab18 -like '*PRECISE: could not close to (284;3490)*') -and $tight18.Count -eq 3
Check "D18 rehearsal 9b's stairs in the model: v7 meets the slab's west side and stops; v9 (D9) climbs the upper flight from the terrace with three tight (<= 12 uu) arrivals" $ok18 ("v7: {0} | v9 tight arrivals: {1}" -f $ab18, (($tight18 | ForEach-Object { $_.detail }) -join ', '))

# D19 v3.1j route v10 (DEV exploration 3): the return south on the terrace, over its bump, west down to the approach's own path
$r19a = DryRunAt (Join-Path $v31 'v10_survey_lag') 'survey' (@('-Route', $v10route, '-SurveyReturn', '-SimLagMs', '250') + $sim)
$t19 = @($r19a.tl | Where-Object { $_.event -eq 'ARRIVED' -and $_.detail -match '^\(240;2935\) d=(\d+) precise' -and [int]$Matches[1] -le 12 })
$ok19a = $r19a.code -eq 0 -and @($r19a.tl | Where-Object event -eq 'ON_KERB').Count -eq 2 -and -not ($r19a.tl | Where-Object event -eq 'ABORT') -and
         $t19.Count -eq 1 -and @($r19a.tl | Where-Object { $_.event -eq 'ARRIVED' -and $_.detail -like '(0;2908)*' }).Count -eq 1 -and (InpCalls $r19a) -eq 0
$r19b = DryRunAt (Join-Path $v31 'v10_all') 'all' (@('-Route', $v10route, '-SimLagMs', '250') + $sim)
$k19 = @($r19b.tl | Where-Object event -eq 'ON_KERB' | ForEach-Object { [double]$_.utc_ms })
$loops19 = @(for ($i = 1; $i -lt $k19.Count; $i++) { [Math]::Round(($k19[$i] - $k19[$i - 1]) / 1000.0, 1) })
$f19 = @(SlicerFalls $r19b | Where-Object { $_ -match '\| YES \|' })
$ok19b = $r19b.code -eq 0 -and @($r19b.tl | Where-Object { $_.event -eq 'BLOCK_BEGIN' -and $_.detail -like 'M4_*' }).Count -eq 10 -and $f19.Count -eq 10 -and
         @($r19b.tl | Where-Object { $_.event -eq 'NOTE' -and $_.detail -like 'return after the last attempt*' }).Count -eq 1 -and -not ($r19b.tl | Where-Object event -eq 'ABORT')
$r19t = Get-Content -Raw $v9route | ConvertFrom-Json
$r19t.dry_run_terrain = (Get-Content -Raw $v10route | ConvertFrom-Json).dry_run_terrain     # route v9 on exploration 2/3's terrain
$v9t10 = Join-Path $v31 'route_v9_on_v10_terrain.json'; $r19t | ConvertTo-Json -Depth 10 | Set-Content -Path $v9t10 -Encoding utf8
$r19c = DryRunAt (Join-Path $v31 'v9_on_v10_terrain') 'survey' (@('-Route', $v9t10, '-SurveyReturn') + $sim)
$ab19c = ($r19c.tl | Where-Object event -eq 'ABORT').detail
$ok19c = $r19c.code -eq 1 -and ($ab19c -like '*PRECISE: could not close to (175;3448)*' -or $ab19c -like '*NO-PROGRESS*') -and @($r19c.tl | Where-Object event -eq 'ON_KERB').Count -eq 1
$r20 = DryRunAt (Join-Path $v31 'v10_stall') 'survey' (@('-Route', $v10route, '-SurveyReturn', '-SimLagMs', '250', '-SimStallY', '3150', '-SimStallMs', '2400') + $sim)
$a20 = @($r20.tl | Where-Object { $_.event -eq 'ARRIVED' -and $_.detail -like '(0;3300) d=* (nearest sample of a burst*' } | Select-Object -First 1)
$ok20 = $r20.code -eq 0 -and @($r20.tl | Where-Object event -eq 'ON_KERB').Count -eq 2 -and $a20.Count -eq 1 -and -not ($r20.tl | Where-Object event -eq 'ABORT') -and (InpCalls $r20) -eq 0
Check "D20 survey 11's 2.4-s log burst in the model: (0,3300) is reached by the burst's nearest sample (P75) and v10 survey + return re-mounts" $ok20 ("exit {0}; {1}" -f $r20.code, (($a20 | ForEach-Object { $_.detail }) -join ''))
# D21 v3.1k (composition 2): the pass rule (P76) as a pure function, on composition 2's own samples for the leg (0,3550) -> (0,3800)
$driveSrc = Get-Content -Raw (Join-Path $b 'b33_drive.ps1')
$fnPass = [regex]::Match($driveSrc, '(?ms)^function Passed-Leg\(.*?^\}').Value
$sb21 = [scriptblock]::Create($fnPass + "`n" + @'
  @(
    (Passed-Leg 66.4 3832.5 0 3550 0 3800 100),    # composition 2: 64-66 uu aside, past the waypoint -> passed
    (Passed-Leg 63.7 3796.4 0 3550 0 3800 100),    # composition 2: not yet past (along 246.4 < 250)
    (Passed-Leg 150 3850 0 3550 0 3800 100),       # too far aside
    (Passed-Leg 0 3700 0 3550 0 3800 100),         # on the line, short of the waypoint
    (Passed-Leg 66.4 3832.5 0 3550 0 3800 0)       # -PassLatUu 0: the rule is off
  )
'@)
$res21 = @(& $sb21)
$ok21 = $fnPass -ne '' -and $res21.Count -eq 5 -and $res21[0] -eq $true -and $res21[1] -eq $false -and $res21[2] -eq $false -and $res21[3] -eq $false -and $res21[4] -eq $false -and
        $driveSrc -match 'if \(-not \$precise -and -not \[double\]::IsNaN\(\$lfx\) -and \(Passed-Leg '
$fnKerb = [regex]::Match($driveSrc, '(?ms)^function On-Kerb \{.*?^\}').Value
$sb22 = [scriptblock]::Create($fnKerb + "`n" + @'
  $R = @{ m4 = @{ mount = @{ kerb_z = @(106.0, 121.0); box_x = @(140.0, 186.0); box_y = @(4445.0, 4505.0) } } }
  function Smp($m, $x, $y, $z, $pos) { [pscustomobject]@{ Motion = $m; X = $x; Y = $y; Z = $z; HasPos = $pos } }
  function Samples { return , $script:L22 }
  $on = Smp 'IDLE' 153.3 4451.4 113.0 $true
  $script:L22 = [System.Collections.Generic.List[object]]@((Smp 'WALK' 151.6 4447.7 113.0 $true), $on, $on, $on, (Smp 'IDLE' 0 0 113.0 $false)); $a = On-Kerb
  $script:L22 = [System.Collections.Generic.List[object]]@((Smp 'WALK' 151.6 4447.7 113.0 $true), $on, $on, (Smp 'IDLE' 0 0 113.0 $false)); $b2 = On-Kerb
  $script:L22 = [System.Collections.Generic.List[object]]@($on, (Smp 'IDLE' 0 0 113.0 $false), $on, $on); $c = On-Kerb
  $script:L22 = [System.Collections.Generic.List[object]]@($on, $on, (Smp 'IDLE' 109.6 4477.8 52.6 $true)); $d4 = On-Kerb
  $script:L22 = [System.Collections.Generic.List[object]]@($on, $on, $on); $e = On-Kerb
  @($a, $b2, $c, $d4, $e)
'@)
$res22 = @(& $sb22)
$ok22 = $fnKerb -ne '' -and $res22.Count -eq 5 -and $res22[0] -eq $true -and $res22[1] -eq $false -and $res22[2] -eq $false -and $res22[3] -eq $false -and $res22[4] -eq $true
Check "D22 composition 3's MOUNT-FAILED on the kerb: the newest report with only its motion line yet is skipped (P77); a WALK among the newest three, an older report without a position, or a low z still fail" $ok22 ("results: " + ($res22 -join ','))
# D23 v3.1k: route v11 (P79) = v10 with ONE change (the z hint of (0,2908): 26.8 -> 20.0); its survey + return re-mounts in the model;
#      P80: an aborted drive writes STOP_REQUEST for the conductor (never in a dry run)
$j10 = Get-Content -Raw $v10route | ConvertFrom-Json; $j11 = Get-Content -Raw $v11route | ConvertFrom-Json
$i11 = @(0..($j11.m4.return.Count - 1) | Where-Object { [double]$j11.m4.return[$_][0] -eq 0 -and [double]$j11.m4.return[$_][1] -eq 2908 })
$diff23 = @(0..($j11.m4.return.Count - 1) | Where-Object { (ConvertTo-Json -Compress @($j11.m4.return[$_])) -ne (ConvertTo-Json -Compress @($j10.m4.return[$_])) })
$same23 = (ConvertTo-Json -Compress -Depth 10 $j11.m4.approach) -eq (ConvertTo-Json -Compress -Depth 10 $j10.m4.approach) -and
          (ConvertTo-Json -Compress -Depth 10 $j11.m4.mount) -eq (ConvertTo-Json -Compress -Depth 10 $j10.m4.mount) -and
          (ConvertTo-Json -Compress -Depth 10 $j11.dry_run_terrain) -eq (ConvertTo-Json -Compress -Depth 10 $j10.dry_run_terrain) -and
          $j11.m4.return.Count -eq $j10.m4.return.Count -and $j11.m4.rejoin_index -eq $j10.m4.rejoin_index
$r23 = DryRunAt (Join-Path $v31 'v11_survey_lag') 'survey' (@('-Route', $v11route, '-SurveyReturn', '-SimLagMs', '250') + $sim)
$r23b = DryRunAt (Join-Path $v31 'abort_dry') 'calibrate' @('-SimCpd', '-4.6')
$fin23 = [regex]::Match($driveSrc, '(?s)\} finally \{.*?\r?\n\}\r?\nif \(\$script:aborted\) \{ exit 1 \}').Value
$ok23 = $i11.Count -eq 1 -and [double]$j11.m4.return[$i11[0]][2] -eq 20.0 -and $diff23.Count -eq 1 -and $diff23[0] -eq $i11[0] -and $same23 -and
        $r23.code -eq 0 -and @($r23.tl | Where-Object event -eq 'ON_KERB').Count -eq 2 -and -not ($r23.tl | Where-Object event -eq 'ABORT') -and
        $r23b.code -eq 1 -and -not (Test-Path (Join-Path $r23b.dir 'STOP_REQUEST')) -and -not (Test-Path (Join-Path (Join-Path $v31 'abort_dry') 'STOP_REQUEST')) -and
        $fin23 -match 'if \(\$script:aborted -and -not \$S\.dry -and -not \$NoAutoStop\)' -and $fin23 -match "Join-Path \`$Run 'STOP_REQUEST'"
Check "D23 route v11 = v10 + the one z hint (20.0 at (0,2908)) and its survey + return re-mounts; P80: an aborted live drive writes STOP_REQUEST (a dry run never does)" $ok23 ("v11 changed return index {0}; survey exit {1}; dry abort exit {2}; finally block {3} chars" -f ($diff23 -join ','), $r23.code, $r23b.code, $fin23.Length)
# D24 v3.1k P78 (ruling Q-B33-1 condition 4): after EVERY BLOCK_END no drive input and no BLOCK_BEGIN until END + 1.601 s, then 2 fresh
#      IDLE reports (a BLOCK_GAP row); the checker FAILs a 0.1 s gap (a fixture) and finds the old drive's gaps in composition 5's timeline.
#      P81: the -Mode all run on v11 also crosses the bump's corner stop into the declared descent 10 times.
function GapViolations($rows) {
  $rows = @($rows | Sort-Object { [long]$_.utc_ms }, { [int]$_.seq })
  $bad = @()
  foreach ($e in @($rows | Where-Object event -eq 'BLOCK_END')) {
    $t = [long]$e.utc_ms
    $hit = @($rows | Where-Object { $_.event -in @('KEY_DOWN', 'KEY_UP', 'MOUSE', 'CLICK', 'BLOCK_BEGIN') -and [long]$_.utc_ms -gt $t -and [long]$_.utc_ms -le $t + 1601 })
    if ($hit.Count) { $bad += ("{0} END + {1} ms: {2} {3}" -f $e.detail, ([long]$hit[0].utc_ms - $t), $hit[0].event, $hit[0].detail) }
  }
  return , $bad
}
$r24 = DryRunAt (Join-Path $v31 'v11_all_p78') 'all' (@('-Route', $v11route, '-SimLagMs', '250') + $sim)
$ends24 = @($r24.tl | Where-Object event -eq 'BLOCK_END'); $gaps24 = @($r24.tl | Where-Object { $_.event -eq 'BLOCK_GAP' -and $_.detail -match 'then (\d+) fresh IDLE' -and [int]$Matches[1] -ge 2 })
$v24 = GapViolations $r24.tl
$fx24 = @($r24.tl) + [pscustomobject]@{ utc_ms = ([long]$ends24[0].utc_ms + 100); seq = 0; event = 'KEY_DOWN'; detail = 'W (fixture: a 0.1 s gap)' }
$vfx24 = GapViolations $fx24
$c5tl = Get-ChildItem -Path (Join-Path $b '..\..\dev_notes\REHEARSAL_NOT_PREREG_b33_runs\DIAGNOSTIC_NOTPREREG_b33_all_20261021T092237Z') -Filter timeline.csv -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$vc5 = $(if ($c5tl) { GapViolations (Import-Csv $c5tl.FullName) } else { , @() })
$ok24 = $r24.code -eq 0 -and $ends24.Count -eq 13 -and $gaps24.Count -eq 13 -and $v24.Count -eq 0 -and $vfx24.Count -eq 1 -and $vfx24[0] -like 'STAND END + 100 ms*' -and
        @($r24.tl | Where-Object { $_.event -eq 'BLOCK_BEGIN' -and $_.detail -like 'M4_*' }).Count -eq 10 -and -not ($r24.tl | Where-Object event -eq 'ABORT') -and
        ($null -eq $c5tl -or $vc5.Count -ge 12) -and $driveSrc -match 'if \(\$down -and -not \[double\]::IsNaN\(\$zhint\)\) \{ \$S\.legDownFloor = \$zhint - \$FloorTolUu \}'
Check "D24 P78: every block end is followed by >= 1.601 s without input or BLOCK_BEGIN and 2 fresh IDLE reports (13 of 13); a 0.1 s gap FAILs the checker; composition 5's timeline (old drive) shows the overlap; P81 lets the descent's corner stop pass" $ok24 ("ends {0}, gaps {1}, violations {2}; fixture: {3}; composition 5: {4} violation(s), first {5}" -f $ends24.Count, $gaps24.Count, $v24.Count, ($vfx24 -join ''), $vc5.Count, $(if ($vc5.Count) { $vc5[0] } else { '-' }))
Check "D21 composition 2's miss: a pass-through waypoint passed within -PassLatUu (100) of its leg line is reached (P76); short of it, too far aside, or with the rule off it is not; precise legs never use it" $ok21 ("results: " + ($res21 -join ','))
Check "D19 route v10 in the model: survey + return re-mounts (tight corner (240;2935)); -Mode all sustains 10 attempts with returns; v9 on v10's terrain stops at the upper flight" ($ok19a -and $ok19b -and $ok19c) ("survey: exit {0}, corner {1} | all: exit {2}, M4 falls YES {3}, model loop s {4} | v9: {5}" -f $r19a.code, (($t19 | ForEach-Object { $_.detail }) -join ''), $r19b.code, $f19.Count, ($loops19 -join ','), $ab19c)

# D25 v3.1 THE ROUTE PIN: a live -Mode m4 / all is refused unless ROUTE_PIN.json is PINNED and -Route hashes to it (-RoutePinCheckOnly:
#     the check alone, no folder, no input); the SHIPPED slot (PENDING) refuses; -Mode survey / jumps need no pin; a test pin of v10 accepts
#     v10 and refuses v11
function RoutePinCheck([string]$mode, [string]$route, [string]$pinFile) {
  $a = @('-Run', (Join-Path $out 'routepin'), '-Mode', $mode, '-RoutePinCheckOnly'); if ($route) { $a += @('-Route', $route) }; if ($pinFile) { $a += @('-RoutePinFile', $pinFile) }
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_drive.ps1') @a 2>&1 | Out-String
  return [pscustomobject]@{ code = $LASTEXITCODE; out = $o.Trim() }
}
$v10sha = (Get-FileHash $v10route -Algorithm SHA256).Hash.ToLower()
$pin25 = Join-Path $out 'routepin_v10.json'; [ordered]@{ status = 'PINNED'; route_sha256 = $v10sha } | ConvertTo-Json | Set-Content -Path $pin25 -Encoding utf8
$p25a = RoutePinCheck 'all' $v10route ''
$p25b = RoutePinCheck 'm4' $v10route ''
$p25c = RoutePinCheck 'survey' $v11route ''
$p25d = RoutePinCheck 'jumps' '' ''
$p25e = RoutePinCheck 'all' $v10route $pin25
$p25f = RoutePinCheck 'all' $v11route $pin25
$ok25 = $p25a.code -eq 2 -and $p25a.out -like '*not PINNED*' -and $p25b.code -eq 2 -and $p25c.code -eq 0 -and $p25d.code -eq 0 -and
        $p25e.code -eq 0 -and $p25e.out -like "*OK: the pinned route $v10sha*" -and $p25f.code -eq 2 -and $p25f.out -like '*is not the pinned route*' -and
        -not (Test-Path (Join-Path $out 'routepin'))
Check 'D25 v3.1 route pin: the shipped PENDING slot refuses -Mode all / m4; survey and jumps need none; a v10 test pin accepts v10 and refuses v11; nothing made' $ok25 ("{0} | {1} | {2} | {3}" -f $p25a.out, $p25c.out, $p25e.out, $p25f.out)

# L1-L4 layout helpers (pure; no window is touched)
. (Join-Path $b 'b33_layout.ps1')
$t = Get-LayoutTargets 960 1080 0 0 960
$a = New-Rect 0 0 960 1080
Check 'L1 2 px tolerance' ((Test-RectNear (New-Rect 2 0 962 1078) $a 2) -and -not (Test-RectNear (New-Rect 3 0 963 1080) $a 2))
Check 'L2 touching frames do not overlap; 1 px does' (-not (Test-RectOverlap $t.sender $t.observer) -and (Test-RectOverlap (New-Rect 0 0 961 1080) $t.observer))
$okWhy = Test-Layout $t (New-Rect 0 0 960 1080) (New-Rect 960 0 1920 1080) (New-Rect 10 41 950 1072) (New-Rect 970 41 1910 1072) 2
$big = Test-Layout $t (New-Rect 0 0 1616 1039) (New-Rect 960 0 2576 1039) (New-Rect 8 31 1608 1031) (New-Rect 968 31 2568 1031) 2   # the clients' own 1600x1000
$off = Test-Layout $t (New-Rect 3 0 963 1080) (New-Rect 960 0 1920 1080) (New-Rect 13 41 953 1072) (New-Rect 970 41 1910 1072) 2
Check 'L3 layout check: the verified 960x1080 split passes; the unplaced 1600x1000 windows and a 3 px offset are refused' ($okWhy.Count -eq 0 -and $big.Count -ge 2 -and (($big -join ' ') -like '*overlap*') -and $off.Count -ge 1 -and (($off -join ' ') -like '*not within 2 px*')) ("ok=[{0}] big=[{1}] off=[{2}]" -f ($okWhy -join ';'), ($big -join ';'), ($off -join ';'))
$q = Get-ClientPoint (New-Rect 10 41 950 1072) 50 72
Check 'L4 click point from the re-read client rect' ($q.x -eq 480 -and $q.y -eq 783) ("({0};{1})" -f $q.x, $q.y)
# L7-L9 R8-04 cursor clip (no input; never ClipCursor)
$clipB35 = New-Rect 970 39 1910 1070
$l7 = @(((Get-ClipAction $clipB35 $q.x $q.y) -eq 'release'), ((Get-ClipAction $clipB35 1400 500) -eq 'none'), ((Get-ClipAction $clipB35 970 39) -eq 'none'),
        ((Get-ClipAction $clipB35 1909 1069) -eq 'none'), ((Get-ClipAction $clipB35 1910 500) -eq 'release'), ((Get-ClipAction $clipB35 1400 1070) -eq 'release'),
        ((Get-ClipAction (New-Rect 0 0 1920 1200) $q.x $q.y) -eq 'none'), ((Get-ClipAction $null 5 5) -eq 'release'))
Check 'L7 clip decision: the B35 clip vs the sender click point -> release; inside -> none; edges exclusive; whole desktop -> none' (@($l7 | Where-Object { -not $_ }).Count -eq 0) ($l7 -join ',')
Add-Type -Path (Join-Path $b 'b33_native.cs')
$cr = ConvertTo-Rect ([B33.Win]::ClipRect()); $vd = ConvertTo-Rect ([B33.Win]::VirtualDesktop()); $cp = [B33.Win]::CursorXY()
Check 'L8 native ClipRect / VirtualDesktop / CursorXY read sane values (read only)' (($cr.right -gt $cr.left) -and ($cr.bottom -gt $cr.top) -and ($vd.right -gt $vd.left) -and ($vd.bottom -gt $vd.top) -and (Test-PointInRect $cr $cp.X $cp.Y)) ("clip {0}; desktop {1}; cursor {2};{3}" -f (Format-Rect $cr), (Format-Rect $vd), $cp.X, $cp.Y)
$dsrc = Get-Content -Raw (Join-Path $b 'b33_drive.ps1')
$iRel = $dsrc.IndexOf('Release-ClipFor $sx $sy'); $iMove = $dsrc.IndexOf('[B33.Win]::MoveCursor($sx, $sy)'); $iAt = $dsrc.IndexOf('$at = [B33.Win]::CursorXY()')
$iClick = $dsrc.IndexOf('[void][B33.Inp]::Click()'); $iFg = $dsrc.IndexOf('after the click the sender does not own the foreground')
$fnRel = [regex]::Match($dsrc, '(?s)function Release-ClipFor.*?\r?\n}\r?\n').Value
$l9 = ($iRel -gt 0) -and ($iRel -lt $iMove) -and ($iMove -lt $iAt) -and ($iAt -lt $iClick) -and ($iClick -lt $iFg) -and ($fnRel -match 'if \(\$S\.dry\) \{ return \}') -and
      ($fnRel -match 'ReleaseClip\(\)') -and ($fnRel -match 'if \(-not \(Test-PointInRect \$clipNow \$x \$y\)\) \{ Fail') -and ($fnRel -match "Row 'NOTE' \(""cursor clip released: was")
Check 'L9 click path: release clip -> absolute jump -> arrival check -> click -> foreground check (verified, NOTEd, dry-run safe)' $l9 ("{0} < {1} < {2} < {3} < {4}" -f $iRel, $iMove, $iAt, $iClick, $iFg)
$calls0 = [B33.Inp]::Calls
$g1 = [B33.Inp]::RelPaced(100, 8, 16.7, [B33.Guard]::Others + 1, [uint32[]]@([uint32]$PID))
$g2 = [B33.Inp]::RelPaced(100, 8, 16.7, [B33.Guard]::Others, [uint32[]]@([uint32]999999))
Check 'L10 paced mouse: stops before the first chunk on other input or a foreign foreground (nothing sent)' ($g1 -eq 0 -and $g2 -eq 0 -and [B33.Inp]::Calls -eq $calls0) ("returned {0} / {1}; SendInput calls {2} -> {3}" -f $g1, $g2, $calls0, [B33.Inp]::Calls)
# L5/L6 the REAL-mode drive refuses before any input when the layout is not verified (it never installs hooks or sends anything)
function RealRefusal([string]$name, $layout, [int]$gamePid) {
  $fx = Join-Path $PSScriptRoot ("stop_fixture\layout_{0}_{1}" -f $name, (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ'))
  New-Item -ItemType Directory -Force $fx | Out-Null
  [ordered]@{ run_id = $name; role = 'JUDGED'; layout = $layout; sender = [ordered]@{ pids = @($gamePid); game_pid = $gamePid; log = (Join-Path $fx 'none.log') }; observer = [ordered]@{ pids = @(999998); game_pid = 999998 } } |
    ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $fx 'RUN.json') -Encoding utf8
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_drive.ps1') -Run $fx -Mode jumps 2>&1
  $code = $LASTEXITCODE
  $d = Get-ChildItem $fx -Directory | Where-Object Name -like 'drive_*' | Select-Object -First 1
  $tl = Import-Csv (Join-Path $d.FullName 'timeline.csv')
  $inputs = @($tl | Where-Object { $_.event -in 'KEY_DOWN', 'KEY_UP', 'MOUSE', 'CLICK', 'HOOK_OK' }).Count
  return [pscustomobject]@{ code = $code; inputs = $inputs; abort = (($tl | Where-Object event -eq 'ABORT').detail) }
}
$r5 = RealRefusal 'notok' ([ordered]@{ ok = $false; tolerance_px = 2 }) 999999
Check 'L5 drive refuses without layout.ok (no hooks, no input)' ($r5.code -eq 1 -and $r5.inputs -eq 0 -and $r5.abort -like '*layout*') $r5.abort
$r6 = RealRefusal 'nowindow' ([ordered]@{ ok = $true; tolerance_px = 2 }) 999999
Check 'L6 drive refuses when the sender GAME window is not there (no hooks, no input)' ($r6.code -eq 1 -and $r6.inputs -eq 0 -and $r6.abort -like '*has no window*') $r6.abort

# C1-C3 the launcher's server inputs, -DryChecks only: no lease, no build, no server, no client (a fake package of two small files)
$lf = Join-Path $PSScriptRoot 'launch_fixture'
if (Test-Path $lf) { Remove-Item -Recurse -Force $lf }
$pkg = Join-Path $lf 'pkg'; New-Item -ItemType Directory -Force (Join-Path $pkg 'Wonderland\Binaries\Win64'), (Join-Path $lf 'runs'), (Join-Path $lf 'badnm') | Out-Null
Set-Content (Join-Path $pkg 'Wonderland.exe') 'fake boot stub (test fixture)' -Encoding ascii
Set-Content (Join-Path $pkg 'Wonderland\Binaries\Win64\Wonderland.exe') 'fake game exe (test fixture)' -Encoding ascii
Set-Content (Join-Path $lf 'badnm\package-lock.json') '{}' -Encoding ascii
$fakeSha = (Get-FileHash (Join-Path $pkg 'Wonderland\Binaries\Win64\Wonderland.exe') -Algorithm SHA256).Hash.ToLower()
$fakeBoot = (Get-FileHash (Join-Path $pkg 'Wonderland.exe') -Algorithm SHA256).Hash.ToLower()
function CandFile([string]$name, [hashtable]$over) {
  # a TEST candidate file (the launcher accepts a non-default -CandidateFile only with -DryChecks); defaults = READY and matching the fake package
  $c = [ordered]@{ status = 'READY'; label = 'test-fixture'; commit = 'testfixture'; game_exe_sha256 = $fakeSha; boot_exe_sha256 = $fakeBoot; package_folder = $pkg }
  if ($over) { foreach ($k in @($over.Keys)) { $c[$k] = $over[$k] } }
  $p = Join-Path $lf ("cand_{0}.json" -f $name)
  $c | ConvertTo-Json | Set-Content -Path $p -Encoding utf8
  return $p
}
$readyCand = CandFile 'ready' @{}
function PinFile([string]$name, [hashtable]$over) {
  # v3.1: a TEST relay pin (accepted only with -DryChecks); default = PINNED cbe584be with its tree (a real commit of sunday-relay)
  $c = [ordered]@{ status = 'PINNED'; label = 'test-fixture'; commit = 'cbe584becf417c48cc4de8efe8a2fa16f404c0bf'; tree = '490a543282a3703ce6878e0586dbe9a2a524d107' }
  if ($over) { foreach ($k in @($over.Keys)) { $c[$k] = $over[$k] } }
  $p = Join-Path $lf ("relaypin_{0}.json" -f $name)
  $c | ConvertTo-Json | Set-Content -Path $p -Encoding utf8
  return $p
}
$readyPin = PinFile 'pinned' @{}
function DryLaunch([string[]]$extra, [string]$cand = $readyCand, [switch]$NoDryChecks, [string]$pin = $readyPin) {
  # $cand '' = the SHIPPED tools\b33\CANDIDATE.json (no -CandidateFile); -NoDryChecks only for refusals that must come before anything is made
  $roots = @((Join-Path $lf 'runs'), (Join-Path $lf 'NOT_COUNTED_b33'))     # v3.1a: the counted folder and the not-counted folder beside it
  $before = @($roots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Directory } | ForEach-Object { $_.FullName })
  $candArgs = @(); if ($cand) { $candArgs = @('-CandidateFile', $cand) }
  if ($pin) { $candArgs += @('-RelayPinFile', $pin) }      # v3.1: '' = the SHIPPED RELAY_PIN.json
  $dry = @('-DryChecks'); if ($NoDryChecks) { $dry = @() }
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_launch.ps1') -Package $pkg -Commit 'testfixture' -RunsRoot (Join-Path $lf 'runs') @dry @candArgs @extra 2>&1 | Out-String
  $code = $LASTEXITCODE
  $d = @($roots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Directory } | Where-Object { $before -notcontains $_.FullName })
  $dc = $null; $log = ''; $dir = $null
  if ($d.Count -gt 0) {
    $dir = $d[0].FullName
    $dcf = Join-Path $dir 'DRYCHECKS.json'; if (Test-Path $dcf) { $dc = Get-Content -Raw $dcf | ConvertFrom-Json }
    $lg = Join-Path $dir 'LAUNCH_LOG.txt'; if (Test-Path $lg) { $log = Get-Content -Raw $lg }
  }
  return [pscustomobject]@{ code = $code; dc = $dc; log = $log; out = $o; newDirs = $d.Count; dir = $dir }
}
$want = @(& git -c safe.directory=* -C 'C:\dev\iwonder\sunday-relay' ls-tree -r cbe584be -- relay-bridge src package.json).Count
$c1 = DryLaunch @()
Check 'C1 cbe584be server inputs accepted: full commit, lockfile identical, archive list counted' ($c1.code -eq 0 -and $c1.dc.prereg_server -eq $true -and $c1.dc.server.commit -eq 'cbe584becf417c48cc4de8efe8a2fa16f404c0bf' -and $c1.dc.server.package_lock_identical -eq $true -and $c1.dc.server.archive_files -eq $want -and $c1.dc.server.archive_file_list_sha256.Length -eq 64 -and $c1.dc.candidate.label -eq 'test-fixture' -and $c1.dc.candidate.default -eq $false) ("files {0}/{1} list {2}" -f $c1.dc.server.archive_files, $want, $c1.dc.server.archive_file_list_sha256)
$lsrc = Get-Content -Raw (Join-Path $b 'b33_launch.ps1')
Check 'N1 (v3.1) the counted launcher names its run folders DIAGNOSTIC_b33_<scenario>_<utc> (the copy-only NOTPREREG naming of ruling 8805ec is not promoted)' ($c1.dir -and (Split-Path $c1.dir -Leaf) -like 'DIAGNOSTIC_b33_*' -and (Split-Path $c1.dir -Leaf) -notlike '*NOTPREREG*') $(if ($c1.dir) { Split-Path $c1.dir -Leaf } else { 'no run folder' })
# C11 v3.1 THE RELAY PIN: the SHIPPED RELAY_PIN.json (PENDING) refuses before anything is made (-DryChecks too); a test pin file without
#     -DryChecks, an explicit -RelayCommit without -RelaySource, and a PINNED pin whose commit is not its tree are refused; the pinned
#     test pin is recorded in DRYCHECKS.json server.relay_pin
$c11a = DryLaunch @() -pin ''
$c11b = Get-Content -Raw (Join-Path $b 'b33_launch.ps1')      # a test pin without -DryChecks: the candidate refusal comes first, so checked statically
$c11c = DryLaunch @('-RelayCommit', 'cbe584be')
$c11d = DryLaunch @() -pin (PinFile 'wrongtree' @{ tree = ('0' * 40) })
$ok11 = $c11a.code -eq 2 -and $c11a.out -like '*RELAY_PIN.json*is not PINNED*' -and $c11a.newDirs -eq 0 -and
        $c11b -match 'another relay pin file is for -DryChecks tests only' -and
        $c11c.code -eq 2 -and $c11c.out -like '*-RelayCommit without -RelaySource*' -and $c11c.newDirs -eq 0 -and
        $c11d.code -eq 2 -and $c11d.out -like '*resolves to*not commit*' -and $c11d.newDirs -eq 0 -and
        $c1.dc.server.relay_pin.status -eq 'PINNED' -and $c1.dc.server.relay_pin.tree -eq '490a543282a3703ce6878e0586dbe9a2a524d107' -and $c1.dc.server.relay_pin.default -eq $false
Check 'C11 v3.1 relay pin: the shipped PENDING pin refuses before anything is made; test pin only with -DryChecks; no bare -RelayCommit; a pin whose commit is not its tree refused; the pin recorded' $ok11 ("{0} | {1} | {2} | {3}" -f $c11a.out.Trim(), 'static', $c11c.out.Trim(), $c11d.out.Trim())
Check 'N2 (v3.1e) the conductor writes the stop report to STOP_LOG.txt, never into LAUNCH_LOG.txt after the close sums' ($lsrc -notmatch 'Say "stop: ' -and $lsrc -match "STOP_LOG.txt") 'static check of b33_launch.ps1'
$c2 = DryLaunch @('-NodeModulesFrom', (Join-Path $lf 'badnm'))
Check 'C2 a node_modules tree whose package-lock.json differs is refused' ($c2.code -eq 2 -and $c2.log -like '*not byte-identical*' -and $null -eq $c2.dc)
$c3 = DryLaunch @('-ServerTree', 'C:\dev\iwonder\wonderland-integration-sprint')
Check 'C3 -ServerTree is an override that marks the run NOT-PREREG (v3.1a: written outside the counted folder as REHEARSAL_NOT_PREREG_b33_*, role REHEARSAL_NOT_PREREG)' ($c3.code -eq 0 -and $c3.dc.prereg_server -eq $false -and $c3.log -like '*NOT-PREREG*' -and (Split-Path $c3.dir -Leaf) -like 'REHEARSAL_NOT_PREREG_b33_*' -and (Split-Path (Split-Path $c3.dir -Parent) -Leaf) -eq 'NOT_COUNTED_b33' -and $c3.dc.role -eq 'REHEARSAL_NOT_PREREG' -and $c3.dc.counted -eq $false)
# C10 v3.1k P83: -RelaySource <worktree> -RelayCommit <sha> (the transport ring prototype f157b821 in its dev worktree): accepted under
#     -DryChecks, NOT-PREREG, the commit / tree / worktree HEAD / branch / clean status recorded (DRYCHECKS.json, RELAY_SOURCE.json,
#     relay_worktree_status.txt); refused without an explicit -RelayCommit, with -ServerTree, or for a folder that is not a git worktree;
#     the default (C1) is unchanged
$ringWt = 'C:\dev\iwonder\_wdev_r18_ring_relay'
if (Test-Path (Join-Path $ringWt '.git')) {
  $c10a = DryLaunch @('-RelaySource', $ringWt, '-RelayCommit', 'f157b821')
  $rs10 = $null; if ($c10a.dir -and (Test-Path (Join-Path $c10a.dir 'RELAY_SOURCE.json'))) { $rs10 = Get-Content -Raw (Join-Path $c10a.dir 'RELAY_SOURCE.json') | ConvertFrom-Json }
  $c10b = DryLaunch @('-RelaySource', $ringWt)
  $c10c = DryLaunch @('-RelaySource', $ringWt, '-RelayCommit', 'f157b821', '-ServerTree', 'C:\dev\iwonder\wonderland-integration-sprint')
  $c10d = DryLaunch @('-RelaySource', $lf, '-RelayCommit', 'f157b821')
  $f157 = 'f157b8216ae03db7feed849a2c91f1a5610e99ed'
  $ok10 = $c10a.code -eq 0 -and $c10a.dc.prereg_server -eq $false -and $c10a.dc.server.prereg -eq $false -and $c10a.dc.server.commit -eq $f157 -and
          $c10a.dc.server.ring.commit -eq $f157 -and (Split-Path $c10a.dir -Leaf) -like 'REHEARSAL_NOT_PREREG_b33_*' -and $c10a.dc.role -eq 'REHEARSAL_NOT_PREREG' -and [string]$c10a.dc.server.ring.worktree_branch -and $null -ne $c10a.dc.server.ring.worktree_clean -and
          $null -ne $c10a.dc.server.ring.head_is_relay_commit -and $c10a.dc.server.archive_files -gt 0 -and $c10a.log -like '*RING RELAY*NOT-PREREG*' -and
          $rs10 -and $rs10.commit -eq $f157 -and $rs10.tree -eq $c10a.dc.server.tree -and (Test-Path (Join-Path $c10a.dir 'relay_worktree_status.txt')) -and
          $c10b.code -eq 2 -and $c10b.log -like '*needs an explicit -RelayCommit*' -and $c10c.code -eq 2 -and $c10c.log -like '*exclude each other*' -and
          $c10d.code -eq 2 -and $c10d.log -like '*not a git worktree*' -and $c1.dc.prereg_server -eq $true -and $c1.dc.server.prereg -eq $true
  Check 'C10 P83 -RelaySource / -RelayCommit: the ring worktree at a recorded commit (NOT-PREREG; commit, tree, HEAD, branch, clean status recorded); refusals; default unchanged' $ok10 ("commit {0} tree {1} head {2} ({3}) head=commit {4} clean {5}; archive files {6}; refusals {7}/{8}/{9}" -f $c10a.dc.server.commit, $c10a.dc.server.tree, $c10a.dc.server.ring.worktree_head, $c10a.dc.server.ring.worktree_branch, $c10a.dc.server.ring.head_is_relay_commit, $c10a.dc.server.ring.worktree_clean, $c10a.dc.server.archive_files, $c10b.code, $c10c.code, $c10d.code)
} else { Write-Output "SKIP C10 (no ring worktree at $ringWt)" }
# C12 v3.1a (7a7faf P2-2, P2-4): a -Scenario survey run is written OUTSIDE the counted folder as SURVEY_b33_<utc> (role SURVEY, not counted);
#     a counted jumps run stays DIAGNOSTIC_b33_* in the counted folder (role JUDGED); -LeaseGb below 5.0, a -NotCountedRoot inside -RunsRoot
#     and -Control with a survey are refused before anything is made; the in-run RAM guard trips only below its value (a STOP, never a verdict)
$c12a = DryLaunch @('-Scenario', 'survey')
$c12b = DryLaunch @('-LeaseGb', '4')
$c12c = DryLaunch @('-NotCountedRoot', (Join-Path (Join-Path $lf 'runs') 'inside'))
$c12d = DryLaunch @('-Scenario', 'survey', '-Control')
$lsrc12 = Get-Content -Raw (Join-Path $b 'b33_launch.ps1')
$fnGuard = [regex]::Match($lsrc12, '(?ms)^function RamGuardTrips\(.*?^\}').Value
$sbG = [scriptblock]::Create($fnGuard + "`n" + '@((RamGuardTrips 1.0 1.1), (RamGuardTrips 1.1 1.1), (RamGuardTrips 2.0 1.1), (RamGuardTrips 0.5 0))')
$g12 = @(& $sbG)
$ok12 = $c12a.code -eq 0 -and (Split-Path $c12a.dir -Leaf) -like 'SURVEY_b33_*' -and (Split-Path (Split-Path $c12a.dir -Parent) -Leaf) -eq 'NOT_COUNTED_b33' -and
        $c12a.dc.role -eq 'SURVEY' -and $c12a.dc.counted -eq $false -and $c1.dc.role -eq 'JUDGED' -and $c1.dc.counted -eq $true -and
        (Split-Path (Split-Path $c1.dir -Parent) -Leaf) -eq 'runs' -and $c1.dc.lease_gb -eq 5 -and $c1.dc.in_run_guard_gb -eq 1.1 -and
        $c12b.code -eq 2 -and $c12b.out -like '*below the enforced gate 5.0 GB*' -and $c12b.newDirs -eq 0 -and
        $c12c.code -eq 2 -and $c12c.out -like '*must be OUTSIDE the counted-runs folder*' -and $c12c.newDirs -eq 0 -and
        $c12d.code -eq 2 -and $c12d.out -like '*-Control runs are counted CONTROL runs*' -and $c12d.newDirs -eq 0 -and
        $g12.Count -eq 4 -and $g12[0] -eq $true -and $g12[1] -eq $false -and $g12[2] -eq $false -and $g12[3] -eq $false -and
        $lsrc12 -match "RAM_GUARD_TRIP\.txt" -and $lsrc12 -match "'RAM_LOG\.json'" -and $lsrc12 -match 'never a verdict'
Check 'C12 v3.1a: survey runs outside the counted folder (SURVEY_b33_*, role SURVEY); counted runs inside (JUDGED); lease below 5.0, a not-counted root inside the counted folder, -Control with a survey refused; the in-run RAM guard (1.1 GB) a stop, never a verdict' $ok12 ("survey {0}; guard {1}; {2} | {3} | {4}" -f $(if ($c12a.dir) { Split-Path $c12a.dir -Leaf } else { 'none' }), ($g12 -join ','), $c12b.out.Trim(), $c12c.out.Trim(), $c12d.out.Trim())
$c4 = DryLaunch @() (CandFile 'other_game' @{ game_exe_sha256 = ('ee' * 32) })
Check 'C4 R4-13: a package whose game exe is not the candidate is refused before anything is made' ($c4.code -eq 2 -and $c4.out -like "*the game exe sha256 $fakeSha is not the candidate's*" -and $c4.newDirs -eq 0) $c4.out.Trim()
$launchSrc = Get-Content -Raw (Join-Path $b 'b33_launch.ps1')
Check 'C5 B-5: the launcher passes no -wlframes and records the exact switch list' (($launchSrc -notmatch '(?m)^[^#]*-wldev\$flush -wlframes') -and ($launchSrc -match "launch_switches = @\('-userdir', '-windowed', '-ResX', '-ResY', '-WinX', '-WinY', '-wldev', '-ExecCmds'\)"))
# C6 the PENDING marker refuses (a fixture that matches the package in every other field), and the shipped file while it is not READY
$c6 = DryLaunch @() (CandFile 'pending' @{ status = 'PENDING z' })
$shipped = Get-Content -Raw -Encoding UTF8 (Join-Path $b 'CANDIDATE.json') | ConvertFrom-Json
$c6s = DryLaunch @() ''
# R7-10: never vacuous: a READY shipped file is read and enforced (the fake package's -Commit testfixture is not its commit)
$c6sOk = $(if ($shipped.status -ne 'READY') { $c6s.code -eq 2 -and $c6s.out -like "*status is '$($shipped.status)', not READY*" -and $c6s.newDirs -eq 0 }
           else { $c6s.code -eq 2 -and $c6s.out -like '*-Commit testfixture is not*' -and $c6s.newDirs -eq 0 })
$broken = Join-Path $lf 'cand_broken.json'
Set-Content -Path $broken -Value '{"status": "READY", "what": "an unescaped "quote" breaks it"}' -Encoding ascii
$c6b = DryLaunch @() $broken
Check 'C6 a PENDING marker refuses before anything is made (fixture + the shipped CANDIDATE.json; a malformed candidate file too)' ($c6.code -eq 2 -and $c6.out -like "*status is 'PENDING z', not READY*" -and $c6.newDirs -eq 0 -and $c6sOk -and $c6b.code -eq 2 -and $c6b.out -like '*is not valid JSON*' -and $c6b.newDirs -eq 0) ("fixture: {0} | shipped ({1}): {2} | malformed: {3}" -f $c6.out.Trim(), $shipped.status, $c6s.out.Trim(), $c6b.out.Trim())
# C7 the other candidate refusals (each before anything is made)
$c7a = DryLaunch @() (CandFile 'other_boot' @{ boot_exe_sha256 = ('ee' * 32) })
$c7b = DryLaunch @() (CandFile 'other_commit' @{ commit = '383f720c04533b301faf42174860cd3ba06de137' })
$c7c = DryLaunch @() (CandFile 'other_folder' @{ package_folder = 'C:\nowhere\Wonderland_PrivateBeta_test' })
$c7d = DryLaunch @() (CandFile 'testfile_real' @{ commit = 'not-this-commit' }) -NoDryChecks   # double-guarded: the commit would refuse too
$c7ok = ($c7a.code -eq 2 -and $c7a.out -like '*the boot exe sha256*' -and $c7a.newDirs -eq 0) -and ($c7b.code -eq 2 -and $c7b.out -like '*-Commit testfixture is not*' -and $c7b.newDirs -eq 0) -and
        ($c7c.code -eq 2 -and $c7c.out -like "*is not CANDIDATE.json's package_folder*" -and $c7c.newDirs -eq 0) -and ($c7d.code -eq 2 -and $c7d.out -like '*for -DryChecks tests only*' -and $c7d.newDirs -eq 0)
Check 'C7 boot exe / -Commit / -Package folder / a test candidate file without -DryChecks: each refused before anything is made' $c7ok ((@($c7a, $c7b, $c7c, $c7d) | ForEach-Object { $_.out.Trim() }) -join ' || ')
# C8 the prereg launch: -RenderCvars 'scalability 0'
$c8 = DryLaunch @('-RenderCvars', 'scalability 0')
$c8raw = Get-Content -Raw (Join-Path $c8.dir 'DRYCHECKS.json')
$c8c = DryLaunch @('-RenderCvars', 'scalability 0', '-Control')
$wantS = '-wldev -ExecCmds="wl.Social.Dev wlautoA http://127.0.0.1:8796,wl.Remote.LogPeriod 0.1,scalability 0"'
$wantO = '-wldev -ExecCmds="wl.Social.Dev wlautoB http://127.0.0.1:8796,wl.Remote.LogPeriod 0.1,scalability 0"'
$wantOc = '-wldev -ExecCmds="wl.Social.Dev wlautoB http://127.0.0.1:8796,wl.Remote.LogPeriod 0.1,scalability 0,wl.Remote.InterpEaseZ 30,wl.Remote.ReportTimeSamples 0,wl.Remote.RttClock 0"'
$c8ok = $c8.code -eq 0 -and $c8.dc.planned.sender.args.EndsWith($wantS) -and $c8.dc.planned.observer.args.EndsWith($wantO) -and
        ($c8raw -match '"render_cvars":\s*\[\s*"scalability 0"\s*\]') -and $c8.dc.prereg_launch -eq $true -and $c8.dc.server_port -eq 8796 -and
        $c1.dc.prereg_launch -eq $false -and $c1.log -like '*NOTE: NOT the PREREG B33 v3 judged launch*' -and
        $c8c.code -eq 0 -and $c8c.dc.planned.sender.args.EndsWith($wantS) -and $c8c.dc.planned.observer.args.EndsWith($wantOc) -and
        @(@($c1, $c8, $c8c) | ForEach-Object { $_.dc.planned.sender.args, $_.dc.planned.observer.args } | Where-Object { $_ -match ',"$|,,|="",|ExecCmds=","' }).Count -eq 0   # no empty command (the old trailing comma)
Check "C8 -RenderCvars 'scalability 0': the planned ExecCmds and RUN.json's disclosed render_cvars are exactly the prereg set" $c8ok ("sender: {0} | observer: {1} | control observer: {2}" -f $c8.dc.planned.sender.args, $c8.dc.planned.observer.args, $c8c.dc.planned.observer.args)
# C9 launcher -> judge on a synthetic run whose Command Lines are the launcher's planned arguments
function JudgeFromDry([string]$name, [string]$dcPath, [string]$append) {
  $rd = Join-Path $lf ("synth_" + $name)
  if (Test-Path $rd) { Remove-Item -Recurse -Force $rd }
  $a = @('-I', '-B', (Join-Path $b 'tests\b33_synth.py'), '--from-drychecks', $dcPath, $rd)
  if ($append) { $a += @('--append-observer', $append) }
  $null = & python @a
  # v3.1: the synthetic run is judged against the test relay pin (cbe584be, the DryChecks server) and a route pin of its own route.json
  $rpj = Join-Path $rd 'route_pin_test.json'
  $rjs = Join-Path $rd 'drive_synth\route.json'
  [ordered]@{ status = 'PINNED'; route_sha256 = $(if (Test-Path $rjs) { (Get-FileHash $rjs -Algorithm SHA256).Hash.ToLower() } else { '' }) } | ConvertTo-Json | Set-Content -Path $rpj -Encoding utf8
  $null = & python -I -B (Join-Path $b 'b33_judge.py') $rd --expect-exe ('ab' * 32) --relay-pin-file $readyPin --route-pin-file $rpj --json (Join-Path $rd 'JUDGE.json')
  $code = $LASTEXITCODE
  $j = Get-Content -Raw (Join-Path $rd 'JUDGE.json') | ConvertFrom-Json
  return [pscustomobject]@{ code = $code; result = $j.result; why = (@($j.result_why) -join ' | ') }
}
$j1 = JudgeFromDry 'prereg' (Join-Path $c8.dir 'DRYCHECKS.json') ''
$j2 = JudgeFromDry 'extra_wl_remote' (Join-Path $c8.dir 'DRYCHECKS.json') 'wl.Remote.RttClock 1'
$j3 = JudgeFromDry 'extra_r' (Join-Path $c8.dir 'DRYCHECKS.json') 'r.ScreenPercentage 50'
$j4 = JudgeFromDry 'no_render' (Join-Path $c1.dir 'DRYCHECKS.json') ''
$c9ok = ($j1.code -eq 0 -and $j1.result -eq 'PASS') -and ($j2.code -eq 4 -and $j2.why -like '*observer launch command not allowed*wl.Remote.RttClock 1*') -and
        ($j3.code -eq 4 -and $j3.why -like '*observer launch command not allowed*r.ScreenPercentage 50*') -and ($j4.code -eq 4 -and $j4.why -like '*not exactly the prereg*')
Check 'C9 launcher -> judge: the planned prereg ExecCmds PASS; + wl.Remote.RttClock 1 or + r.ScreenPercentage 50 on the observer VOID; no scalability 0 VOID' $c9ok ("prereg {0} | +wl.Remote {1}: {2} | +r.* {3}: {4} | none {5}: {6}" -f $j1.result, $j2.result, $j2.why, $j3.result, $j3.why, $j4.result, $j4.why)

# V1-V3 the route survey record (B-9) on the dry-run survey's model outputs (repackaged as a test run folder; no game, no input)
$sv = Get-ChildItem $out -Directory | Where-Object Name -like 'drive_survey_DRYRUN*' | Select-Object -Last 1
if (-not $sv) {
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_drive.ps1') -Run $out -Mode survey -SurveyReturn -DryRun -Route $v9route -SimAccel 900 2>&1
  $sv = Get-ChildItem $out -Directory | Where-Object Name -like 'drive_survey_DRYRUN*' | Select-Object -Last 1
}
$svRun = Join-Path $PSScriptRoot 'survey_fixture\run'
if (Test-Path (Split-Path $svRun)) { Remove-Item -Recurse -Force (Split-Path $svRun) }
$svDrive = Join-Path $svRun 'drive_survey_TESTFIXTURE'; New-Item -ItemType Directory -Force $svDrive | Out-Null
Copy-Item (Join-Path $sv.FullName 'timeline.csv'), (Join-Path $sv.FullName 'route.json') $svDrive
[ordered]@{ run_id = 'survey_fixture'; exe_sha256 = 'synthetic-model'; sender = [ordered]@{ log = (Join-Path $sv.FullName 'DRYRUN_model_sender.log') } } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $svRun 'RUN.json') -Encoding utf8
$t1 = & python -I -B (Join-Path $b 'b33_survey_record.py') $svRun 2>&1; $v1c = $LASTEXITCODE
Check 'V1 survey record: ROUTE OK; the SURVEY_WALKOFF fall printed and NEVER counted' ($v1c -eq 0 -and (($t1 -join "`n") -like '*ROUTE OK*') -and (($t1 -join "`n") -like '*PRINTED, NEVER COUNTED*') -and (Test-Path (Join-Path $svRun 'SURVEY_RECORD.md')))
$rt = Get-Content -Raw (Join-Path $svDrive 'route.json') | ConvertFrom-Json
$rt.m4.mount.kerb_z = @(100.0, 121.0); $bad = Join-Path $svRun 'route_bad.json'; $rt | ConvertTo-Json -Depth 10 | Set-Content $bad -Encoding utf8
$t2 = & python -I -B (Join-Path $b 'b33_survey_record.py') $svRun --route-new $bad --out (Join-Path $svRun 'REC_bad.md') 2>&1; $v2c = $LASTEXITCODE
Check 'V2 a proposed route that changes kerb_z is REFUSED (B-9 bounds)' ($v2c -eq 1 -and (($t2 -join "`n") -like '*REFUSED: m4.mount.kerb_z*'))
$rt = Get-Content -Raw (Join-Path $svDrive 'route.json') | ConvertFrom-Json
$rt.m4.approach[3] = @(170, 3460); $okf = Join-Path $svRun 'route_ok.json'; $rt | ConvertTo-Json -Depth 10 | Set-Content $okf -Encoding utf8
$t3 = & python -I -B (Join-Path $b 'b33_survey_record.py') $svRun --route-new $okf --out (Join-Path $svRun 'REC_ok.md') 2>&1; $v3c = $LASTEXITCODE
Check 'V3 a proposed route that moves a waypoint stays inside the bounds' ($v3c -eq 0 -and (($t3 -join "`n") -like '*inside the bounds*'))
# V4 R7-09: a survey that DROVE route v2 is recorded as a survey of a PROPOSED route, bounded against the pinned v1
$sv4 = Join-Path $PSScriptRoot 'survey_fixture\run_v2'; $sv4d = Join-Path $sv4 'drive_survey_TESTFIXTURE'; New-Item -ItemType Directory -Force $sv4d | Out-Null
Copy-Item (Join-Path $r7.dir 'timeline.csv'), (Join-Path $r7.dir 'route.json') $sv4d
[ordered]@{ run_id = 'survey_fixture_v2'; exe_sha256 = 'synthetic-model'; sender = [ordered]@{ log = (Join-Path $r7.dir 'DRYRUN_model_sender.log') } } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $sv4 'RUN.json') -Encoding utf8
$t4 = & python -I -B (Join-Path $b 'b33_survey_record.py') $sv4 2>&1; $v4c = $LASTEXITCODE
$t4s = $t4 -join "`n"
Check 'V4 a survey that drove route v2: NOT the pinned v1, bounded against it, inside the bounds, ROUTE OK (R7-09)' ($v4c -eq 0 -and $t4s -like '*NOT the pinned v1*' -and $t4s -like '*inside the bounds*' -and $t4s -like '*ROUTE OK*') 

# P62 (v3.1f; the B14/B18 rehearsal's T-1 / L11 pattern): the stop's ProcState and the launcher's ProcRec never throw, even when a process is
# exiting (no StartTime, or StartTime throws); a stop whose recorded process has already exited still hashes, releases and writes RUN_CLOSE
$stopSrc = Get-Content -Raw (Join-Path $b 'b33_stop.ps1'); $launchSrc = Get-Content -Raw (Join-Path $b 'b33_launch.ps1')
$fnState = [regex]::Match($stopSrc, '(?ms)^function ProcState\(\$rc\) \{.*?^\}').Value
$fnRec = [regex]::Match($launchSrc, '(?ms)^function ProcRec\(\$id\) \{.*?^\}').Value
$p62 = & {
  Invoke-Expression $fnState; Invoke-Expression $fnRec
  $me = Get-Process -Id $PID
  $ok = [ordered]@{}
  $ok.ours = (ProcState ([pscustomobject]@{ pid = $PID; name = $me.ProcessName; start = $me.StartTime.ToUniversalTime().ToString('o') })) -eq 'ours'
  $ok.other = (ProcState ([pscustomobject]@{ pid = $PID; name = $me.ProcessName; start = $me.StartTime.ToUniversalTime().AddHours(1).ToString('o') })) -eq 'other'
  $ok.badstart = (ProcState ([pscustomobject]@{ pid = $PID; name = $me.ProcessName; start = 'not a time' })) -eq 'unverified'
  $ok.recLive = [bool](ProcRec $PID).start_utc
  function Get-Process { [pscustomobject]@{ ProcessName = 'Wonderland'; StartTime = $null } }          # an exiting process: no StartTime
  $ok.nullState = (ProcState ([pscustomobject]@{ pid = 4242; name = 'Wonderland'; start = (Get-Date).ToUniversalTime().ToString('o') })) -eq 'gone'
  $ok.nullRec = $null -eq (ProcRec 4242)
  function Get-Process { $o = [pscustomobject]@{ ProcessName = 'Wonderland' }; $o | Add-Member -MemberType ScriptProperty -Name StartTime -Value { throw 'Process has exited' }; $o }
  $ok.throwState = (ProcState ([pscustomobject]@{ pid = 4242; name = 'Wonderland'; start = (Get-Date).ToUniversalTime().ToString('o') })) -eq 'gone'
  $ok.throwRec = $null -eq (ProcRec 4242)
  $ok
}
$fx62 = Join-Path $PSScriptRoot ('stop_fixture\p62_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Force (Join-Path $fx62 'sender\Saved\Logs'), (Join-Path $fx62 'observer\Saved\Logs') | Out-Null
Set-Content (Join-Path $fx62 'sender\Saved\Logs\Wonderland.log') 'sender log' -Encoding ascii
Set-Content (Join-Path $fx62 'observer\Saved\Logs\Wonderland.log') 'observer log' -Encoding ascii
$gp = Start-Process powershell -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Milliseconds 400' -PassThru -WindowStyle Hidden
$gst = $gp.StartTime.ToUniversalTime().ToString('o'); $gp.WaitForExit()
[ordered]@{ run_id = 'p62_fixture'; role = 'JUDGED'; lease_id = $null; launcher_pid = 999999
  sender = [ordered]@{ procs = @([ordered]@{ pid = $gp.Id; name = 'powershell'; start_utc = $gst }) }
  observer = [ordered]@{ procs = @() }; server = [ordered]@{ procs = @() }; frames = [ordered]@{ procs = @() } } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $fx62 'RUN.json') -Encoding utf8
$so62 = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_stop.ps1') -Run $fx62 -FromLauncher 2>&1
$rc62 = $(if (Test-Path (Join-Path $fx62 'RUN_CLOSE.json')) { Get-Content -Raw (Join-Path $fx62 'RUN_CLOSE.json') | ConvertFrom-Json } else { $null })
$finallyTry = [regex]::Match($launchSrc, '(?ms)\} finally \{.*?\nexit \$exitCode').Value
$ok62 = (@($p62.Values | Where-Object { -not $_ }).Count -eq 0) -and $rc62 -and @($rc62.close_errors).Count -eq 0 -and @($rc62.skipped) -like '*already gone*' -and
        (Test-Path (Join-Path $fx62 'SHA256SUMS_AT_CLOSE.txt')) -and $stopSrc -notmatch '\$p\.StartTime\.ToUniversalTime\(\)' -and
        ([regex]::Matches($finallyTry, '\btry \{').Count -ge 3)
Check 'P62 (T-1 / L11) ProcState and ProcRec never throw on an exiting process (null or throwing StartTime); a stop whose process already exited still closes; every finally step in its own try' $ok62 ((($p62.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ') + " | close: " + $(if ($rc62) { "skipped [$(@($rc62.skipped) -join '; ')] errors $(@($rc62.close_errors).Count)" } else { 'NO RUN_CLOSE' }))

# S1 stop script
if ($SkipS1) { Write-Output 'SKIP S1 (-SkipS1)'; if ($fails -eq 0) { Write-Output 'ALL OK (S1 skipped)' } else { Write-Output "$fails FAILED" }; exit $fails }
$fx = Join-Path $PSScriptRoot ('stop_fixture\run_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Force (Join-Path $fx 'sender\Saved\Logs'), (Join-Path $fx 'observer\Saved\Logs') | Out-Null
Set-Content (Join-Path $fx 'sender\Saved\Logs\Wonderland.log') 'sender log' -Encoding ascii
Set-Content (Join-Path $fx 'observer\Saved\Logs\Wonderland.log') 'observer log' -Encoding ascii
$a = Start-Process powershell -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Seconds 120' -PassThru -WindowStyle Hidden
$c = Start-Process powershell -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Seconds 120' -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 800
$pa = Get-Process -Id $a.Id; $pc = Get-Process -Id $c.Id
$rec = [ordered]@{ run_id = 'stop_fixture'; role = 'JUDGED'; lease_id = $null; launcher_pid = 999999
  sender = [ordered]@{ procs = @([ordered]@{ pid = $a.Id; name = $pa.ProcessName; start_utc = $pa.StartTime.ToUniversalTime().ToString('o') }) }
  observer = [ordered]@{ procs = @([ordered]@{ pid = $c.Id; name = $pc.ProcessName; start_utc = $pc.StartTime.ToUniversalTime().AddMinutes(-7).ToString('o') }) }  # a REUSED pid
  server = [ordered]@{ procs = @() }; frames = [ordered]@{ procs = @() } }
$rec | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $fx 'RUN.json') -Encoding utf8
$so = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b 'b33_stop.ps1') -Run $fx -FromLauncher 2>&1
Start-Sleep -Milliseconds 500
$aGone = -not (Get-Process -Id $a.Id -ErrorAction SilentlyContinue)
$cAlive = [bool](Get-Process -Id $c.Id -ErrorAction SilentlyContinue)
$closeOk = (Test-Path (Join-Path $fx 'RUN_CLOSE.json')) -and (Test-Path (Join-Path $fx 'SHA256SUMS_AT_CLOSE.txt'))
$sums = Get-Content (Join-Path $fx 'SHA256SUMS_AT_CLOSE.txt') -ErrorAction SilentlyContinue
Check 'S1 stop kills only its own pid (pid + start time)' ($aGone -and $cAlive -and $closeOk -and (@($sums | Where-Object { $_ -like '*Wonderland.log' }).Count -eq 2)) ("killed-ours=$aGone left-reused=$cAlive closed=$closeOk | " + ($so -join ' / '))
Stop-Process -Id $c.Id -Force -ErrorAction SilentlyContinue; Stop-Process -Id $a.Id -Force -ErrorAction SilentlyContinue
if ($fails -eq 0) { Write-Output 'ALL OK' } else { Write-Output "$fails FAILED" }
exit $fails
