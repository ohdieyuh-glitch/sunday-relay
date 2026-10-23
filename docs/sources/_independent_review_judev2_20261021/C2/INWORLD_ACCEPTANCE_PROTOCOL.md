# In-world paid Julius mission: reviewer acceptance protocol (C2, JUDEV2, 2026-10-22)
Reviewer-owned. Awards nothing. Pass/fail is mechanical via `C2\crosscheck.py` (tested: `python C2\test_crosscheck.py`, 15 controls). Fixtures in `C2\fixtures\` are SYNTHETIC and are not evidence.
Credit is per exact run (ledger-credit proposal r2). Precondition of the goal, at most Row 12 +0.12; no Row 14 credit.

## 0. Required log/ledger formats (dev must emit; see section 6 of REPORT_C2 for the spec)
Client (one line each, prefix `WLMISSION`, never `JULIUS STREAM:` or `WLBRAIN`; no provider names; no question/result text; no URL; no token):
- `WLMISSION trigger run=<id> mission=<id> key_hash=<16hex> player_hash=<16hex> build=<pkgid> utc=<ISO8601Z> [rehearsal=fake]`
- `WLMISSION chain run=<id> seq=<n> role=<architect|coder|reviewer|checker> phase=<started|done|refused> utc=<ISO>`
- `WLMISSION result run=<id> body_sha256=<64> result_sha256=<64> digest_ok=<0|1> rows=<n> masked=<0|1> utc=<ISO>`
- `WLMISSION refused run=<id> kind=<status/kind only> utc=<ISO>`
Bridge ledger JSONL (fail-closed on write error): `run_start` {runId, missionId, frozenSha256, budgetCapUsd, authorizedPlayerHash}; per leg `pre_call` {runId, role, provider, model, keyHash, playerHash, mode=live|fake, at} written BEFORE the provider request, and `result` {providerResponseId, usage, at}; a `final` result row {resultSha256}. Console CSV (founder export, by response id): `response_id,provider,usd,requests`.

## 1. Build identity (before any run; FAIL = stop)
| # | Step | Pass |
|---|---|---|
| B1 | sha256 of packaged game exe, and of the Wonderland module DLL; record DLL mtime and package id | exe hash equals the hash the dev named in the handoff; DLL mtime is later than the commit time of the client mission code (a missing code path reads as an inert default); `build=` in the trigger line equals the package id |
| B2 | `git rev-parse` of the client branch and bridge branch; tree hashes | equal the handoff; client branch is NOT the r16reh18 scored line (no ask/mission code in it) |
| B3 | frozen mission folder: contract, hidden checker, MISSION_LIMITS entry, FILLED prereg | sha256 of each recorded before the run; `frozenSha256` in `run_start` equals; checker/author is not the coder/architect author (name the person/session in the prereg); reviewer provider differs from coder and architect |
| B4 | boot the build in rehearsal mode once (fake provider) | trigger line carries `rehearsal=fake`; crosscheck prints REHEARSAL and exits 1: this proves the label works and is NOT evidence |
| B5 | key placement check | founder places keys through hidden-input intake; reviewer never sees a key; `grep` the folder with a forbid-file of the key tails (founder supplies literal tails to the script, not to me) finds nothing |

## 2. Run capture (founder-side, one run at a time)
1. Start capture BEFORE the trigger: screen+HUD video with a visible UTC clock (or timestamped screenshots every <=10 s), the client log with `-UTC` or `utc=` fields, and the bridge ledger file copied read-only at the end (sha256 recorded). Window must span trigger -> every chain event -> result render -> last row.
2. The mission is typed or chosen in the running packaged client (no PIE, no terminal-side curl, no pre-created run). The ledger `pre_call` must be later than the client `trigger` line.
3. Do not edit, trim or re-save the log. Stop capture after the result is on screen and the ledger `final` row exists.
4. Founder exports provider console usage by response id for ALL legs (OpenAI, Anthropic if API-billed or the coder subscription label, xAI). A coder subscription price is labelled "runtime-reported", not a console read.

## 3. Mechanical cross-check (reviewer runs; PASS requires every row PASS)
`python crosscheck.py --client-log L --ledger J --console C --run <runId> [--run <run2>] --forbid-file F`
| ID | Check | Negative control proven in fixtures |
|---|---|---|
| C0 | no `rehearsal=fake` / `mode=fake` anywhere | neg_fake_rehearsal -> REHEARSAL, exit 1 |
| C1 | exactly one in-game trigger; its utc < first ledger pre_call | neg_trigger_after_precall |
| C2 | architect, coder, reviewer each have pre_call before result | neg_missing_pre_call |
| C3 | reviewer provider differs from coder and architect | neg_reviewer_same_provider |
| C4 | client `key_hash` == ledger `keyHash` on every pre_call (16 hex) | neg_wrong_pairing_key |
| C5 | client `result_sha256` == ledger final `resultSha256`, `digest_ok=1` | neg_hash_mismatch |
| C6 | every ledger providerResponseId present once in the console CSV | neg_console_id_missing |
| C7 | xAI console requests == xAI ledger legs, else explanation file | neg_xai_12_vs_3 |
| C8 | console USD sum <= `budgetCapUsd` | neg_over_budget |
| C9 | client player hash == ledger playerHash == authorizedPlayerHash | neg_unauthorized_player |
| C10 | no seeded-defect / forced-catch flag | neg_seeded_defect |
| C11 | no key material, Authorization header, Relay-Session, forbidden literal in client log or ledger | neg_key_material_leak |
| C12 | (two runs) same missionId and frozenSha256, fresh key hash, distinct run ids | neg_run2_same_key |
The script cannot check: that the result bytes shown equal what the screenshot shows (reviewer compares `check <12>` sub-line to the first 12 hex of result_sha256 by eye), that console values are authentic (founder screenshot + CSV), clock honesty (utc fields come from the same machine; the video clock is the second witness), and that the hidden checker ran on the real result (B3 plus checker output file hash in the final ledger row).

## 4. Manual checks (reviewer)
| ID | Pass |
|---|---|
| M1 | Capture shows trigger in the packaged client, chain rows appearing over time, result rows, with continuous timestamps; nothing indicating a seam (no editor, no terminal doing the dispatch) |
| M2 | Client log has NO provider names, no question or result text, no Authorization header, even with `LogHttp VeryVerbose` requested (the client must refuse to send while it is on) |
| M3 | Hidden checker verdict file hash is in the ledger and the checker was authored by someone other than the mission author/coder |
| M4 | Reviewer-leg verdict row exists and was produced by the different provider; no forced catch; defect catch is not counted |
| M5 | xAI 12-vs-3 mismatch explained in writing by response id (retries, Hermes tool loop, or console duplicates), reconciled to ledger legs |
| M6 | Cost table: one row per response id, three legs, USD from console; total vs cap; subscription coder price labelled |

## 5. Authorization and budget negative controls (zero-spend, fake provider, labelled; run in the rehearsal build)
| ID | Control | Expected |
|---|---|---|
| N1 | unpaired / second player triggers | refusal row in game, `WLMISSION refused kind=unauthorized`, NO ledger pre_call |
| N2 | budget cap set below one leg | refusal before pre_call or hard stop at cap; ledger records `budget_refused`; no provider call |
| N3 | kill switch off / env flag missing | refused, nothing sent |
| N4 | ledger write fails (read-only dir) | run refuses before any provider call (fail closed) |
| N5 | reuse same key, different mission | 409-style refusal; same key + same mission returns stored result without a new pre_call (idempotency) |
| N6 | non-loopback bridge URL | client refuses (existing ResolveBridgeUrl) |
| N7 | digest tampered in transit | client shows "arrived damaged", `digest_ok=0` |
| N8 | log leak sweep with `-LogCmds="LogHttp VeryVerbose"` | send refused; grep finds none of C11 patterns |
| N9 | bridge restart mid-run | client shows disconnected; on resume either same run completes from ledger or refuses; no duplicate pre_call for a finished leg |

## 6. Run 2 (repeatability)
Same frozen mission and checker bytes (same `frozenSha256`), fresh idempotency key, new run id, fresh client launch (not the same process if feasible), no seeded defect, no prompt edits. Run 2 must independently pass C0-C11 and C12. Different output text is expected; the checker verdict and ledger structure must match run 1. A failed or partially failed run 1 is reported, not replaced silently; any rerun is a new row with its own cost.

## 7. Verdict rule
ACCEPT-FOR-ROW-12 only if B1-B5, C0-C12, M1-M6 pass for run 1 and run 2, N1-N9 passed in the rehearsal build, and the founder has ruled in writing on "representative". Otherwise record each failed ID with the exact run id.
