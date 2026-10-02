# Wonderland private-beta readiness ledger

**Owner: CORE** (implementation, integration, packaging, primary verification). **Second Wonderland** falsifies
independently; its evidence lives in `_qa_handoff/zs_captures/`. Julius is out of scope for this ledger: Julius
readiness (accepted 82.00% on main 7c584df2) is a separate gate owned by JUJU + Second Julius and is never folded in.

Founder direction, 2026-09-30: drive Wonderland from its verified engineering state (43/43) to TRUE 100%
private-beta readiness. 100% only when every P0 and P1 is closed, ONE release candidate (RC) is built, and that same RC
passes the clean-user test, persistence/restart, the core creation flow, session flow (to the extent in the beta),
error/recovery, performance and memory, distribution, security/privacy and soak, and Second Wonderland signs it off.

**FOUNDER CORRECTION, 2026-10-02: WONDERLAND IS MULTIPLAYER BEFORE LAUNCH.** Private alpha, public alpha, private beta,
public beta and public launch all require the multiplayer/social foundation working end to end (R16). There is no
single-player-only launch plan. Multiplayer is a primary product moat, not a post-launch expansion; social is NOT
post-beta. R16 was added at weight 25 (founder's choice) and the other fifteen weights scaled by 0.75, so the ledger
still totals 100. Synthetic users are QA fixtures only.

## Scoring rule (mechanical, never intuition)

Each row has a weight; the weights total 100. A row earns:

| credit | when |
|---|---|
| 0 | any P0/P1 in the row is open, or any part of the row is not yet verified anywhere |
| 0.5 | every part verified, the weakest only in the editor or by static audit |
| 0.75 | every part verified on a packaged build that is not the final RC |
| 1.0 | every part verified on the FINAL RC by CORE **and** independently by Second Wonderland on that same RC |

**A row takes the level of its WEAKEST part** (clarified 2026-10-01): a row whose parts are partly package-verified and
partly unverified scores 0, not a blend. **Readiness = sum of weight x credit.** Second's independent sign-off on the RC
is built into every 1.0, so nothing above 75% is possible before the final RC.

**LAUNCH GATE (founder, 2026-10-02):** whatever the total, no private/public alpha or beta launch until R16 (the
multiplayer/social launch loop) is at 1.0 on the final RC, i.e. verified end to end with real authenticated users and
multiple real Wonderland clients, by CORE and independently by Second.

## Ledger (as of RC8: RC5 and RC8 package evidence, all at most 0.75; the final RC is RC9, to be verified by CORE and Second)

| # | Requirement | Weight | Credit | Evidence (RC3 = 0.1.0-rc3, 90c8d0fa; RC4 = 0.1.0-rc4, 3aa43e1f; RC5 = 0.1.0-rc5, 05e983d8; RC8 = 0.1.0-rc8, ecaa3407; RC9 = 0.1.0-rc9, 3806f26a, the FINAL RC: CORE's chain below) | Weakest part / open blockers |
|---|---|---|---|---|---|
| R1 | Environmental world complete (locked, 25/25) | 6 | 0.75 | WORLD_COMPLETION_MATRIX.md. **RC9, CORE:** QA Q02-Q08 travel/map/teleports PASS, 0 Nanite/default-material lines; every travel in the failed-travel, perf and drive runs arrived or recovered. **RC9, Second, independent** (`_qa_handoff/rc9_pass/p5_qa`, its own run and reading on its Explorer extraction): Q02-Q08 PASS (six travels "Arrived at …"; map labels at zoom 1/4/8 with 0 overlaps), 0 "missing usage flag Nanite" lines in its log (the one WorldGridMaterial line is the engine's frame-0 package streaming, identical in CORE's run); its P4 map screen. Earlier: RC3-RC5 | -- |
| R2 | Gameplay regression G1-G7 (locked, 18/18) | 6 | 0.75 | **RC9, CORE:** QA Q09-Q11 PASS (Mission Contract travel, hands p95 and circle per skin, every skin 174.15 uu = Relay OG). **RC9, Second, independent** (`p5_qa`): Q09, Q09.1-2, Q10.1-5 (each skin 174.15 uu, 0.00 uu moved on the switch), Q11.1-4 (hands p95 <= 0.03 uu, circles with 0 stalls and 0 detours) PASS. Earlier: RC3, RC5 | -- |
| R3 | First launch: clean start, spawn, Relay Dog init, clear path in, no developer knowledge | 6 | 0.75 | **RC9, CORE:** QA Q00.1 welcome, Q00.2 lock-down, Q00.6 the window names the build; static (prerequisites staged); the clean-user first launch and run2b (title, welcome, START, world, menu, QUIT -> "Log file closed"); `drive_rc9_b_core/` menu QUIT. **RC9, Second, independent** (`_qa_handoff/rc9_pass/p2_cleanuser_run3`): a browser-marked zip unzipped by Explorer into a new folder; the root exe with no arguments on the REAL default profile (absent); welcome; the console and engine debug keys inert (0 console/debug lines); START; the Dog walked; menu (the build label in its footer); QUIT -> "Log file closed", 0 fatal; P0 static (zip = CORE's sha, = folder = manifest). Earlier: RC5 Q00.x; Second's RC4 clean-user | B55 (P3): a freshly unzipped package hitches on its first run. B33 (P2): a double-click on the marked exe raises "Unknown Publisher" (README step 3) |
| R4 | Core creation loop, truthful about Julius | 9 | 0.75 | **RC9, Second, independent, contract parts** (`_qa_handoff/rc9_pass/p5_qa`): Q13 8 QUEUED contracts through + and a typed objective, saved; Q17 the SIMULATED badge and banner; Q20 48 kept, the next refused, deleted back to 8; after a restart Q14 8 restored, 0 reopened; Q15 /tasks delete leaves 0 and removes the save. With its P1 WATCH click below, every part on RC9 by both. RC3 Q13 eight contracts through + and the terminal, Q14 restored, Q15 deleted, Q17 the simulated mission plays and says SIMULATED, Q20 limit 48; RC8 Q13/Q14/Q15/Q17/Q20 PASS; **RC8: the WATCH A SIMULATED MISSION button itself clicked in the package by real OS input** (`drive_rc8_a_core/`, `drive_rc8_a2_core/`): "WLMISSION simulated mission from the Missions panel: started", the panel closes, scenario D plays SIMULATED on camera; `drive_rc8_a3_core/`: relaunched, clicked, and watched to its end ("WLMISSION fixture 'full_lifecycle' finished … beat=complete_verified … applied=22 … simulated=4"). That run's overall line reads "DRIVE FAIL 8/2": both failures are the plan's single Esc after the mission, which closed the mission's Julius terminal (correct behaviour), so the menu QUIT steps clicked the world. Not a game defect; the menu QUIT is proven in `drive_rc8_b_core/` and the clean-user runs. RC9: QA Q13/Q14/Q15/Q17/Q20 PASS, and the same click-to-end evidence in `drive_rc9_a3_core/` (same plan artifact). **RC9, Second, independent:** its own WATCH click by real input -> "simulated mission from the Missions panel: started" -> scenario D -> "fixture 'full_lifecycle' finished … complete_verified" -> Esc, Esc -> menu -> QUIT, "Log file closed" (`_qa_handoff/rc9_pass/p1_r4_watch`) | -- |
| R5 | Session stability: launch / quit / relaunch, focus loss, window changes (single-player) | 2.25 | 0.75 | **RC9, CORE** (`drive_rc9_b_core/`, 15/15): window modes x3 through SETTINGS, input after, focus lost 8 s to another window and back, minimize/restore, menu QUIT, graceful; `drive_rc9_a3_core/` relaunched WINDOWED with no welcome. **RC9, Second, independent** (`_qa_handoff/rc9_pass/p3_r5_window`): relaunched on its clean-user profile (no welcome); WINDOWED -> BORDERLESS -> WINDOWED (exactly three WLSETTINGS lines), input after; focus loss by minimize (6 s) -> restore -> J opened Missions; MENU tab -> QUIT, "Log file closed" (two early QUIT clicks missed controls; no setting changed). RC3: four clean boots and quits; **RC8 by real OS input** (`drive_rc8_b_core/`, 15/15, no founder input): SETTINGS WINDOWED -> BORDERLESS -> WINDOWED through the buttons, each proved by "WLSETTINGS window mode …" and the window's own style (caption 1940x1249 / popup 1920x1200); after them Esc closes the menu, J opens Missions, Esc closes it; focus lost 8 s to another window and back, then input; minimized 5 s and restored, then input; Esc -> menu -> QUIT WONDERLAND (two clicks) -> "Log file closed". `drive_rc8_a3_core/` relaunched on that profile: no welcome (it was seen), still WINDOWED (the choice survived the restart) | B60 (P3): WINDOWED at the desktop resolution. Second's focus loss is a minimize; CORE's also covers a visible switch to another window |
| R6 | Private/project space and project avatar flow, as implemented | 2.25 | 0.75 | nothing to test (D2). **RC9, CORE:** QA Q18 `/pa` changes nothing in a player session; the welcome, as shown in the clean-user runs. **RC9, Second, independent** (`p5_qa`): Q18 PASS (4 figures before and after); the welcome in its clean-user run. Earlier: RC3 Q18 | -- |
| R7 | Wonder Web and every beta-facing screen: no dead buttons or placeholders, no debug exposure, back/close/Esc, sane errors | 6 | 0.75 | **RC9, CORE:** QA Q00.2/Q00.3/Q00.5, Q01-Q01f, Q19, Q22-Q24; wardrobe 22/0; the four terminal panels within 1 level of the JULIUS 3.3 black; B56 remount; menus, SETTINGS, HOW TO PLAY, Missions by real input. **RC9, Second, independent** (`_qa_handoff/rc9_pass`): its own QA run (the same Q00.x/Q01/Q19/Q22-Q24 PASS); P4 every screen by its key with Esc (terminal: the four panels one black on RC9; Missions, Brain, Command Presets, Map, menu); P4b buttons by real input (Brain -> OPEN WONDER WEB; SWITCH SKIN -> the wardrobe preview on and off; WONDER WEB WALLET; COLORS; map Tower Rise -> TELEPORT -> "arrived=1"; QUIT -> "Log file closed"), no dead button, placeholder or debug exposure; P4c its own console film: B49 ACCEPTED (OFFLINE at rest, ACTIVE · JOINED with streaming tool lines, truthful footers, settled at the end) | B54 (P2, Julius lane): SIM TOKENS in the Julius terminal. Founder 2026-10-02: open P2s do not block a 1.0 |
| R8 | Save / persistence across quit, relaunch, interruption | 6 | 0.75 | **RC9, CORE:** QA run2 Q12/Q14/Q16/Q15 across a restart; run3 Q21.1-Q21.7 on planted corrupt files (set aside, next save sealed); the save made before the quit survived the watchdog kill. **RC9, Second, independent** (`_qa_handoff/rc9_pass`): P5 run2 Q12/Q14/Q16/Q15; P9 the save intact after a watchdog-ended exit; P6 13/13 corrupt-file cold boots (CRC flip, truncated, huge length, wrong class, 33 MB, unsealed RC2, read-only, a directory named .sav, retired/unregistered skins, empty sealed trailer: no crash, bad files set aside); P11 its own PackageHostile 7/0, incl. Q21.5 "a new contract is written AND SAVED SEALED" after the refusal. RC5 Q12/Q14/Q16/Q15 across a restart; Q21.1-Q21.7 a third boot on corrupted files: no crash, bad files set aside, next save sealed | -- |
| R9 | Error / recovery: services absent, timeouts, failed travel / load, bad input, corrupt files | 5.25 | 0.75 | **RC9, CORE:** QA Q00.3 services absent, Q19 bad terminal input, Q21.x corrupt files; failed travel (`failed_travel_rc9_core/`: 2 forced failures recovered with the exact message, a later travel arrived). **RC9, Second, independent:** P5 Q00.3 and Q19; P6 13/13 bad-file boots; P11 Q21.1-Q21.7; P7 failed travel (`p7_failed_travel`): tower_lane and castle_approach abandoned with "Could not land safely at …; returned to where you were.", 5 arrivals including after the abandons, exit 0. RC5 Q00.3 services absent, Q19 bad terminal input, Q21.1-Q21.7 corrupt files; RC5 failed travel in the package (`failed_travel_rc5/`): the travel limits squeezed at launch with the engine's `set`, then three of seven teleports were abandoned ("no ground under the landing", "still streaming … hard cap"). Each said "Could not land safely at X; returned to where you were.", put the visitor back, and later teleports and the exit ran normally | -- |
| R10 | Performance on the founder's laptop, measured in the package | 5.25 | 0.75 | **RC9, CORE:** perf in the game's own window back to back with RC8 (`perf_rc9_core/`, `perf_rc8_before_rc9_core/`): RC9 >= RC8 in every phase, 1 frame over 100 ms, 0 crashes, memory flat. **RC9, Second, independent** (`_qa_handoff/rc9_pass/p8_perf`): RC9 -> RC8 -> RC9 back to back with the same args, idle 28.0/27.8/26.9, walk 28.7/29.1/27.7, map 32.4/32.8/31.5, contract 25.2/25.1/24.7 fps: RC9 = RC8 within RC9's own spread; travel times identical. Its absolute fps sit ~20% under CORE's for both builds (the machine's state). RC5 perf twice in the game's own window (borderless 1536x960, EPIC, HW RT), back to back with RC4 (table below): RC5 = RC4; RC3 table below; Second's RC2 matrix: every SETTINGS choice applies | B55 (P3): first run of a fresh package |
| R11 | Memory pressure: long-session growth, repeated skins / teleports / contracts / map / relaunch | 4.5 | 0.75 | RC5 60-minute soak (`soak_rc5/`), 165 cycles of skins, teleports, contracts, map and creation: private memory flat (10-minute medians 6,406-6,480 MB, minima 6,148-6,217 MB from minute 10), VRAM flat (4,026-4,075 MB), uobjects not growing; Second's independent read of the CSV agrees; relaunch across the QA's three boots | -- |
| R12 | Package / distribution: clean artifact, prerequisites, no machine paths, size, README, version visible | 5.25 | 0.75 | **RC9, CORE:** `static_0.1.0-rc9_core.txt` (zip == manifest == folder, 81 files, 0.62 GB; app-local CRT + vc_redist staged; scan hits = RC8's, known P3 strings only; against RC8 only the exe and the version lines changed); the label in the window title and the menu. **RC9, Second, independent** (`_qa_handoff/rc9_pass/static`): zip sha256 = CORE's, 81/81 entries CRC-match the folder, manifest fields match, only the exe/BuildInfo/README version lines differ from RC8, the same 8 known scan hit kinds; the label in its title bar and menu footer. RC5 zip: 81 files, 0.62 GB, sha256 0CFF42F5...E8459; app-local CRT + vc_redist staged; no Saved/PDB/sources/Vulkan layers/retired figures; clean label "build 05e983d8"; README with the publisher dialog and Smart App Control | P2: B33 unsigned, B36 notices; P3: B38. Founder 2026-10-02: open P2s do not block a 1.0 |
| R13 | Security / privacy baseline | 3.75 | 0.75 | **RC9, CORE:** QNET PASS on QA run1 and run2 and on every drive boot; Stage 2's 1985 timeline (closed by t+15.7 s, no listener after); scan hits = RC8's (known P3 strings only); AI off (Q00.3, WLBUILD "local AI services off"). **RC9, Second, independent** (`_qa_handoff/rc9_pass/p2_cleanuser_run3`, `static/`): no listening socket at its two net checks in the clean-user boot; the boot's own port-closed line; its scan: the same 8 known hit kinds; AI off in its WLBUILD line. Second's P9 (`p9_exit_port_run2/listen`): port 1985 open 13.73 -> 16.98 s after launch (3.2 s, at boot), never again. Earlier: RC5 QNET two boots | -- |
| R14 | Crash / soak on the package | 3 | 0 | **RC9 exit parts, both:** CORE's watchdog (armed 0.91 s after PreExit, the induced hang ended 20.6 s later, code 0) and graceful exits on every QA/drive boot; Second's P9: WM_CLOSE -> graceful in 5.08 s with no leftovers, the watchdog ending its induced hang 20.6 s after the arm, code 0, the save intact. 0 crashes across both chains. RC5: 0 crashes in the 60-minute soak, three QA boots, perf and films | **B57 (P1) open on RC5**: the soak's exit never finished (fixed in RC6 source; RC6's soak must show it) |
| R15 | Clean-user test on the RC (no saves, no console, no developer knowledge) | 4.5 | 0.75 | **RC9, CORE** (`cleanuser_rc9_core/`): run1 = the package's very first launch through Windows' firewall prompt (answered by a person; no input from CORE), then the title, welcome, START and world before a founder void; run2b on a fresh empty profile, the whole visible path to QUIT, 9/9, graceful. **RC9, Second, independent** (`_qa_handoff/rc9_pass/p2_cleanuser_run3`): MotW zip, Explorer unzip into a new folder, the root exe on the REAL default profile (absent); welcome; console/debug keys inert; START, walk, menu, QUIT; "Log file closed", 0 fatal, no leftovers. **RC8, CORE** (`cleanuser_rc8_core/`): the zip extracted fresh into a new folder (81 files, nothing written into it afterwards), an empty profile, the root Wonderland.exe with no game arguments (the harness adds -nosound and the empty -userdir), entered only through the screen by real OS input: the window title carries the label; the welcome opens (player session, AI off); START; the world; Esc -> menu -> HOW TO PLAY -> Esc back -> QUIT WONDERLAND -> "Log file closed" (run2, 9/9). Run1, the path's very first launch, was taken over by Windows' firewall prompt for the engine's diagnostics port (README step 4 says: click Cancel); a person answered it Allow at ~19:21; CORE never touches that prompt or the rules | CORE's profile is an empty -userdir; Second's is the real default profile |
| R16 | **Multiplayer / social foundation -- WONDERLAND MULTIPLAYER PHASE 1, end to end** (founder, 2026-10-02: "WONDERLAND IS MULTIPLAYER BEFORE LAUNCH"; architecture decided: a SHARED PRESENCE LAYER, each world executing locally, authenticated players in the same Wonderland/server context existing together through synchronized state via the social backend; no authoritative dedicated-server simulation claimed; dedicated servers later only for experiences needing authority (competitive GVE, PvP, shared physics, economy)). The loop: sign in -> friends (requests, accept/decline/cancel, remove, block, mute, report, recent players) -> presence (online, in Wonderland, creating, working with Julius, private server, GVE, mission, party, away, busy, offline) -> another user's profile (LEFT: primary Compound AI Agent + primary Relay Dog, prominent; skins via the canonical registry) -> direct messages with unread state and history -> create/join a party, invite, leader controls -> join the same Wonderland/server context and SEE each other in-world (player and Relay Dog representations, movement/presence) -> join/leave updates -> privacy/block/mute/report enforced (no leaks) -> state survives reconnect/restart. Unreal: Social Hub, Friends, Friend Requests, Recent Players, Messages, Parties, Party Voice (mute, self-mute, speaking, connect/reconnect, provider abstraction; NO faked connected voice: a real provider before 1.0), User Profiles. Backend: in sunday-relay MAIN (routes, least-privilege desktop social capability with session identity = actor, snapshot.read as an aggregation of existing authorized reads only, PostgreSQL persistence surviving a backend restart, migration 030 after main's 028/029, privacy-safe events polled first, push-compatible). **Acceptance: TWO ACTUAL Wonderland clients with different authenticated identities** (request, accept, presence update, message, party create/invite/join, the same context with both representations visible, block/privacy, restart/reconnect); synthetic users are never evidence | 25 | 0 | `local/wonderland-social` (Second, ACTIVE, HIGH PRIORITY, rebased onto RC10 7f8e08d8): client hub (Friends / Requests / Recent / Messages / Party + voice panel), voice abstraction (UNAVAILABLE by default), live HTTP client with an event poll, developer-only synthetic preview people; server commands + an atomic in-memory store with an event log + gated routes, 45/45 TS tests incl. two-player flows, mutation-checked; a loopback DEVELOPMENT social server for two-client tests. Nothing wired or deployed; the Unreal client is compiling for the first time (2026-10-02 06:38); no PostgreSQL persistence, no main-line routes, no shared-world presence, no real two-client run, no voice provider | the whole loop, end to end. **LAUNCH GATE: no private/public alpha or beta launch until R16 = 1.0** |
| | **Total** | **100** | | | |

**WONDERLAND BETA READINESS: 54.00%** (16 rows; **the FINAL RC is now RC10** 7f8e08d8 = RC9 + Shadow Flame, built
2026-10-02 05:02, zip 5F2E08C8…733B. RC9's CORE + Second evidence is a non-final package now, so those rows stand at 0.75
until re-earned on RC10; R14 0 waits for the soak; **R16 0: the multiplayer launch loop is not built**).
**NOT LAUNCHABLE: the R16 launch gate is shut.** WONDERLAND VERIFIED 80% MILESTONE was reached at 80.50% on the 15-row
single-player scale (R4, 2026-10-01); that scale no longer defines launch readiness.
R1 4.5 + R2 4.5 + R3 4.5 + R4 6.75 + R5 1.6875 + R6 1.6875 + R7 4.5 + R8 4.5 + R9 3.9375 + R10 3.9375 + R11 3.375 +
R12 3.9375 + R13 2.8125 + R14 0 + R15 3.375 + R16 0 = 54.00.
- **Plan (founder, 2026-10-02):**
  - RC10 = RC9 + Second's Shadow Flame skin once runtime-verified; it carries verified fixes but is not a launch
    candidate.
  - A later PRE-LAUNCH RC must contain the completed multiplayer/social foundation (Second owns its development; CORE
    integrates each verified milestone into canonical).
  - On every new final RC, every 1.0 is re-earned by CORE and Second; until then rows fall back to 0.75, and R11/R14
    come from that RC's soak.
- RC5's soak found a P1: the exit hangs after a long session (B57). RC6 (144d2e21) carried the fix. RC7 (4930697c, locked)
  added the founder's mascot-eye correction. RC8 (ecaa3407) = RC7 + the wardrobe framing and canonical idle (31e22f5a) +
  the Julius terminal's black-glass contrast (1f1bae75).
- **FOUNDER DECISION 2026-10-01 ~20:45: the final RC is RC9** = RC8 + the pure-black Prompt Architect / Coding Agent /
  Independent Reviewer panels, matching Julius 3.3 (Second Wonderland's fix, integrated once render-verified). RC8 is no
  longer the shipping candidate. Its evidence stands at 0.75 (a package that is not the final RC). Every 1.0 is
  re-earned on RC9 by CORE and Second; nothing carries forward as final-RC credit.
- Above 72%, every point is a row at 1.0: CORE's RC9 evidence plus Second's independent RC9 evidence for every part.
- Still to evidence:
  - **R16 (weight 25, the LAUNCH GATE): the multiplayer/social launch loop end to end.** In Second's order:
    1. compile and verify the profile UI;
    2. Friends; 3. Presence; 4. Messages; 5. Parties; 6. Party Voice UI + provider abstraction;
    7. authenticated desktop social permissions; 8. backend persistence/routes; 9. cross-user event delivery;
    10. real multi-client tests; 11. privacy/block/mute/report; 12. reconnect/persistence;
    13. CORE integration; 14. the multiplayer RC's verification;
  - R14 and R11: the final RC's soak, after Second's sign-off;
  - Second's H pass (hostile strings, killed by the low-memory reaper on 2026-10-02) and its P10 mid-mission remount
    run on the next RC (founder's go given).
- History:
  - 62.25% -> 65.25% on 2026-10-01 18:55 (R4 0.5 -> 0.75: the WATCH button clicked in the RC8 package);
  - 65.25% -> 67.50% on 2026-10-01 19:14 (R5 0 -> 0.75: window modes, focus loss, minimize, quit and relaunch on RC8);
  - 67.50% -> 72.00% on 2026-10-01 19:28 (R15 0 -> 0.75: CORE's clean-user first launch of a fresh RC8 extraction);
  - 72.00% -> 77.50% on 2026-10-01 ~23:00 (R3, R5, R13, R15 0.75 -> 1.0: CORE's and Second's independent evidence on RC9,
    the final RC. R4 stays 0.75 until Second's contract parts land);
  - 77.50% -> 80.50% on 2026-10-01 ~23:55 (R4 0.75 -> 1.0: Second's independent contract parts Q13/Q14/Q15/Q17/Q20
    beside its WATCH click): **WONDERLAND VERIFIED 80% MILESTONE REACHED**;
  - 80.50% -> 85.25% on 2026-10-01 ~23:55 (R1, R2, R6 0.75 -> 1.0: Second's own QA run on RC9, Q02-Q11 and Q18, with 0
    Nanite lines);
  - 85.25% -> 90.75% on 2026-10-02 (R7, R12, R10 0.75 -> 1.0):
    - R7: Second's screens and in-screen buttons by real input, and its own console film (B49 accepted);
    - R12: Second's static check;
    - R10: Second's perf, RC9/RC8/RC9;
    - the founder ruled that open P2s (B54, B33, B36) do not block a 1.0;
  - 90.75% -> 94.50% on 2026-10-02 ~03:35 (R8, R9 0.75 -> 1.0): Second's P7 failed travel and P11 hostile files (incl.
    the next save sealed after a refusal), beside its P5/P6/P9 and CORE's RC9 chain;
  - 94.50% -> 70.875% on 2026-10-02 (a change of DEFINITION, not of evidence): the founder made multiplayer a launch
    gate. R16 was added at weight 25, credit 0; the other weights x0.75; every row keeps its credit.
  - 70.875% -> 54.00% on 2026-10-02 05:02 (PROCEDURAL, the founder's rule): RC10 (7f8e08d8, Shadow Flame) became the
    final RC, so RC9's 1.0 rows (R1-R10, R12, R13, R15) fall back to 0.75 until CORE and Second re-earn them on RC10.
- With every row at 0.75 except R14 (0), CORE alone is at its ceiling of 72.00%. Everything above it comes from the final
  RC: CORE's RC9 chain plus Second's independent RC9 pass (each row to 1.0), and RC9's soak (R14, R11).

### RC10 package evidence (CORE) -- the FINAL RC since 2026-10-02 05:02

- Build: 0.1.0-rc10, commit 7f8e08d81c1284e25de8cd558a377b0ce5634827 = merge(be1cbcd7 task3, 9dbd93b8 Shadow Flame; on RC9
  3806f26a). Tree 1225c329, audited: Second's 10 files from 9dbd93b8, every other path from task3. Label
  "Private Beta 0.1.0-rc10 | build 7f8e08d8 | 2026-10-02"; zip sha256
  5F2E08C80EC515B24331DA5E22C0A58A0391791A03FDA3A7BA65BC2D25DF733B, 667,502,053 bytes, 82 files. The editor module was
  rebuilt too (05:03:39), so the founder's editor matches RC10.
- Static (`static_0.1.0-rc10_core.txt`): zip == manifest == folder (82/82); against RC9: + RelaySkins/ShadowFlame.wlvox,
  ~ exe, ~ BuildInfo and README (version); the binaries' scan hits identical to RC9's; no new file with hits.
- (CORE's RC10 chain continues here.)

### RC9 package evidence (CORE) -- final RC until 2026-10-02 05:02

- Build: 0.1.0-rc9, commit 3806f26a1ab0429c5611a9bc74d8e728cd68f1f3 = merge(2f3fd31d task3, 16b59f22 the pure-black
  panels; parent ecaa3407). The tree adf9661e was audited path by path (C's three files from C, every other path from
  task3; both patch directions byte-identical). Label "Private Beta 0.1.0-rc9 | build 3806f26a | 2026-10-01"; zip sha256
  28336FAA17FFE1B0F923BBBBC9A971B60025439C5DB0FCF3A7A4498E52229ABE, 667,470,050 bytes, 81 files.
- Static (`static_0.1.0-rc9_core.txt`): zip == manifest; 81/81 zip entries == the staged folder; against RC8: 0 added,
  0 removed, 3 changed (exe, BuildInfo, README version); paks byte-identical; scan hits identical to RC8's.
- QA (`qa_rc9_core.log`): **63 PASS, 0 FAIL over three boots, QA PASSED** (run1 50, run2 4, run3 7; QNET run1 and run2
  PASS), labels OK, 0 crash lines, graceful exits, no founder input.
- Exit watchdog (`hang_exit_rc9_core/`): armed 0.91 s after PreExit, ended the induced hang 20.6 s later; the save
  survived; 1985 open t+12.15 -> closed by t+15.67 s.
- Clean user (`cleanuser_rc9_core/`): run1 = the package's very first launch on a never-run path. Windows' firewall
  prompt took the foreground; no input was sent to it; a person answered it (Allow) and the run went on after 15 s of
  quiet: the label in the title, the welcome, player session, AI off, START, the world, QNET PASS. It was then VOID on
  mouse input. Run2b, a fresh empty profile: the whole path to QUIT, 9/9, graceful, QNET PASS.
- Session (`drive_rc9_b_core/`, 15/15): window modes x3, input after, focus loss, minimize/restore, menu QUIT, graceful,
  QNET PASS. `drive_rc9_a3_core/`: relaunched WINDOWED with no welcome; the WATCH click's mission ran to "fixture
  'full_lifecycle' finished … applied=22". The plan's single Esc then closed the mission's Julius terminal (a plan
  artifact; the menu QUIT is proven in run b and the clean-user run).
- Wardrobe (`wardrobe_rc9_core/`): wl.Qa.Wardrobe 22/0, the same figures as RC8 (84.4 / 85.8 / 97.6 / 98.1 / 89.9%).
- Julius Live Terminal, RC8 vs RC9 back to back (`film_rc8_before_rc9_core/`, `film_rc9_terminal_core/`, measured in
  `terminal_rc8_vs_rc9_core/`). Median sRGB of the panels' empty interiors:
  - RC9: all four panels the same black at every moment: (22,18,12) at 25 s and 35 s, (14,13,6) at 45 s, the worst
    channel difference between a peer and JULIUS 3.3 being 1;
  - RC8: peers up to 12 levels lighter.
  The header and the JULIUS 3.3 panel are unchanged.
- Companion consoles after a colour change (B56, `film_rc9_b56_core/`): the chrome was rebuilt and the secondary saved;
  both consoles match the plain RC9 film at 25, 35 and 45 s (mean |diff| <= 1.2 grey levels, 0% of pixels off by more
  than 48). The four panels are still within 1 level of each other.
- Failed travel (`failed_travel_rc9_core/`, squeeze 0.7 s): 2 forced failures, both returned with the exact message; a
  later travel arrived; graceful, code 0.
- Perf, back to back (`perf_rc9_core/`, `perf_rc8_before_rc9_core/`), RC9 vs RC8 avg fps / worst frame: idle 35.5/53 vs
  32.2/63; walk 34.7/55 vs 33.4/55; teleport 31.3/101 vs 26.7/119; map 44.6/38 vs 38.9/47; wardrobe 37.7/66 vs 34.0/95;
  contract 33.0/80 vs 30.4/102; creation 33.7/39 vs 30.2/44. No regression. 0 crashes; memory flat (peak private
  6.56 GB, VRAM 4.29 GB).
- Firewall: RC9's never-run path raised the prompt once; a person answered Allow. CORE changes no rule.

### RC8 package evidence (CORE)

- Build: 0.1.0-rc8, commit ecaa34077dc573216eb1eca5ac542b0430703b6e (merge of 1f1bae75 + 31e22f5a on 4930697c; the tree
  audited path by path: every blob is A's, B's or 4930697c's), label "Private Beta 0.1.0-rc8 | build ecaa3407 |
  2026-10-01", zip sha256 4462DE1B43E7384D7D9D1521533365D1353B29FCD641EFFF7704F6739CB61ED8, 667,471,176 bytes, 81
  files. Game target 9 actions (at most 2 at a time) 368 s; BuildCookRun 387 s.
- Static (`static_0.1.0-rc8_core.txt`): zip == manifest (sha256 and size); every zip entry decompressed equals the staged
  folder (81/81); against RC7: 0 added, 0 removed, 3 changed (Wonderland.exe; BuildInfo.txt and README_BETA.txt, the
  version and label only); paks byte-identical to RC7. Scan: the binaries' hits equal RC7's needle for needle (the same 51
  source-path strings); every other hit file is byte-identical to RC7.
- QA (`qa_rc8_core.log`): 61 of 61 in-game checks PASS over three boots (run1 50, run2 4, run3 7, incl. Q09/Q10 Relay OG
  against every skin, Q25 eyes inside the face), graceful exits, 0 crash lines, no founder input. **QNET run1 FAIL**:
  tcp 0.0.0.0:1985. Cause, from the logs: RC8's first-ever launch spent 16 s before its log opened (RC7 1 s; RC8 runs 2-3
  0 s: B55, a fresh package's first run), so the trace port's usual ~2 s opening (log "Control listening on port 1985")
  fell at +29.96 s, on QNET's reading at ~30 s. The port's timeline in both builds, by one instrument (Stage 2, sampled
  every ~150 ms): RC7 open t+10.14 -> closed by t+13.47 s; RC8 open t+10.45 -> closed by t+12.19 s, no listener after. QNET on
  two later RC8 boots: PASS (t+41.4 s, t+38.5 s). QNET run2/run3 SKIPPED (those boots end before 28 s).
- Exit watchdog (`hang_exit_rc8_core/`): armed 0.57 s after PreExit; the induced 60 s teardown hang ended 21.0 s later,
  kernel exit code 0; the save made before the quit survived.
- WATCH A SIMULATED MISSION by real OS input (`drive_rc8_a_core/`, `drive_rc8_a2_core/`; core_drive.ps1: SendInput only
  while the game is the foreground window and the window under the cursor; low-level hooks void a run on any real input):
  the click logs "WLMISSION simulated mission from the Missions panel: started", the panel closes, the Dog travels to
  Castle Approach, both companions join SIMULATED, the contract manifests, the strip reads DEVELOPMENT PREVIEW ·
  SIMULATED JULIUS EXECUTION through full_lifecycle 11/22 on camera. Both runs were later VOID (real mouse input at 18:34
  and 18:41) and stopped at once. `drive_rc8_a3_core/` (founder hands-off): relaunch, click, the mission to "fixture
  'full_lifecycle' finished" (applied=22); the mission opens the Julius terminal, so the first Esc after it closes the
  terminal (its own "Esc to close"), not the menu.
- Session stability (`drive_rc8_b_core/`, 15/15): see R5. QNET PASS on six RC8 boots after the first (t+35.7 to 43.1 s).
- Clean-user first launch (`cleanuser_rc8_core/`): see R15.
- Wardrobe, the authoritative run on the integrated build (`wardrobe_rc8_core/`): wl.Qa.Wardrobe END pass=22 fail=0, label
  OK, graceful. Preview height Relay OG 84.5%, Celestial Light 85.9%, Skeleton Flame 97.6%, Jack Flame 98.1% (fire tips
  at the top, founder-approved), Baal 89.8%. Every body planted (travel 0.00 uu, tilt <= 0.55 deg, arms <= 0.90 deg),
  head yaw ranges 11.4-21.0 deg beside the in-world Relay OG, canonical pose 0.18-0.21 s after each switch, 360 at a
  constant distance and back to the front. Relay OG in the world: QA Q09/Q10 PASS on RC8.
- Julius Live Terminal, RC7 vs RC8 (`film_rc7_terminal_core/`, `film_rc8_terminal_core/`, measured frames in
  `terminal_rc7_vs_rc8_core/`): the same mission moment and camera, the world outside the terminal unchanged (L78 both).
  The plates went from brown to near-black: header (109,82,49) L85 -> (35,28,19) L29; Julius section (75,58,33) L60 ->
  (22,18,12) L19; architect/coding/reviewer sections L55-60 -> L28-30 (-49 to -69% luma). The world still shows through,
  attenuated: the header's texture spread went from 10.5 to 3.4.
- Companion consoles after a colour change (B56, `film_rc8_b56_core/`): "WLUI chrome rebuilt for a colour change" and the
  new secondary saved before the consoles rose. Through the simulated mission both consoles show the same state and lines
  as the plain RC8 film at the same moments (ACTIVE · JOINED, simulated, no provider called). Clean film.
- Failed travel (`failed_travel_rc8_core/`, squeeze 0.7 s): 5 of 7 travels failed on purpose (streaming hard cap x3, no
  ground x2). Each returned the visitor to the start and said "Could not land safely at X; returned to where you were.";
  a later travel arrived, the route finished, graceful exit code 0.
- Perf, the game's own window, interleaved RC8 / RC7 / RC8 (`perf_rc8_core/`, `perf_rc7_backtoback_core/`,
  `perf_rc8_b_core/`), avg fps / worst frame:

  | phase | RC8 a (19:58) | RC7 (20:05) | RC8 b (20:10) |
  |---|---|---|---|
  | idle | 29.1 / 491 ms | 31.1 / 72 ms | 29.9 / 63 ms |
  | walk | 32.7 / 55 ms | 33.9 / 66 ms | 28.7 / 82 ms |
  | teleport | 27.6 / 129 ms | 28.3 / 116 ms | 22.9 / 124 ms |
  | map | 39.2 / 46 ms | 40.8 / 58 ms | 30.8 / 60 ms |
  | wardrobe | 33.1 / 88 ms | 34.1 / 86 ms | 26.2 / 111 ms |
  | contract | 29.5 / 91 ms | 31.3 / 87 ms | 26.2 / 124 ms |
  | creation | 28.8 / 61 ms | 30.7 / 48 ms | 25.5 / 60 ms |

  RC8 a sits 2-6% under RC7 (RC5's own two runs differed by up to 6%); RC8 b drifted lower everywhere after three heavy
  runs back to back; the 491 ms frame (the first frames of idle, beside two first-use PSO misses that RC5, RC7 and RC8
  log identically) did not recur. No regression attributable to RC8. Memory flat: peak working set ~2.43 GB, private
  ~6.55 GB, VRAM ~4.28 GB; 0 crashes; every travel arrived.
- Firewall: the never-run clean-user path raised Windows' prompt (README step 4: Cancel). A person answered it Allow at
  ~19:21; both RC8 paths now hold Allow/Public inbound rules. CORE changes no firewall rule.

### RC5 package evidence (CORE)

- Build: 0.1.0-rc5, commit 05e983d8, label "Private Beta 0.1.0-rc5 | build 05e983d8 | 2026-10-01", zip sha256
  0CFF42F5485E8AC125F1A0E7D13CB5C1C1131ACA208A79B6D71B7935207E8459, 667,445,474 bytes, 81 files. BuildCookRun 271 s.
- QA (`qa_rc5.log`): 58 PASS, 0 FAIL over three boots, no interference, QNET clean.
  - Q00.6: the window title carries the label.
  - Q22, the companion consoles during the simulated mission: 6 of 6 mark shapes in both, timer 0 -> 5 s over 5.0 s,
    lines 1 -> 7, verb red and pale, no status row in the history, the counter in lines, no Esc offered, SIMULATED in
    the mode and inset.
  - Q23: a scrolled-back view held 5 s with 5 new rows marked, then back to live.
  - Q24: both consoles settle after a stop.
- Films (`film_rc5_mission/`, `film_rc5_runtime/`; side-by-sides with the founder's reference in
  `console_acceptance_rc5/`). In the runtime film (developer session, the runtime's fixture-chat-slow):
  - session started; the prompt echoed; "Thinking… (0s · ↓ 0 chars)";
  - the answer streams in rising, "Responding… · ↓ 62 → 214 chars", then "Answered in 4s · 271 chars · SIMULATED";
  - "esc to interrupt" in the footer with the keyboard in the console; Esc through the real handler gives
    "✗ Interrupted · Cancelled part way through the answer." and "Stopped (1s)".
- Perf, the game's own window (borderless 1536x960, EPIC, HW RT), avg fps / worst frame:

  | phase | RC5 run 1 (fresh files) | RC5 run 2 | RC4 (same hour) |
  |---|---|---|---|
  | idle | 34.1 / 51 ms | 32.9 / 61 ms | 33.6 / 66 ms |
  | walk 30 s | 36.2 / 54 ms | 33.9 / 57 ms | 34.6 / 52 ms |
  | teleport x5 | 16.6 / 361 ms | 27.8 / 110 ms | 29.0 / 110 ms |
  | map x8 | 23.7 / 147 ms | 40.4 / 71 ms | 40.8 / 43 ms |
  | wardrobe x5 | 34.1 / 116 ms | 33.8 / 83 ms | 34.5 / 81 ms |
  | contract 60 s | 32.5 / 84 ms | 31.5 / 105 ms | 31.3 / 80 ms |
  | creation | 32.1 / 45 ms | 31.8 / 42 ms | 32.1 / 48 ms |

  RC5 = RC4: the consoles cost nothing measurable. The first run of a freshly unzipped package streams two to three times
  slower (B55). Teleports have been about 15% slower than RC3 since RC4's founder-approved Nanite material fix (D4).
  Memory is flat: peak working set ~2.47 GB, private ~6.6 GB, VRAM ~4.23 GB.
- Scan: the known P3 strings only (source paths and the developer service hint in the exe, OpenSSL text, a random "ghp_"
  byte run in .ucas data).

### RC4 package evidence (CORE + Second)

- Build: 0.1.0-rc4, source 3aa43e1f (label "Private Beta 0.1.0-rc4 | build 4debbacb"), zip sha256
  DB4491C6558C749FCD3F913782E2819F7D0D8AC5CB02B5CB33306FB5065ADF32, 667,392,685 bytes, 81 files.
- QA rerun on an idle laptop (`qa_rc4b.log`): 53 PASS, 1 FAIL over three boots. The FAIL is Q00.6, the window title
  (P3, B52). Q05 passed, so run1's earlier Q05 failure was a person at the keyboard. Every Flame Color check (Q01-Q01f),
  Q00.5 (D3), Q12 and Q21.1-Q21.7 passed. "missing usage flag Nanite": 0 in all three boots.
- Second's static review of RC4: the zip matches the manifest, the folder matches the zip 81/81, the scan is clean,
  the retired figures are gone, and B44 and D3 are correct.
- Second's RC4 clean-user pass, part 1: the MOTW exe raises "The publisher could not be verified" (README gap, B51).
  The first launch takes 25.8 s to WLBUILD and 34.4 s to LoadMap, cold. The welcome is correct at the borderless
  default, D3 shows on the HUD, there are 0 listening endpoints after settle, and the exit is clean.
  The interactive steps were paused when the founder returned.
- Second's RC4 seed matrix: R01 PASS (an RC3-sealed contracts file restores in RC4). It was stopped at R02 by a
  low-memory reaper and not resumed, because RC5 is certain.

### RC3 package evidence (CORE)

- Build: 0.1.0-rc3, commit 90c8d0fa, zip sha256 530A2AFBBB3134B8460DC556EDC8358131C28E21E3BB6319EA433756201A1D87,
  667,756,722 bytes, 97 files. Boots with no Niagara assert; the trace control port is closed ("WLBETA trace control
  port closed ... 777 ticks").
- QA (`qa_rc3.log`): 45 PASS, 0 FAIL across three boots -- 35 in the first (incl. Q17-Q20), 4 across the restart,
  5 on corrupted files (Q21.1-Q21.5) -- plus QNET: no listening socket.
- Perf (`perf_rc3_default/`), the game's own first-launch window (borderless 1536x960), EPIC, HW RT on:

  | phase | avg fps | p95 ms | 1% low fps | frames > 50 ms | max ms |
  |---|---|---|---|---|---|
  | idle | 34.5 | 33.1 | 26.2 | 0 | 45 |
  | travel (warm) | 33.3 | 36.9 | 27.0 | 0 | 37 |
  | walk 30 s | 37.5 | 31.6 | 28.1 | 0 | 38 |
  | teleport x5 | 33.8 | 46.6 | 13.6 | 8 | 86 |
  | map x8 | 38.2 | 34.6 | 17.7 | 6 | 63 |
  | wardrobe x5 | 51.7 | 26.1 | 20.6 | 3 | 58 |
  | contract 60 s | 33.4 | 34.9 | 22.5 | 7 | 55 |
  | creation | 30.0 | 38.2 | 25.2 | 0 | 40 |

  Peaks 2,584 MB working set / 6,703 MB private / 4,250 MB VRAM; machine free fell to 1,392 MB.
- Soak (`soak_rc3/`): quit from the menu at 18.7 min by a person at the laptop. Warm window 5-19 min: private
  6,389-7,087 MB (+340 MB/h), GPU 4,197-4,498 MB (+178 MB/h), working set trimmed (-1,643 MB/h). Inconclusive.

### RC2 package evidence (CORE)

- Build: 0.1.0-rc2, commit 24ea3e11 (local), zip sha256 5B1B87E20403AFF3190C6A9F91C4E8EF6D09AF9D28219F5DDC769ABE8DC73668,
  689,867,086 bytes. Release folder `_wonderland_beta_release/Wonderland_PrivateBeta_0.1.0-rc2`.
- QA: `qa_rc2.log` -- 35/35 PASS across two boots, exit 0, isolated -userdir.
- Perf (`perf_rc2/`): founder laptop (Core 7 240H, RTX 5060 Laptop 8 GB, 16 GB RAM, on AC), EPIC, hardware ray tracing
  on, 1920x1200 windowed requested = 1280x800 on the non-DPI-aware 1536x960 desktop. Startup 5.8 s engine start to world.

  | phase | avg fps | p95 ms | 1% low fps | frames > 50 ms | max ms |
  |---|---|---|---|---|---|
  | idle | 44.4 | 24.9 | 33.4 | 0 | 44 |
  | travel (warm) | 43.9 | 29.2 | 21.0 | 0 | 48 |
  | walk 30 s | 52.0 | 22.5 | 37.7 | 0 | 28 |
  | teleport x5 | 48.0 | 32.8 | 18.5 | 1 | 64 |
  | map x8 | 55.7 | 21.8 | 25.5 | 0 | 48 |
  | wardrobe x5 | 78.7 | 17.3 | 17.6 | 2 | 194 |
  | contract 60 s | 51.0 | 23.8 | 27.7 | 3 | 67 |
  | creation | 46.1 | 24.6 | 34.9 | 0 | 29 |

- Distribution: `rc2_import_closure.txt` (every DLL any shipped binary imports is shipped, an OS API set or an OS DLL;
  0 unresolved), `rc2_zip_listing.txt`, `rc2_pii_scan.txt`.

## Blockers

P0 prevents the beta launch or risks user data/security. P1 breaks a core flow or makes the beta unreliable. P2
survives a small private beta with a documented limitation. P3 is polish. Only P0 and P1 block 100%.

| id | P | area | problem | fix | status |
|---|---|---|---|---|---|
| B01 | P0 | creation | No UI turned a draft into a Mission Contract | terminal submit -> SubmitDraft (458f5448) | fixed; RC2 Q13 |
| B02 | P0 | distribution | VC++ runtime not packaged | -prereqs + app-local CRT (458f5448, 24ea3e11) | fixed; RC2 staged + closure |
| B03 | P1 | creation | No truthful state without Julius | beta sentence everywhere AI would run | fixed; RC2 Q00.3 |
| B04 | P1 | persistence | Contracts after the 6th lost on restart | restore all; limit 48; /tasks delete | fixed; RC2 Q14/Q15; RC3 Q20 (limit) |
| B05 | P1 | first launch / session | No in-game Quit; Esc did nothing | Esc opens the menu; QUIT with confirmation | fixed; static (Second to verify) |
| B06 | P1 | performance | No settings | SETTINGS page: quality, window, resolution scale, frame cap, HW RT | fixed; static (Second's matrix) |
| B07 | P1 | distribution | No build identity | BuildInfo label: title, menu, welcome, README, log | fixed; RC2 |
| B08 | P1 | debug exposure | Console, debug keys, `/pa` reachable | player lock-down; `/pa` developer-only | fixed; RC2 Q00.2; RC3 Q18 |
| B09 | P1 | truthfulness | Developer instructions and founder paths shown to players | beta text; dev hint behind -wldev | fixed; RC2 Q00.3 + static |
| B10 | P1 | input | Ctrl+W hijacked walking | binding removed | fixed; static |
| B11 | P1 | brand | "GPT 6 Astra" / "Claude Code Fable 5" on the HUD from boot (terminal titles, usage rows, the simulated mission's terminals, Project Brain samples) AND the Wonder Web sample pages styled as Instagram and Google (plus a store named after the retired "Arden"), reachable by players as B -> WONDER WEB -> Ctrl+W (Second, RC3; the ledger had wrongly called them unreachable) | founder decision D3: role names for testers; sample browsers developer-only | fixed in RC4; Q00.5 |
| B12 | P1 | persistence | Saves inside the package folder | InstalledProjectBuild.txt -> %LOCALAPPDATA% | fixed; RC1 created %LOCALAPPDATA%\Wonderland\Saved; Second's clean-user on RC2 |
| B13 | P1 | package content | Engine unlit material not cooked | always-cook | fixed; RC2 Q00.4 |
| B14 | P1 | package content | practical_lights.json not staged | NonUFS stage | fixed; RC2 Q00.4 (1,464 lamps) |
| B15 | P1 | error / recovery | Companion chat locked on any "sk-" | real key shapes only | fixed; static |
| B16 | P1 | privacy | Package shipped Saved/ with founder logs | fresh stage without Saved/ | fixed; RC2 zip listing + scan |
| B17 | P2 | first launch | Respawn net spawns an invisible pawn | README: Esc -> QUIT, start again (RC3) | documented |
| B18 | P1 | creation | Mission showcase console-only | WATCH A SIMULATED MISSION in Missions (J) | fixed; static on RC2; RC3 Q17 |
| B19 | P1 | first launch | No welcome / how-to-play | welcome card, reopenable | fixed; RC2 Q00.1 |
| B20 | P2 | first launch | Windows Firewall prompt (engine trace control listen) | README: please click Cancel (RC3); the port itself is B32 | documented |
| B21 | P2 | truthfulness | Idle strip claimed a simulated execution | truthful idle text | fixed; RC2 frames |
| B22 | P2 | placeholders | "NEEDS FOUNDER DEFINITION", unbuilt activities | truthful copy | fixed; static |
| B23 | P2 | truthfulness | Sample sub-agents (foreign terminal file) and sample Project Brain notes | Project Brain labels them sample data | open (documented) |
| B24 | P2 | robustness | Non-atomic saves; 1,024+ char ids crashed boots | atomic saves; IsSafeId | fixed; RC3 hostile boot Q21 |
| B25 | P2 | UI | A colour click rebuilds the HUD and clears the terminal transcript | -- | open |
| B26 | P3 | stability | Companion terminal can stick on STREAMING (foreign file) | the old terminal is no longer mounted (RC5): the console's stream ends with the runtime's turn | superseded in RC5 source |
| B27 | P2 | persistence | Saved and worn skin can diverge if a figure fails to load | -- | open |
| B28 | P2 | package hygiene | PDB, founder sheets, old sources shipped | release script excludes them | fixed; RC2 zip listing |
| B29 | P2 | creation | Proposals labelled NOT SYNCED though never saved | "NOT SAVED" + README (RC3) | fixed in RC3 source |
| B30 | P2 | input | No gamepad | README: keyboard and mouse (RC3) | documented |
| B31 | P3 | distribution | RC2 label "+local-changes" was a false positive (untracked Content, edited captures) | dirty check over tracked build folders (5d95aa40) | fixed for RC3 |
| B32 | P1 | security | TCP 1985 on every interface in a player session: the engine's unauthenticated trace control (SendTo streams the trace, log included, to any host) -- Second, RC2 | close it one frame after the engine opens it (TraceLog's Writer_ShutdownControl; player sessions only); QA samples listeners per boot (QNET) | **open on RC2; fixed in RC3 source** |
| B33 | P2 | distribution | Executables unsigned: SmartScreen on a downloaded zip | README "More info -> Run anyway" (RC3); signing needs a certificate (founder / external account) | documented |
| B34 | P1 | robustness | A corrupt contracts or command-presets .sav crashes EVERY boot: the engine's loader reads a class name and property names straight from the bytes. CONFIRMED on RC2: "FName's 1023 max length exceeded. Got 3000 characters" at frame 0 (`_wonderland_beta_release/before_rc2_presets/`). RC2's presets save was also non-atomic | sealed saves (tag + length + CRC-32), set aside when the seal fails; presets atomic too (RC3) | **open on RC2; fixed in RC3 source** |
| B35 | P3 | privacy | Logs hold the Windows user/computer name and user paths; deleting a contract logged its text | README tells testers (RC3); objective length only (RC3) | fixed in RC3 source |
| B36 | P2 | legal | NOTICES.txt credits FreeType only; the zip ships onnxruntime, libvorbis/libogg, tbb, MsQuic, WinPixEventRuntime, NVIDIA Aftermath, DirectML, D3D12 Agility SDK | founder / legal; Vulkan debug layers, GPU dump viewer and the ARM64 installer stripped (RC3) | open (founder/legal) |
| B37 | P3 | performance | One 194 ms frame when the wardrobe swaps a skin | -- | open |
| B38 | P3 | distribution | The exe holds source paths from assertion macros (C:\dev\iwonder\...) and the developer-only service hint text, never shown to players | -- | open |
| B39 | P2 | measurement | Perf ran in a 1280x800 window (the QA's window arguments), not the game's own first-launch window | perf script -DefaultWindow (RC3) | open until measured |
| B40 | P2 | settings | Exclusive FULLSCREEN came up as a 640x480 popup at 0,0: it asks the panel for 1536x960, a mode it does not have (Second's matrix) | SETTINGS offers BORDERLESS and WINDOWED only; a saved exclusive mode migrates to borderless at start (RC3) | fixed in RC3 source |
| B41 | P2 | truthfulness | The HUD shows "Julius 100% / Claude Code Fable 5 100% / GPT 6 Astra 100%" beside a welcome that says nothing is connected (Second) | player sessions show a dash and "NOT CONNECTED IN THIS BETA · NO USAGE MEASURED"; layout untouched (RC3) | fixed in RC3 source |
| B42 | P3 | privacy / logs | Thousands of "FORENSIC" and per-batch warnings in a player's log (Second) | developer sessions only; a material mismatch still logs for everyone (RC3) | fixed in RC3 source |
| B44 | P1 | founder requirement | Flame Color (founder, 2026-10-01): a separate FLAME row, independent of primary and secondary, on Jack Flame (head, paw, foot, tail flames), Skeleton Flame (spectral flames; skull, body, eyes untouched) and Baal (blue flame layer); hidden on Relay OG and Celestial Light. RC3's Jack fire still followed SECONDARY | figures tag their fire `flame`/`flame_light`; one global FLAME colour in its own file (no new config name); rows in Menu > COLORS and the Wardrobe; QA Q01-Q01f, Q12 and Q21.6-Q21.7. Cubs keep their own colours (EWonderlandBodyRole::SubAgent) | fixed in RC4 source |
| B45 | P1? | world in the package | 13 world material instances log "missing usage flag Nanite! Default Material will be used in game" (LeafMid, Water, the Tartarus and Icarus metals, GlassTeal, the Noctis set): their masters M_V2_Foliage / M_V2_Surface / M_V2_SurfaceHD were never saved with bUsedWithNanite, which the editor sets in memory every launch and a cooked build cannot | set the flag on the three masters and resave them: an editor (commandlet) write to the shared Content tree, so the founder's call | fixed in RC4 (founder D4): 0 warnings in all three RC4 boots |
| B46 | P3 | performance | SM_WL_VoxelCube is not cooked, so the package's figures use the engine's non-Nanite cube (the editor uses the Nanite one) | not cooked for RC4 on purpose: M_WL_EyeHalo and M_WL_Fire also lack the Nanite flag, so cooking the cube could turn parts of every skin default-grey | documented |
| B47 | P3 | logs | Territory markers log "NO GROUND FOUND, standing at z=0" at BeginPlay, before their cells stream | -- | open |
| B48 | P3 | package hygiene | The stage shipped retired figures (Apollo*, ArdenInfernal*, Bee, Hagoromo, SkeletonFlame, SkeletonFlameV1 and the Apollo/Arden cubs) | release script excludes them (RC4); sources kept | fixed in RC4 source |
| B43 | P2 | performance | An integrated-GPU laptop at the default EPIC quality may run short of memory (the iGPU probe was stopped by memory pressure) | README: integrated graphics -> QUALITY LOW first (RC3); no automatic default (untestable here) | documented |
| B49 | P1 | founder requirement | Companion terminals must match the Claude Code terminal experience (founder, 2026-10-01, reference IMG_2179.mov). Requirements: live rising output; an in-place status row with an animated emblem, a warm red-to-gold pulse, a live timer and truthful telemetry; follow-bottom scrolling with a new-output marker; prompt and footer; lifecycle lines; real state mapping; one reusable component; accepted on VIDEO | SWonderlandCompanionConsole + WonderlandCompanionWork; runtime and mission feeds; QA Q22-Q24; wl.Qa.ConsoleFilm (78fced42, 27b3f2d8, 05e983d8) | fixed in RC5: QA Q22-Q24 PASS and CORE's films; Second's video acceptance pending |
| B50 | P2 | truthfulness | Stopping a simulated mission (Missions panel, tests) never told the terminals: the companions stayed "working" with a live timer | StopFixture narrates the end (78fced42) | fixed in RC5; Q24 |
| B51 | P3 | distribution | README named only SmartScreen's dialog; a MOTW exe raises "The publisher could not be verified", and Smart App Control blocks unsigned apps outright (Second, RC4) | README lines (78fced42) | fixed in RC5 |
| B52 | P3 | distribution | The window title lost the build label: the engine writes its own title after the stamp (Q00.6, RC4) | the label is kept by a 1 s ticker (78fced42) | fixed in RC5; Q00.6 |
| B54 | P2 | truthfulness | The Julius Live Terminal shows "SIM TOKENS 312" during a simulated mission: an estimate (characters / 4), labelled SIM and explained in a tooltip, but a usage-looking number nothing produced (Second, RC5 film) | WonderlandLiveTerminal.cpp is the Julius lane's file, which CORE does not edit | open (founder / Julius lane) |
| B57 | P1 | session / soak | RC5's 60-minute soak passed (WLSOAK END PASS, 165 cycles, 0 crashes, memory flat), but its exit never finished. The log stops at ~FD3D12DynamicRHI; the process stayed alive, windowless and idle (WS 497 MB, private 1,104 MB, VRAM 415 MB) until the soak script killed it 10 minutes later. Minidump + stacks symbolised against the matching PDB (`soak_rc5/hang/`): the main thread is in ~FTaskGraphCompatibilityImplementation joining a worker (FThread::Join) blocked on a mutex. No Wonderland code runs background tasks: it is the engine's teardown. Short sessions exit cleanly | WonderlandBeta::ArmExitWatchdog (144d2e21): on OnEnginePreExit a plain OS thread ends a teardown still running after 20 s (exit code 0); the graceful exit runs first and everything is saved when made. Proved by wl.Qa.HangOnExit: a 60 s exit hang ended ~21 s in | open on RC5; fixed in RC6 source; RC6 soak pending |
| B58 | P3 | diagnostics | A fired exit watchdog looks like a clean exit (code 0, no marker); only the missing "Log file closed" line shows it (Second) | a raw-Win32 Saved/Logs/ExitWatchdog.txt marker before TerminateProcess, in any RC7 | open |
| B59 | P3 | measurement | The soak's "worst frame" (2,171 ms on RC5) counts the startup frame read when wl.Qa.Soak arms; the worst frame in play was 151 ms | count from WLPERF BEGIN and name the cycle step, in any RC7 | documented |
| B60 | P3 | window | SETTINGS -> WINDOWED at the desktop resolution (1920x1200 here) keeps a 1920x1200 client: the window (-10,-39 1940x1249 on RC8) has its title bar above the screen, so it cannot be dragged, and its bottom ~48 px under the taskbar. The switch, input, focus, minimize and quit all work (`drive_rc8_b_core/`) | a windowed size that fits the work area (e.g. 80% of it), centred | documented |
| B61 | P3 | measurement | QNET reads every boot once at ~30 s after launch; RC8's first-ever launch spent 16 s before its log opened (B55), so the trace port's normal ~2 s opening fell on the reading (run1 FAIL; five later boots PASS) | time the reading from the game's own "Control listening on port 1985" + 5 s (or sample until the closing window ends), so a slow first start cannot place it inside the opening | documented |
| B55 | P3 | performance | The first run of a freshly unzipped package hitches while streaming: teleports worst 361 ms and map 147 ms on RC5's first run, against 110 ms and 71 ms on its second (new files scanned, caches cold) | -- | documented |
| B53 | P2 | dependency | A companion doing a REAL task needs a provider the founder connects. On this laptop OpenAI has no key and Claude Code is installed but not allowed. The runtime's development providers answer SIMULATED | the console labels the runtime's mode; the REAL-provider video waits for the founder | founder decision |

## Founder decisions

- **D1, creation loop without production Julius: settled by the founder's direction** ("Do not fake unavailable Julius
  production functionality"). The beta offers a truthful LOCAL loop: create a contract, see it queued and persisted,
  delete it, watch a clearly SIMULATED mission, use the Wonder Web sample canvas. Real AI results stay Julius's lane.
- **D2, multiplayer and private/project spaces: SUPERSEDED for multiplayer by D9 (2026-10-02).** It read: "to the extent
  included in the beta", "as implemented; do not invent future systems"; the beta was single-player. R6 still verifies
  that nothing promises what is not there; the single-player wording in the welcome changes when R16 lands.
- **D9, WONDERLAND IS MULTIPLAYER BEFORE LAUNCH: DECIDED 2026-10-02 (founder correction).** Multiplayer/social is a launch
  gate for private alpha, public alpha, private beta, public beta and public launch; there is no single-player-only
  launch. R16 = the minimum launch loop end to end, weight 25 (founder's choice), the other weights x0.75. Social is
  ACTIVE and HIGH PRIORITY (Second owns development; CORE integrates verified milestones into canonical). RC10 (Shadow
  Flame) may proceed, but a later pre-launch RC must contain the completed foundation. Synthetic users are QA fixtures
  only.
- **D3, third-party names for outside testers: DECIDED 2026-10-01** -- "Role names for testers" (player builds show
  LLM COMPANION and JHINN; canon names stay in development) and sample browser windows "Developer-only". Shipped in RC4
  (Q00.5).
- **D4, the world materials' Nanite flag (B45): DECIDED 2026-10-01** -- "Approve the resave". Done by a headless editor
  run; shipped in RC4 (0 warnings).
- **D5, a REAL provider behind a companion (B53): OPEN, the founder's call.** The founder's acceptance asks for "a
  companion actively performing a real task". On this laptop the runtime's real providers are not connected (OpenAI:
  no key; Claude Code: installed, not allowed to run), so the runtime film uses its development provider and says
  SIMULATED. Connecting a provider is a credential or spending decision CORE does not make.
- **D6, the Julius lane's Project Brain adapter: OPEN, the founder's call.** Second Julius offered
  `local/wonderland-project-brain-client @ 0da34542` (Wonderland's Project Brain panel reading and writing a Julius
  backend once paired). It is unbuilt and untested in Unreal and would change the beta's scope (the README calls the
  Project Brain entries samples). Options: a later beta RC, or a scratch build only.
- **D7, SIM TOKENS in the Julius Live Terminal (B54): OPEN, the founder's or the Julius lane's call.** Keep, change to a
  truthful unit (lines printed, as the companion consoles count), or drop. CORE does not edit that file.
- **D8, the mission strip's line for players: confirm.** "MISSION · EVENT · STATE · CHAKRA · STATUS" is shown in
  player sessions with event ids (e.g. `mission.contract.locked (applied)`, `full_lifecycle 2/22`). The source says the
  founder asked for these five; Second flags them as developer telemetry (P3). Kept until the founder says otherwise.

