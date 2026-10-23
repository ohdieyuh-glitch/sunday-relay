# DEVELOPER-SUPPLIED EVIDENCE

This directory is developer-supplied evidence for the review follow-up on
`judev/capture-redaction`. It is not an independent acceptance and it is not a
PASS. The directory is named for the code head the runs describe. The commit
that adds this directory is a later commit on the same branch.

## Code under test

- Prior evidence tip: `bf536e60709675f0f3915dfaeca3a01c420a84ac`
- Test head: `b963a323572e5440cf2f7efc07841c9aa0065510`
- Test tree: `96f17efd1fb005d7c83c4b7156687fff58c23453`
- Code head: `8ee1b564bae55d315bad63974d87057fdb505b49`
- Code tree: `8e343830b2da8305b30c60e3e80ce77c8f863487`
- node `v22.23.4`, npm `10.9.9` (`npm -v` in this worktree). The transcripts also contain npm's update notice, which names `11.21.1`.
- Workspace: `/tmp/capture-redaction`
- Author of both commits: `Cursor Agent <cursoragent@cursor.com>`

| SHA | Tree | Subject |
|---|---|---|
| `b963a323572e5440cf2f7efc07841c9aa0065510` | `96f17efd1fb005d7c83c4b7156687fff58c23453` | test(workspace): restore verification git env and keep a safe stopped prefix |
| `8ee1b564bae55d315bad63974d87057fdb505b49` | `8e343830b2da8305b30c60e3e80ce77c8f863487` | fix(workspace): restore verification git env and keep a safe stopped prefix |

`src/relay/workspace/output-sanitizer.ts` is unchanged from `8bdd3eb4` (diff empty, same SHA-256 as the `4f073432` evidence). `SECRET_OUTPUT_PATTERNS` was not edited.

`4f073432` is not test-helper-only. That commit changed shipped `verify-harness.ts`. The older evidence directory records a one-sentence correction. Its commit subject was not rewritten.

## Production scope of `runWorkspaceVerification`

A real verification run, including `relay workspace` (the CLI calls `runWorkspaceVerification()` and passes no hooks), changes the process environment for the duration of that call and then puts it back.

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

`installHermeticGitHome()` is still the process-lifetime form used by test files at import. Verification does not call it. Deleting that singleton would break later tests, so the shipped scope uses its own temp directory.

`beforeChecks` is an optional hook used by the restoration tests. It runs after the five variables are applied and before the checks. A throw from it rejects the call, and the `finally` block still restores the environment and removes the temp home. The CLI does not pass the hook. Failures of the checks themselves are still caught inside the harness and returned as `{ checks, failures }`.

## Finding 3

A stopped stream whose bounded text already ends with `\n[TRUNCATED: output limit reached]`, and which this bound did not itself truncate, keeps an ordinary last token. `hello` followed by that suffix stays `hello` plus the suffix. The same shape with a secret-shaped last token (`password=` plus an `sk-` fragment) keeps `hello`, withholds that token, and still ends with the suffix.

A cut this bound just made, or a stop that does not already end on the truncation line, still withholds whatever the last token is. Reattaching a suffix that was already there does not flip `truncated` to true.

The rule is `command-runner.ts:121` (`suffixWasAlreadyThere = hadSuffix && !bounded.truncated`) and `:123` (withhold the trailing token unless that suffix was already there and the token is not secret-shaped). The outer condition is still `:114` (`bounded.truncated || stoppedEarly`). `trailingTokenLooksSecret` is `:88`.

## Counts

Touched files before the fix, at the test commit, against unmodified `command-runner.ts` and `verify-harness.ts` from `4f073432`:

```
npx vitest run src/relay/workspace/command-runner-capture-redaction.test.ts \
  src/relay/workspace/verify-harness-env.test.ts \
  -t "keeps the safe prefix|keeps hello and withholds|workspace verification restores"
```

5 failed, 1 passed, 18 skipped, 24 tests, exit 1. Log: `logs/capture-redaction-review2-tests-before.txt`.

The one pass is the mirror: `hello` plus a secret-shaped token plus the truncation suffix already kept `hello` and withheld the token on the previous withhold rule. The safe-prefix assertion failed at `startsWith('hello')`. The four environment tests failed because the five variables were left at the hermetic values (`HOME` still a `relay-git-home-*` directory, both git configs `/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`), including variables that had been unset. The rejection test resolved, because nothing rejected. The overlap test saw both recorded homes empty.

After the fix, same three files with no filter:

```
npx vitest run src/relay/workspace/command-runner-capture-redaction.test.ts \
  src/relay/workspace/command-runner-partial-secret.test.ts \
  src/relay/workspace/verify-harness-env.test.ts
```

3 files, 49 passed, exit 0. Log: `logs/capture-redaction-review2-after.txt`.

`src/relay/workspace` at the code head. Both runs use `GIT_CONFIG_SYSTEM=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. The clean run also sets `GIT_CONFIG_GLOBAL=/dev/null` and a fresh empty `HOME`. The hostile run leaves `GIT_CONFIG_GLOBAL` unset so git reads `HOME/.gitconfig`: Fake Reviewer identity, `url.insteadOf` rewriting `https://github.com/` to an `https://example.invalid/` placeholder, and a deterministic `core.fsmonitor` that sleeps 0.4s and answers with a fresh token and `/\0`.

```
npx vitest run src/relay/workspace --reporter=dot
```

Each run: 23 files, 256 passed, exit 0. The previous evidence tree was 22 files and 250 tests. The six new tests are the safe-prefix test, the mirror test, and four restoration tests, in one new file.

Logs: `logs/capture-redaction-review2-clean-workspace.txt`, `logs/capture-redaction-review2-hostile-workspace.txt`.

```
npm run typecheck
```

Exit 0. `tsc -b --noEmit` plus the bridge, hermes-service, and scripts projects. Log: `logs/capture-redaction-review2-typecheck.txt`.

## Mutants

Each patch was applied to `command-runner.ts`, then:

```
npx vitest run src/relay/workspace/command-runner-capture-redaction.test.ts
```

`git checkout -- src/relay/workspace/command-runner.ts` restored the file after each one. Every mutant exited 1. The tree was clean afterwards (`ahead 2`). Log: `logs/capture-redaction-review2-mutants.txt`.

| Mutant | Result | What failed |
|---|---|---|
| withhold only when `stoppedEarly` | exit 1, 2 failed, 18 passed | password cut on a clean exit; the fragment left in the clear when redaction lengthens a clean exit |
| delete the trailing-token withhold | exit 1, 3 failed, 17 passed | those two, plus the mirror secret sitting against the truncation suffix |
| always withhold the last token | exit 1, 1 failed, 19 passed | safe prefix `hello` |
| withhold only when the suffix was not already there, ignoring secret shape | exit 1, 1 failed, 19 passed | mirror secret kept |

The first two are the original withhold mutants. Both are still killed on this code.

## SHA-256

```
4cfcf5dbfdced2b8968f658afd6b44c719ab30f9285e83402f416f2419f09011  src/relay/workspace/command-runner.ts
0fba3549faa11dc065df7a4afb8016a5aed32210de4fe23bc064e2089831fd4c  src/relay/workspace/command-runner-capture-redaction.test.ts
4d48e4725b9c5d7d5abc3df4b77fc6de31d3dddac19d276b2c799b72d61307b7  src/relay/workspace/verify-harness.ts
e827a3221f0b16e7992d35d97a8fa04a8d0c91b5958eb46c6d53f9d6a3f8ab0b  src/relay/workspace/verify-harness-env.test.ts
b9f14a4ae5c7cc6b72b6baab253923917e193326094c2cf0f7ebe122dde5d5f6  src/relay/workspace/git-fixture-env.ts
c2f8a53a08d13f4cecad9e283fe99c28709cb715f51933d5f18e13c0644f1809  src/relay/workspace/output-sanitizer.ts
a22a68d678199edf8f298b91dd011c08ca19f136f3bf19185a31262df4eed6dc  logs/capture-redaction-review2-tests-before.txt
615c41cbbe345618f45b218fd0d46e34a74b6c1b2570a3eb0bd6d651a7160660  logs/capture-redaction-review2-after.txt
ae45f865bc668329aac1b34f22f0294de6154bbd0c78b77940a1b8c36b0231af  logs/capture-redaction-review2-mutants.txt
fc6bd669ab303eda407d2cb8ff9c8bdf9b2f9a6f57005d9f417e2b4c90dd19f7  logs/capture-redaction-review2-clean-workspace.txt
add554f6b55d9bf954f32a299729639551826129089be50953d348d1448d0c26  logs/capture-redaction-review2-hostile-workspace.txt
6c748bb0f5ac22f97c0696d5243f81b8230f47c741863d783e59719d6d1169df  logs/capture-redaction-review2-typecheck.txt
```

## Secret scan

The six transcripts were scanned for GitHub token prefixes (`ghs_`, `ghp_`, and `github_pat_`, each followed by 10 or more token characters), the HTTP header name that carries an access token, the placeholder path segment used in the hostile `insteadOf` target, and `sk-` followed by 16 or more alphanumerics. Each scan returned zero matches. Partial-secret stdout names the fixture prefix `sk-ant-api03-`, which is a test label and is shorter than that `sk-` shape. The hostile transcript does not contain the placeholder path segment.
