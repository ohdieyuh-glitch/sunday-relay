# Wonderland private-beta readiness ledger

**Owner: CORE** (implementation, integration, packaging, primary verification). **Second Wonderland** falsifies
independently; its evidence lives in `_qa_handoff/zs_captures/`. Julius is out of scope for this ledger: Julius
readiness (accepted 82.00% on main 7c584df2) is a separate gate owned by JUJU + Second Julius and is never folded in.

Founder direction, 2026-09-30: drive Wonderland from its verified engineering state (43/43) to TRUE 100%
private-beta readiness. 100% only when every P0 and P1 is closed, ONE release candidate (RC) is built, and that same RC
passes the clean-user test, persistence/restart, the core creation flow, session flow (to the extent in the beta),
error/recovery, performance and memory, distribution, security/privacy and soak, and Second Wonderland signs it off.

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

## Ledger (as of RC2, CORE's own evidence; Second's RC2 pass in progress)

| # | Requirement | Weight | Credit | Evidence (RC2 = 0.1.0-rc2, 24ea3e11) | Weakest part / open blockers |
|---|---|---|---|---|---|
| R1 | Environmental world complete (locked, 25/25) | 8 | 0.75 | WORLD_COMPLETION_MATRIX.md; RC2 QA Q02-Q08 travel/map/teleports PASS; perf travel 0.9-1.2 s | -- |
| R2 | Gameplay regression G1-G7 (locked, 18/18) | 8 | 0.75 | RC2 QA Q09-Q11 (Jack's contract from the rim, heights, four skins' contracts) PASS | -- |
| R3 | First launch: clean start, spawn, Relay Dog init, clear path in, no developer knowledge | 8 | 0.5 | RC2 Q00.1 welcome on a fresh profile (frame 00_first_launch), Q00.2 no console/debug keys/Gameplay Debugger; prerequisites staged + app-local CRT + static import closure (0 unresolved) | B05 (Esc / QUIT) verified statically only |
| R4 | Core creation loop, truthful about Julius | 12 | 0.5 | RC2 Q13 eight contracts through + and the terminal; Q14 all restored; Q15 deleted through the terminal; Q00.3 AI offline with the beta sentence | B18 simulated-mission control static on RC2 (RC3 Q17); contract limit static (RC3 Q20) |
| R5 | Session stability: launch / quit / relaunch, focus loss, window changes (single-player) | 3 | 0 | RC2: three clean boots and quits (QA x2, perf) | focus loss and window-mode changes not yet verified (Second's matrix) |
| R6 | Private/project space and project avatar flow, as implemented | 3 | 0.5 | nothing to test: no networking, sessions or private spaces exist (D2); welcome says single-player (RC2 frame); world map says PLANNED ... NOT IN THIS BETA; `/pa` refused for players (static) | `/pa` refusal static on RC2 (RC3 Q18) |
| R7 | Wonder Web and every beta-facing screen: no dead buttons or placeholders, no debug exposure, back/close/Esc, sane errors | 8 | 0 | RC2 Q00.2/Q00.3; frames | **B11 open (founder D3)** |
| R8 | Save / persistence across quit, relaunch, interruption | 8 | 0.5 | RC2 Q12/Q14/Q16/Q15 across a restart; atomic saves (static) | interruption/corruption static on RC2 (RC3 hostile boot Q21); B34 |
| R9 | Error / recovery: services absent, timeouts, failed travel / load, bad input, corrupt files | 7 | 0.5 | RC2 Q00.3 (services absent); bad-input guards and corrupt-file handling static | bad input (RC3 Q19) and corrupt files (RC3 Q21) static on RC2; B34 |
| R10 | Performance on the founder's laptop, measured in the package | 7 | 0.5 | RC2 wl.Qa.Perf (below) | default first-launch window not measured (B39); Settings (B06) static |
| R11 | Memory pressure: long-session growth, repeated skins / teleports / contracts / map / relaunch | 6 | 0 | RC2 perf: peaks 2,590 MB WS / 6,688 MB private / 4,206 MB VRAM over 3 min | soak not run |
| R12 | Package / distribution: clean artifact, prerequisites, no machine paths, size, README, version visible | 7 | 0.75 | RC2 zip: 176 entries, no Saved/ PDB _reference _previous _old .gitignore manifests; vc_redist + app-local CRT, closure 0 unresolved; 0.64 GB zip; README; label on welcome/menu/title | P2: B33 unsigned; P3: B31, B38 |
| R13 | Security / privacy baseline | 5 | 0 | RC2 scan: no user/computer name, e-mail, secret or founder log anywhere (ASCII + UTF-16, every file); AI clients off in player sessions (Q00.3) | **B32 open on RC2 (P1: TCP 1985 listener)**, fixed in RC3 |
| R14 | Crash / soak on the package | 4 | 0 | -- | not run |
| R15 | Clean-user test on the RC (no saves, no console, no developer knowledge) | 6 | 0 | Second's RC2 clean-user test in progress | -- |
| | **Total** | **100** | | | |

**WONDERLAND BETA READINESS: 39.75%** (RC2, 2026-10-01). R1 6 + R2 6 + R3 4 + R4 6 + R6 1.5 + R8 4 + R9 3.5 + R10 3.5 +
R12 5.25. The earlier informal "about 52%" counted rows whose parts were only partly verified; the weakest-part rule
above does not, and Second's 1985 finding holds R13 at 0 on RC2.

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
| B11 | P1 | brand | "GPT 6 Astra" / "Claude Code Fable 5" on the HUD from boot (terminal titles, usage bars, Project Brain samples). The Instagram/Google-styled Wonder Web pages are no longer reachable by players (their only entries were Ctrl+W and Julius browsing) | founder decision D3 | **open (founder)** |
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
| B26 | P3 | stability | Companion terminal can stick on STREAMING (foreign file) | unreachable in player sessions (companions offline) | open |
| B27 | P2 | persistence | Saved and worn skin can diverge if a figure fails to load | -- | open |
| B28 | P2 | package hygiene | PDB, founder sheets, old sources shipped | release script excludes them | fixed; RC2 zip listing |
| B29 | P2 | creation | Proposals labelled NOT SYNCED though never saved | "NOT SAVED" + README (RC3) | fixed in RC3 source |
| B30 | P2 | input | No gamepad | README: keyboard and mouse (RC3) | documented |
| B31 | P3 | distribution | RC2 label "+local-changes" was a false positive (untracked Content, edited captures) | dirty check over tracked build folders (5d95aa40) | fixed for RC3 |
| B32 | P1 | security | TCP 1985 on every interface in a player session: the engine's unauthenticated trace control (SendTo streams the trace, log included, to any host) -- Second, RC2 | close it one frame after the engine opens it (TraceLog's Writer_ShutdownControl; player sessions only); QA samples listeners per boot (QNET) | **open on RC2; fixed in RC3 source** |
| B33 | P2 | distribution | Executables unsigned: SmartScreen on a downloaded zip | README "More info -> Run anyway" (RC3); signing needs a certificate (founder / external account) | documented |
| B34 | P2 | robustness | A corrupt contracts or command-presets .sav could crash every boot: the engine's loader reads a class name and property names straight from the bytes (FName > 1,023 chars is fatal) | sealed saves (tag + length + CRC-32), set aside when the seal fails; presets now atomic too (RC3) | fixed in RC3 source; Second testing RC2 "before" |
| B35 | P3 | privacy | Logs hold the Windows user/computer name and user paths; deleting a contract logged its text | README tells testers (RC3); objective length only (RC3) | fixed in RC3 source |
| B36 | P2 | legal | NOTICES.txt credits FreeType only; the zip ships onnxruntime, libvorbis/libogg, tbb, MsQuic, WinPixEventRuntime, NVIDIA Aftermath, DirectML, D3D12 Agility SDK | founder / legal; Vulkan debug layers, GPU dump viewer and the ARM64 installer stripped (RC3) | open (founder/legal) |
| B37 | P3 | performance | One 194 ms frame when the wardrobe swaps a skin | -- | open |
| B38 | P3 | distribution | The exe holds source paths from assertion macros (C:\dev\iwonder\...) and the developer-only service hint text, never shown to players | -- | open |
| B39 | P2 | measurement | Perf ran in a 1280x800 window (the QA's window arguments), not the game's own first-launch window | perf script -DefaultWindow (RC3) | open until measured |

## Founder decisions

- **D1, creation loop without production Julius: settled by the founder's direction** ("Do not fake unavailable Julius
  production functionality"). The beta offers a truthful LOCAL loop: create a contract, see it queued and persisted,
  delete it, watch a clearly SIMULATED mission, use the Wonder Web sample canvas. Real AI results stay Julius's lane.
- **D2, multiplayer and private/project spaces: settled by the founder's direction** ("to the extent included in the
  beta", "as implemented; do not invent future systems"). None exists in the code; the beta is single-player, R5 covers
  single-player session stability and R6 verifies that nothing promises what is not there.
- **D3, third-party names for outside testers: OPEN, the founder's call (B11, P1).** Testers see "GPT 6 Astra" and
  "Claude Code Fable 5" on the HUD from the first frame (terminal titles, usage bars, two Project Brain sample lines),
  next to OFFLINE / "not connected in this beta build". Options: keep them for an invite-only beta; or show the role
  names (LLM COMPANION, JHINN) in player builds only, leaving the canon names untouched in development; or rename in
  canon. A config/text change either way; CORE does not change companion canon unilaterally.
