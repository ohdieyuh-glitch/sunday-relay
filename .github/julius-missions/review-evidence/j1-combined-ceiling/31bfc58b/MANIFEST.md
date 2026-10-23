# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Evidence for code commit `31bfc58b89de137670e5dbaf752c3328b31163f7`. Tree `46744fc1dd0cf7a15d0e85c3d4456a604f17dca6`. Test commit `664974a5ff5c673daad6f130c4e4d01d410fe912`. These logs are not part of the code tree.

| Item | Value |
|---|---|
| Date (UTC) | 2026-10-23T08:44:46Z (prompt check 08:35:10Z and 08:36:52Z; full suite 08:37:09Z–08:44:01Z) |
| OS | Linux 6.12.94+ x86_64 GNU/Linux |
| Node | v22.23.4 |
| npm | 10.9.9 |
| Test commit | `664974a5ff5c673daad6f130c4e4d01d410fe912` |
| Code commit | `31bfc58b89de137670e5dbaf752c3328b31163f7` |
| Code tree | `46744fc1dd0cf7a15d0e85c3d4456a604f17dca6` |
| Ceiling source sha256 | `cc0c42c7c0f7a4fd6e28dbb9587cb3cc64b30d9019b7061275623798dd177dcb` |

The ceiling file is unchanged from `22a0a9cb`.

## Log checksums

| File | SHA-256 |
|---|---|
| `prompt-red.log` | `a807c4bc48416e7ef99316545006f722fac85c7edf95af137f50d3269ef770fc` |
| `prompt-green.log` | `0e9d80f111ae764a180aa86def4c82abca56034cd19a98d7b27f401903f77dd0` |
| `vitest.log` | `80d8a97cc16d69a55531f5daaefbf1273d3c93b60dfb4a7401233a16b9d7a54e` |
| `vitest.json` | `143db2b915e7f4ed4a269b4a185c32ca994d690d46c9a41f2d5e4d240c446fd7` |
| `j1-14-file-vitest.txt` | `3ec03ed6108e98051eb7f097b308260a58bd6ea8d93b1dfcded5b26ce91f189c` |
| `j1-14-file-vitest.json` | `5c26430616ca5127c73c15be8e0390e30b29435a9ff5559b62a9715e6f1be6f7` |
| `j1-14-file-list.txt` | `0ec296b9ccc3a98797c6549587106dc0ab8c2d17f6393670bf07d41c9211cf91` |
| `j1-14-file-command.txt` | `0b4c5af41d5a90cc9d88e93c530a0b433e76aabdd5a34dec61417816511ddeb5` |

## Prompt test — failed, then passed

Before the text change:

```
npx vitest run relay-bridge/julius-xai-direct-reviewer.test.ts -t 'the system prompt says Julius mission' --reporter=verbose
```

Exit 1. 1 failed | 16 skipped. The prompt was `You are the independent Reviewer for a Relay mission.` Log: `prompt-red.log`. 2026-10-23T08:35:10Z.

After `julius-xai-direct-reviewer.ts:29` says Julius mission, the same command exits 0. 1 passed | 16 skipped. Log: `prompt-green.log`. 2026-10-23T08:36:52Z.

## J1 vitest — 328 passed / 1 skipped / 0 failed

This is the J1 evidence. It is the same 14-file set recorded for `22a0a9cb`, run at code `31bfc58b` with an isolated git environment: `HOME` set to a fresh temporary directory, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`. The file list is `j1-14-file-list.txt`. The command is `j1-14-file-command.txt`.

```
HOME=$(mktemp -d) GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 \
npx vitest run --reporter=default --reporter=json --outputFile=/tmp/j1-14-31bfc58b.json \
  relay-bridge/julius-dispatch.test.ts \
  relay-bridge/julius-dispatch-adapters.test.ts \
  relay-bridge/julius-dispatch-wiring.test.ts \
  relay-bridge/julius-dispatch-repeat-ceiling.test.ts \
  relay-bridge/julius-dispatch-bundle.test.ts \
  relay-bridge/julius-dispatch-source-scan.test.ts \
  relay-bridge/julius-xai-direct-reviewer.test.ts \
  relay-bridge/julius-frozen-checker.test.ts \
  relay-bridge/julius-inworld-checker.test.ts \
  relay-bridge/julius-key-store.test.ts \
  relay-bridge/julius-architect-charter-parity.test.ts \
  relay-bridge/julius-coder-isolation.test.ts \
  relay-bridge/julius-local-shell-port.test.ts \
  relay-bridge/julius-local-shell-port.smoke.test.ts
```

Test Files 13 passed | 1 skipped (14). Tests 328 passed | 1 skipped (329). JSON: `numPassedTests` 328, `numFailedTests` 0, `numPendingTests` 1, `numTotalTests` 329, `success` true. The skip is `relay-bridge/julius-local-shell-port.smoke.test.ts` (`J1_REAL_SMOKE` unset). Started 2026-10-23T09:00:04Z, duration 1.67s. Exit 0. Log: `j1-14-file-vitest.txt`. JSON: `j1-14-file-vitest.json`.

A scan of those four new files for the seven requested patterns found no matches. No redaction was applied to them.

The xAI reviewer file in this run has 17 tests. At `22a0a9cb` it had 16. The added test is the Julius mission prompt check.

## Full-repo vitest — context only, not J1 evidence

`vitest.log` and `vitest.json` are a full-repo run. They are context for the prompt rename. They are not the J1 evidence. The J1 evidence is the 14-file run above.

## Full-repo counts — 15004 passed / 13 skipped / 36 failed / 311 todo

```
npx vitest run --reporter=default --reporter=json --outputFile=/tmp/j1-vitest-31bfc58b.json
```

Test Files 15 failed | 752 passed | 43 skipped (810). Tests 36 failed | 15004 passed | 13 skipped | 311 todo (15364). JSON: `numPassedTests` 15004, `numFailedTests` 36, `numPendingTests` 13, `numTodoTests` 311, `numTotalTests` 15364. Started 2026-10-23T08:37:09Z, duration 411.70s. Exit 1. Logs: `vitest.log`, `vitest.json`.

The new prompt test is not among the 36 failures. The failures are the pre-existing seed ENOENT on `normalized.json`, Julius harness classification of wiring files, ship and worktree timeouts, a git remote URL rewritten with a credential, the `skipIf` accounting check, and mission-contract script checks. A credential printed by the remote-url test was redacted in these logs.
