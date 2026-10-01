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
| 0 | any P0/P1 in the row is open, or nothing is verified |
| 0.5 | verified only in the editor or by static audit |
| 0.75 | verified on a packaged build that is not the final RC |
| 1.0 | verified on the FINAL RC by CORE **and** independently by Second Wonderland on that same RC |

**Readiness = sum of weight x credit.** Second's independent sign-off on the RC is therefore built into every 1.0.

## Ledger

| # | Requirement | Weight | Credit | Evidence | Open blockers | Build tested |
|---|---|---|---|---|---|---|
| R1 | Environmental world complete (locked, 25/25) | 8 | 0.75 | WORLD_COMPLETION_MATRIX.md; packaged boots | -- (re-confirm on the RC: content unchanged + boot) | package 4b69df20 |
| R2 | Gameplay regression G1-G7 (locked, 18/18) | 8 | 0.75 | package QA v2 27/27; Second zs_07-zs_11 | -- (re-run package QA on the RC) | package 4b69df20 |
| R3 | First-launch experience: clean start, spawn, Relay Dog init, clear path in, no developer knowledge | 8 | 0 | audits 2026-09-30 | B02, B05, B19, B08 | -- |
| R4 | Core creation loop, truthful about Julius | 12 | 0 | audit 2026-09-30 | B01, B03, B04, B18 | -- |
| R5 | Session stability: launch / quit / relaunch, focus loss, window changes (single-player scope, see D2) | 3 | 0 | -- | B05 | -- |
| R6 | Private/project space and project avatar flow, as implemented (see D2: not implemented) | 3 | 0 | audit: no private/project space exists; Project Avatars only via `/pa` | D2 | -- |
| R7 | Wonder Web and every beta-facing screen: no dead buttons or placeholders, no debug exposure, back/close/Esc, sane errors | 8 | 0 | audits 2026-09-30 | B08, B09, B10, B11, B22 | -- |
| R8 | Save / persistence across quit, relaunch, interruption | 8 | 0 | audit 2026-09-30 | B04, B12, B24 | -- |
| R9 | Error / recovery: services absent, timeouts, failed travel / load, bad input, corrupt files | 7 | 0 | audit 2026-09-30 | B09, B15, B24 | -- |
| R10 | Performance on the founder's laptop, measured in the package | 7 | 0 | Second's baseline: boot ~21 s; 2.5 GB WS / 6.4 GB private / 4.05 GB VRAM at 60 s | B06 | -- |
| R11 | Memory pressure: long-session growth, repeated skins / teleports / contracts / map / relaunch | 6 | 0 | -- | (unmeasured) | -- |
| R12 | Package / distribution: clean artifact, prerequisites, no machine paths, size, README, version visible | 7 | 0 | Second's audit 2026-09-30 | B02, B07, B12, B16, B31 | -- |
| R13 | Security / privacy baseline | 5 | 0 | Second: no secrets in loose files, paks or binary; AI clients loopback-only | B16 (founder logs and identity shipped) | package 4b69df20 |
| R14 | Crash / soak on the package | 4 | 0 | -- | (not run) | -- |
| R15 | Clean-user test on the RC (no saves, no console, no developer knowledge) | 6 | 0 | Second's baseline in progress | (RC needed) | -- |
| | **Total** | **100** | | | | |

**WONDERLAND BETA READINESS: 12%** (2026-09-30 evening; R1 6 + R2 6). The 43/43 engineering verification is real
and counted, but every other row has open P0/P1 blockers or is unmeasured.

## Blockers

P0 prevents the beta launch or risks user data/security. P1 breaks a core flow or makes the beta unreliable. P2
survives a small private beta with a documented limitation. P3 is polish. Only P0 and P1 block 100%.

| id | P | area | problem | where | fix | status |
|---|---|---|---|---|---|---|
| B01 | P0 | creation | No UI turns a draft task into a Mission Contract; only `wl.Tasks.Submit` (console) does. Old tests submitted from Python. | WonderlandUiSubsystem.cpp:2557-2692 (dead MountTaskAddControl), :3978-3998; WonderlandLiveTerminal.cpp:324 | wire the terminal input to SubmitDraft when a draft tab is selected; truthful queued state | open |
| B02 | P0 | distribution | VC++ runtime prerequisites not packaged (`-prereqs` missing): a clean PC may not launch | package.log line 1 | `-prereqs` in the RC build; verify UEPrereqSetup_x64.exe staged | open |
| B03 | P1 | creation | Nothing runs and no result returns without Julius; Julius pairing is console-only, no bridge address ships | WonderlandJuliusStream.cpp:1167-1215; DefaultGame.ini (no BridgeUrl) | truthful "Julius is not available in this beta" states; result path stays Julius-gated (D1) | open |
| B04 | P1 | persistence | Contracts after the 6th are silently lost on restart (restore stops at 6; next save rewrites the subset) | WonderlandMissionTasks.cpp:317-322, 267-286 | restore all; bound creation; add delete/cancel | open |
| B05 | P1 | first launch / session | No in-game Quit; Esc does nothing in the world; fullscreen with captured mouse | WonderlandHudPanels.cpp:714-722 | QUIT row with confirmation; Esc opens the menu | open |
| B06 | P1 | performance | No settings: quality, resolution, window mode; HW ray tracing + Lumen forced, so weak GPUs / 16 GB laptops cannot lower load | DefaultEngine.ini:36-44 | Settings tab: quality preset, window mode, resolution, ray tracing on/off; persisted | open |
| B07 | P1 | distribution | No build identity anywhere (no ProjectVersion, default window title) | DefaultGame.ini:3-7 | stamp version + commit at package time; window title, Menu, log line | open |
| B08 | P1 | debug exposure | Console (\`), engine debug view keys (F1/F2/F5/;), state-wiping `wl.*` commands, `/pa` (95k boxes) reachable by testers | DefaultInput.ini; BaseInput.ini:16,39-54; WonderlandUiSubsystem.cpp:3916 | clear console and debug keys; gate `/pa`; keep QA via -ExecCmds | open |
| B09 | P1 | truthfulness | Players are shown developer instructions with a founder path: `cd C:\dev\iwonder\julius-connect && npm run julius-connect:dev` | WonderlandJuliusConnect.cpp:541,617-618; WonderlandJuliusConnectPanel.cpp:454-465; WonderlandSidekicks.cpp:311-312; WonderlandWonderWebLive.cpp:402 | plain "not available in this beta build" text; dev hint behind a dev flag | open |
| B10 | P1 | input | Ctrl is Walk, and Ctrl+W (priority 100) opens a Wonder Web window: walking + W hijacks the camera | WonderlandUiSubsystem.cpp:227-231; RelayDogCharacter.cpp:1314 | move the chord off Ctrl+W; confirm at runtime | open |
| B11 | P1 | brand | Third-party brand names on the HUD from boot ("GPT 6 Astra", "Claude Code Fable 5") and Wonder Web sample pages styled as Instagram / Google | DefaultGame.ini:124,130; UiArt/WonderWeb/wonder-web-browse.json | founder decision D3 | open (founder) |
| B12 | P1 | persistence / distribution | Saves live inside the package folder: every new beta drop resets the player; a read-only install loses saves silently | Paths.cpp:183-191 (engine) | ship `Engine/Build/InstalledProjectBuild.txt` so saves and logs go to %LOCALAPPDATA%\Wonderland | open |
| B13 | P1 | package content | `/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial` is not cooked: mission orb colours, the Dog's beam and props, the wardrobe backdrop fall back to the default material in the package | WonderlandMissionOrb.cpp:18 and 4 more; package log | always-cook that engine directory (or a project copy) | open |
| B14 | P1 | package content | `WorldDesign/Look/practical_lights.json` is not staged: the package's night has no street lamps (the founder-locked approved night) | WonderlandPracticalLights.cpp:62; DefaultGame.ini:51-58 | stage `../WorldDesign/Look` as NonUFS | open |
| B15 | P1 | error / recovery | Companion chat locks OFFLINE when any reply contains "sk-" ("task-", "risk-", "ask-"): the secret filter is a case-insensitive Contains | WonderlandSidekicks.cpp:325; WonderlandJuliusConnect.cpp:352 | match real key shapes only | open |
| B16 | P1 | privacy / clean user | The QA'd package folder ships `Saved/`: founder logs (user "Kaisi", computer, C:/dev paths), screenshots, configs, jack_flame and found territories | `_wonderland_package_regression_0930/Windows/Wonderland/Saved` | release script builds the artifact from a fresh stage without Saved/ | open |
| B17 | P2 | first launch | The respawn net spawns AWonderlandDogPawn (no mesh, no movement): an invisible frozen camera | WonderlandHubGameMode.cpp:12,52; WonderlandDogPawn.cpp:35-77 | DefaultPawnClass = the Relay Dog | open |
| B18 | P1 | creation | The mission showcase (the Dog's Mission Contract acts) starts only from the console | WonderlandMissionSubsystem.cpp:167-185 | a labelled "watch a simulated mission" control (D1) | open |
| B19 | P1 | first launch | No welcome or how-to-play: a stranger cannot tell what works (walk, M map teleport, B wardrobe, Tab menu) | audit; WonderlandUiSubsystem.cpp:4864-4911 only a territory banner | first-launch welcome card, reopenable from the Menu | open |
| B20 | P2 | first launch | Windows Firewall prompt at ~20 s: Unreal Insights trace control (port 1985, bound 0.0.0.0, compiled into the installed engine) + UdpMessaging | Second's baseline; TraceLog Control.cpp | disable UdpMessaging transport; README explains the prompt (Cancel is safe) | open |
| B21 | P2 | truthfulness | Idle HUD strip claims "SIMULATED JULIUS EXECUTION ... MISSION none ... no fixture" when nothing runs | WonderlandMissionSubsystem.cpp:541-556 | truthful idle text, layout kept | open |
| B22 | P2 | placeholders | "NEEDS FOUNDER DEFINITION"; "AVAILABLE ACTIVITIES" lists unbuilt things ("Multiplayer testing"); "Framed by the camera Wonderland placed to look at it." | WonderlandWorldMap.cpp:1424,1462; DefaultGame.ini:81-87,182-184 | truthful copy | open |
| B23 | P2 | truthfulness | Hard-coded sub-agents "Scout-01 / Forge-02 / ..." in the terminal; Project Brain sample = internal founder notes | WonderlandLiveTerminal.cpp:532; WonderlandProjectBrain.cpp:122-185 | label as samples / neutral sample text | open |
| B24 | P2 | robustness | No save is atomic; a truncated .sav restores partial state; a 1,024+ char skin id or territory line crashes every boot (FName checkf) | WonderlandRelaySkins.cpp:236,256; WonderlandTerritory.cpp:275,288; WonderlandMissionTasks.cpp | temp + move writes; length caps; check write results | open |
| B25 | P2 | UI | Every colour click rebuilds the HUD and wipes the Julius and companion transcripts | WonderlandMascotStyle.cpp:258-277; WonderlandUiSubsystem.cpp:4762-4792 | refresh in place | open |
| B26 | P2 | stability | Companion terminal can stick on STREAMING (ClearLines leaves Reveal) | WonderlandCompanionTerminal.cpp:543-549 | reset Reveal | open |
| B27 | P2 | persistence | Saved skin and worn skin can diverge if a figure fails to load | WonderlandRelaySkins.cpp:166-169 | save after a successful wear | open |
| B28 | P2 | package hygiene | 380 MB PDB, `RelaySkins/_reference` (founder sheets), `_previous` (old generator source), `ProjectAvatars/_old`, .gitignore shipped | Manifest_NonUFSFiles_Win64.txt | release script excludes them | open |
| B29 | P2 | creation | Pixel Canvas and Project Brain proposals are lost on restart, labelled "NOT SYNCED" rather than "not saved" | WonderlandWonderWeb.h:193-206; WonderlandProjectBrainPanel.cpp:1114 | persist, or say "not saved" | open |
| B30 | P2 | input | No gamepad bindings despite the "gamepad first-class" comment; no rebinding | RelayDogCharacter.cpp:1255-1365 | document keyboard + mouse for the beta | open |

## Founder decisions (genuine product calls; work continues around them)

- **D1, creation loop without production Julius.** Wonderland can offer a truthful LOCAL loop: create a contract,
  see it queued and persisted, reopen and delete it, watch a clearly-SIMULATED mission showcase, use the
  Wonder Web canvas. Every Julius-dependent step ("run it", "receive an AI result") says plainly that Julius is not
  available in this beta. A real AI result needs Julius production qualification plus a hosted bridge (JUJU's lane).
  CORE proceeds with the truthful local loop; the founder can require real Julius results for 100%.
- **D2, multiplayer and private/project spaces.** No networking, replication, sessions, private servers or server
  avatars exist in the code. The beta is single-player; R5 covers single-player session stability, and R6 records that
  no private/project space exists to test.
- **D3, third-party brand names for outside testers.** "GPT 6 Astra" and "Claude Code Fable 5" on the HUD, and Wonder
  Web sample pages styled as Instagram and Google. Rename or neutralize for the beta? This touches companion canon,
  so CORE does not change it unilaterally.
