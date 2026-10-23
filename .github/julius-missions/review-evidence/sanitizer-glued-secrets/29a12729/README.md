# DEVELOPER-SUPPLIED EVIDENCE

This directory is developer-supplied evidence for `judev/sanitizer-glued-secrets`.
It is not an independent acceptance and it is not a PASS. The directory is
named for the code head the runs describe. The commit that adds this directory
is a later commit on the same branch.

## Code under test

Branched from the capture-redaction code head, not from that branch's evidence commit.

- Base: `8ee1b564bae55d315bad63974d87057fdb505b49` tree `8e343830b2da8305b30c60e3e80ce77c8f863487`
- Test head: `7bd4162d479761deaa9a50f3e8346a07fb029515` tree `379d1d05df544a7a189a003e2217ffd91ebf1ae7`
- Code head: `29a127296e48a9c3fe914101ec651744e44675dc` tree `a85d32ca11ab8b7f5c8e02a0bd96be678336a098`
- node `v22.23.4`, npm `10.9.9` (`npm -v` in this worktree). The transcripts also contain npm's update notice, which names `11.21.1`.
- Workspace: `/tmp/capture-redaction`
- Author of both commits: `Cursor Agent <cursoragent@cursor.com>`

| SHA | Tree | Subject |
|---|---|---|
| `7bd4162d479761deaa9a50f3e8346a07fb029515` | `379d1d05df544a7a189a003e2217ffd91ebf1ae7` | test(workspace): redact glued key=value secrets |
| `29a127296e48a9c3fe914101ec651744e44675dc` | `a85d32ca11ab8b7f5c8e02a0bd96be678336a098` | fix(workspace): redact key=value secrets glued to the previous word |

The parent of the test commit is `8ee1b564`. Diff against that commit is `output-sanitizer.ts` and `output-sanitizer-glued.test.ts` only.

`command-runner.ts` is unchanged on this branch. The value minimum stays `\S{8,}`. `hunter2` is 7 characters and is left in place; the glued cases use `hunter22` (8).

## What changed

`output-sanitizer.ts:21` drops the leading `\b` on the assignment pattern. A word character glued to the key (`xpassword=`, `9secret=`, `_apikey=`) is still an assignment. The separator is what distinguishes that from `passwordless`, `tokenizer`, and `apikey_docs`.

## Counts

New tests against the sanitizer at `8ee1b564`, before this fix:

```
npx vitest run src/relay/workspace/output-sanitizer-glued.test.ts --reporter=verbose
```

5 failed, 3 passed, 8 tests, exit 1. Log: `logs/glued-secrets-tests-before.txt`.

The three passes are the assignments that already had a boundary beside unicode or punctuation, the ordinary-word cases (`passwordless`, `tokenizer`, `apikey_docs`, including `tokenizer: hunter22` and `passwordless=hunter22`), and a glued value still under 8 characters. The five failures are the glued forms: each key family with several prefixes, mid-line and mid-output, the existing separators, a different case, and the same secret glued beside unicode or punctuation.

After the fix, the glued file plus the existing sanitizer and policy files:

```
npx vitest run src/relay/workspace/output-sanitizer-glued.test.ts \
  src/relay/workspace/output-sanitizer.test.ts \
  src/relay/workspace/policy.test.ts --reporter=dot
```

3 files, 30 passed, exit 0. Log: `logs/glued-secrets-after-unit.txt`.

`src/relay/workspace` at the code head. Both runs use `GIT_CONFIG_SYSTEM=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. The clean run also sets `GIT_CONFIG_GLOBAL=/dev/null` and a fresh empty `HOME`. The hostile run leaves `GIT_CONFIG_GLOBAL` unset so git reads `HOME/.gitconfig`: Fake Reviewer identity, `url.insteadOf` rewriting `https://github.com/` to an `https://example.invalid/` placeholder, and a deterministic `core.fsmonitor` that sleeps 0.4s and answers with a fresh token and `/\0`.

```
npx vitest run src/relay/workspace --reporter=dot
```

Each run: 24 files, 264 passed, exit 0. The capture-redaction code head was 23 files and 256 tests. This branch adds one file and eight tests.

Logs: `logs/glued-secrets-clean-workspace.txt`, `logs/glued-secrets-hostile-workspace.txt`.

```
npm run typecheck
```

Exit 0. `tsc -b --noEmit` plus the bridge, hermes-service, and scripts projects. Log: `logs/glued-secrets-typecheck.txt`.

## Mutants

Each patch was applied to `output-sanitizer.ts`, then the glued test file was run, then the file was restored. Every mutant exited 1. The tree was clean afterwards. Log: `logs/glued-secrets-mutants.txt`.

| Mutant | Result | What failed |
|---|---|---|
| put `\b` back | exit 1, 5 failed, 3 passed | all five glued cases |
| delete the assignment pattern | exit 1, 6 failed, 2 passed | those five, plus a secret that already had a boundary |
| drop the `i` flag | exit 1, 1 failed, 7 passed | `xPASSWORD=hunter22` |
| keep only `password` | exit 1, 2 failed, 6 passed | the other key families, and a glued secret beside punctuation |
| raise the minimum from 8 to 9 | exit 1, 6 failed, 2 passed | `hunter22` no longer matches |
| lower the minimum from 8 to 7 | exit 1, 1 failed, 7 passed | `hunter2` was redacted |
| allow word characters between the key and the separator | exit 1, 1 failed, 7 passed | `passwordless=hunter22` was redacted |

## Production scope of `runWorkspaceVerification`

Unchanged on this branch (same code as `8ee1b564`). A real verification run, including `relay workspace` (the CLI calls `runWorkspaceVerification()` and passes no hooks), changes the process environment for the duration of that call and then puts it back.

Set for the call:

| Variable | Value during the call |
|---|---|
| `HOME` | a new temp directory whose name starts with `relay-git-home-` |
| `GIT_CONFIG_GLOBAL` | `/dev/null` |
| `GIT_CONFIG_SYSTEM` | `/dev/null` |
| `GIT_CONFIG_NOSYSTEM` | `1` |
| `GIT_TERMINAL_PROMPT` | `0` |

`runGit` forwards `HOME` (plus `PATH`, and `LANG` / `TMPDIR` when they are already set), so the service git commands see that empty home instead of the operator gitconfig. Fixture git commands inside the harness do not use the scoped `HOME`. They use `hermeticGitEnv`, which points at a separate process-lifetime empty home and the Relay Fixture identity. Those fixture commands do not need the scoped directory to survive.

On return, and on rejection, the `finally` block restores each of the five variables to the value it had when the call started. A variable that was unset is deleted. The scoped temp `HOME` is removed.

Overlapping calls are queued on one chain. They are not re-entrant: a call must not start another verification before it returns, or the inner call waits for a `finally` that is waiting on the inner call. Each call snapshots the environment when it starts, which is the restored environment of the call before it.

`installHermeticGitHome()` is still the process-lifetime form used by test files at import. Verification does not call it.

`beforeChecks` is an optional hook used by the restoration tests. It runs after the five variables are applied and before the checks. A throw from it rejects the call, and the `finally` block still restores the environment and removes the temp home. The CLI does not pass the hook. Failures of the checks themselves are still caught inside the harness and returned as `{ checks, failures }`.

## SHA-256

```
4725c3b2f17347cc860dcfcfc121c61f07a7d2ed40babfe1d4cb4e370a1f1c30  src/relay/workspace/output-sanitizer.ts
23550346c719149b1da881f950d6b2bbf3b468c144a21496b2ffa68fc6b85041  src/relay/workspace/output-sanitizer-glued.test.ts
86625aa7aa0e0863b8b09a42185999d1151a2a50a71a370d4a32a3d37f651cfb  logs/glued-secrets-tests-before.txt
f2434d360267cc0d03ce3a01c2131f025e8458c9681ad5fe635c45ff4037bf8c  logs/glued-secrets-after-unit.txt
2541041a4e26cf3cdfc3cc57ed566f78f1956cac5ca5753c003d56c8f061e772  logs/glued-secrets-mutants.txt
9206b57574d0ea91b9f479af3de70b11e24a03329330074c2380efd173932bd0  logs/glued-secrets-clean-workspace.txt
734a14d9090d9f71591652598e5ee9b2c27de37a0e47df8995832e148b697a16  logs/glued-secrets-hostile-workspace.txt
6c748bb0f5ac22f97c0696d5243f81b8230f47c741863d783e59719d6d1169df  logs/glued-secrets-typecheck.txt
```

## Secret scan

The six transcripts were scanned for GitHub token prefixes (`ghs_`, `ghp_`, and `github_pat_`, each followed by 10 or more token characters), the HTTP header name that carries an access token, the placeholder path segment used in the hostile `insteadOf` target, and `sk-` followed by 16 or more alphanumerics. Each scan returned zero matches. Partial-secret stdout names the fixture prefix `sk-ant-api03-`, which is a test label and is shorter than that `sk-` shape. The hostile transcript does not contain the placeholder path segment.
