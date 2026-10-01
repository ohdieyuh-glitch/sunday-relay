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

## Ledger (as of RC3: CORE's evidence; Second's RC3 pass in progress)

| # | Requirement | Weight | Credit | Evidence (RC3 = 0.1.0-rc3, 90c8d0fa) | Weakest part / open blockers |
|---|---|---|---|---|---|
| R1 | Environmental world complete (locked, 25/25) | 8 | 0.75 | WORLD_COMPLETION_MATRIX.md; RC3 QA Q02-Q08 travel/map/teleports PASS | **B45 candidate**: 13 world materials fall back to the engine's default material in the package (if it is visible it is a P1 and R1 drops to 0) |
| R2 | Gameplay regression G1-G7 (locked, 18/18) | 8 | 0.75 | RC3 QA Q09-Q11 PASS | -- |
| R3 | First launch: clean start, spawn, Relay Dog init, clear path in, no developer knowledge | 8 | 0.75 | RC3 Q00.1 welcome, Q00.2 lock-down; prerequisites + closure (0 unresolved); Esc -> menu -> QUIT used for real in the RC3 soak ("WLUI quit chosen from the menu", clean exit) | -- |
| R4 | Core creation loop, truthful about Julius | 12 | 0.5 | RC3 Q13 eight contracts through + and the terminal, Q14 restored, Q15 deleted, Q17 the simulated mission plays and says SIMULATED, Q20 limit 48 | the WATCH A SIMULATED MISSION button itself is only statically verified (Q17 makes the same call) |
| R5 | Session stability: launch / quit / relaunch, focus loss, window changes (single-player) | 3 | 0 | RC3: four clean boots and quits; the menu QUIT works | focus loss not yet verified; RC3's two window modes (B40 fix) not yet verified in a package |
| R6 | Private/project space and project avatar flow, as implemented | 3 | 0.75 | nothing to test (D2); RC3 Q18 `/pa` changes nothing in a player session; welcome says single-player | -- |
| R7 | Wonder Web and every beta-facing screen: no dead buttons or placeholders, no debug exposure, back/close/Esc, sane errors | 8 | 0 | RC3 Q00.2/Q00.3; frames | **B11 open (founder D3)**; **B44 open on RC3** (Flame Color, fixed in RC4 source) |
| R8 | Save / persistence across quit, relaunch, interruption | 8 | 0.75 | RC3 Q12/Q14/Q16/Q15 across a restart; Q21.1-Q21.5 a third boot on corrupted files: no crash, bad files set aside, next save sealed | -- |
| R9 | Error / recovery: services absent, timeouts, failed travel / load, bad input, corrupt files | 7 | 0.5 | RC3 Q00.3 services absent, Q19 bad terminal input, Q21 corrupt files | failed travel / load verified in the editor only (travel timeout squeeze proof) |
| R10 | Performance on the founder's laptop, measured in the package | 7 | 0.75 | RC3 perf in the game's own window (borderless 1536x960, EPIC, HW RT): 30-52 fps averages, no frame > 100 ms (table below); Second's RC2 matrix: every SETTINGS choice applies | -- |
| R11 | Memory pressure: long-session growth, repeated skins / teleports / contracts / map / relaunch | 6 | 0 | RC3 soak stopped at 18.7 min by someone at the laptop (menu QUIT): private +340 MB/h over 14 warm minutes, inside ~700 MB place-to-place swings -- INCONCLUSIVE | a full 60-minute soak |
| R12 | Package / distribution: clean artifact, prerequisites, no machine paths, size, README, version visible | 7 | 0.75 | RC3 zip: 97 files, 0.62 GB, sha256 530A2AFB...1D87; closure 0 unresolved; no Saved/PDB/sources/Vulkan layers; clean label "build 90c8d0fa" | P2: B33 unsigned, B36 notices; P3: B38, B48 |
| R13 | Security / privacy baseline | 5 | 0.75 | RC3: no listening socket in a player session (QNET, and a manual sample 35 s into the perf run); scan: no names, e-mails or secrets; AI off (Q00.3) | -- |
| R14 | Crash / soak on the package | 4 | 0 | 0 crashes across 3 QA boots, perf and 18.7 soak minutes | a full 60-minute soak |
| R15 | Clean-user test on the RC (no saves, no console, no developer knowledge) | 6 | 0 | Second's RC3 clean-user pass waits for an idle laptop | -- |
| | **Total** | **100** | | | |

**WONDERLAND BETA READINESS: 50.0%** (RC3, 2026-10-01). R1 6 + R2 6 + R3 6 + R4 6 + R6 2.25 + R8 6 + R9 3.5 + R10 5.25 +
R12 5.25 + R13 3.75. RC3 is not the final RC: the founder's Flame Color (B44) needs RC4, and every row is re-earned
there. If B45 proves visible, R1 is 0 and RC3 reads 44.0%.

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
| B11 | P1 | brand | "GPT 6 Astra" / "Claude Code Fable 5" on the HUD from boot (terminal titles, usage rows, the simulated mission's terminals, Project Brain samples) AND the Wonder Web sample pages styled as Instagram and Google (plus a store named after the retired "Arden"), reachable by players as B -> WONDER WEB -> Ctrl+W (Second, RC3; the ledger had wrongly called them unreachable) | founder decision D3 | **open (founder)** |
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
| B45 | P1? | world in the package | 13 world material instances log "missing usage flag Nanite! Default Material will be used in game" (LeafMid, Water, the Tartarus and Icarus metals, GlassTeal, the Noctis set): their masters M_V2_Foliage / M_V2_Surface / M_V2_SurfaceHD were never saved with bUsedWithNanite, which the editor sets in memory every launch and a cooked build cannot | set the flag on the three masters and resave them: an editor (commandlet) write to the shared Content tree, so the founder's call | **classification pending Second's package frames** |
| B46 | P3 | performance | SM_WL_VoxelCube is not cooked, so the package's figures use the engine's non-Nanite cube (the editor uses the Nanite one) | not cooked for RC4 on purpose: M_WL_EyeHalo and M_WL_Fire also lack the Nanite flag, so cooking the cube could turn parts of every skin default-grey | documented |
| B47 | P3 | logs | Territory markers log "NO GROUND FOUND, standing at z=0" at BeginPlay, before their cells stream | -- | open |
| B48 | P3 | package hygiene | The stage shipped retired figures (Apollo*, ArdenInfernal*, Bee, Hagoromo, SkeletonFlame, SkeletonFlameV1 and the Apollo/Arden cubs) | release script excludes them (RC4); sources kept | fixed in RC4 source |
| B43 | P2 | performance | An integrated-GPU laptop at the default EPIC quality may run short of memory (the iGPU probe was stopped by memory pressure) | README: integrated graphics -> QUALITY LOW first (RC3); no automatic default (untestable here) | documented |

## Founder decisions

- **D1, creation loop without production Julius: settled by the founder's direction** ("Do not fake unavailable Julius
  production functionality"). The beta offers a truthful LOCAL loop: create a contract, see it queued and persisted,
  delete it, watch a clearly SIMULATED mission, use the Wonder Web sample canvas. Real AI results stay Julius's lane.
- **D2, multiplayer and private/project spaces: settled by the founder's direction** ("to the extent included in the
  beta", "as implemented; do not invent future systems"). None exists in the code; the beta is single-player, R5 covers
  single-player session stability and R6 verifies that nothing promises what is not there.
- **D3, third-party names for outside testers: OPEN, the founder's call (B11, P1).** Testers see "GPT 6 Astra" and
  "Claude Code Fable 5" on the HUD from the first frame (terminal titles, usage rows, the simulated mission's terminals,
  two Project Brain sample lines), next to "not connected in this beta", AND can open Wonder Web sample pages styled as
  Instagram and Google (B -> WONDER WEB -> Ctrl+W). Options for the names: keep them for an invite-only beta; show the
  role names (LLM COMPANION, JHINN) in player builds only, canon names untouched in development; or rename in canon.
  Options for the sample pages: neutral pages with no third-party marks; browser windows for developers (-wldev)
  only; or keep. CORE does not change companion canon or the founder's samples unilaterally.
- **D4, the world materials' Nanite flag (B45): the founder's call if it is visible**, because the fix is an editor
  write to three master materials in the shared Content tree.
