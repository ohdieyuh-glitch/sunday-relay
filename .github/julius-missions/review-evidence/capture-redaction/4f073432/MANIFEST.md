# DEVELOPER-SUPPLIED EVIDENCE

This directory is developer-supplied evidence for the review follow-up on
`judev/capture-redaction`. It is not an independent acceptance and it is not a
PASS. The directory is named for the code head the runs describe. The commit
that adds this directory is a later commit on the same branch.

## Code under test

- Base reviewed head: `8bdd3eb4db423711a6e2fe3f3b2a01de22ad726a`
- Code head: `4f073432ee104b5bfb1314626b3a7643ef2ba945`
- Code tree: `3b5d6824f7d084f93907216f8a1237c370c3cd2f`
- node `v22.23.4`, npm `10.9.9`
- Workspace: `/tmp/capture-redaction`

Commits on top of `8bdd3eb4`, each authored `Cursor Agent <cursoragent@cursor.com>`:

| SHA | Subject |
|---|---|
| `7b164fc7efa1d3c8bf5fdc67cfbaf7ee18f6b83d` | test(workspace): withhold the trailing token whenever a capture is cut |
| `200840dad01b1135807acb6fd367f383d477a350` | fix(workspace): withhold the trailing token whenever captured output is cut |
| `4f073432ee104b5bfb1314626b3a7643ef2ba945` | test(workspace): give fixture git an empty home and empty config |

`src/relay/workspace/output-sanitizer.ts` is unchanged from `8bdd3eb4` (diff empty). `SECRET_OUTPUT_PATTERNS` was not edited.

Correction, added with the `8ee1b564` follow-up and without rewriting this commit: `4f073432` is not test-helper-only. That commit changed shipped `src/relay/workspace/verify-harness.ts`, which called `installHermeticGitHome()` and left the process HOME swapped after a real verification run. The commit subject stays as it was written.

Transcripts are `.txt` because the repository ignores `*.log`. The bytes match the runs.

## SHA-256

```
552364ff68afca9a0c912fe457b864684bb57d77a402eacd7a61726a9098ade6  src/relay/workspace/command-runner.ts
07a2b71fe66ef746158154a00372b173d4acb3217bce9da5e14345eb462d87ff  src/relay/workspace/command-runner-capture-redaction.test.ts
3b01f04f8af345c3b9773148a719ce81d664ee96a0b90505e38ebfac379ab114  src/relay/workspace/git-fixture-env.ts
c2f8a53a08d13f4cecad9e283fe99c28709cb715f51933d5f18e13c0644f1809  src/relay/workspace/output-sanitizer.ts
03c56a42780e84fb9871477351009ff94b00a9a83e64ecf5c0ed5468db42b0b3  logs/capture-redaction-clean-home-after-all.txt
2691a94e8055e1ccad3839cb53dc8b54362975bb9d2645f053c2b50b59de91c1  logs/capture-redaction-clean-home-after-helper.txt
52374b0e8f411020e706580a25b86328bbf71088789ebcf710b75deaf7c88c77  logs/capture-redaction-fake-home-after-all.txt
ac2b6a485aa3ee25fe490da90f094d0400d5f1303310ca7e05636144c9c66d37  logs/capture-redaction-fake-home-after-helper.txt
8e039c79df7ad72aacf7eabd512cee86cefaa9fc1bc042b8d9c682ee59436d4c  logs/capture-redaction-fake-home-before-16.txt
662d46927c75697389ce0afb342488d9de8ccfdadc74887ab5d3cf0070a25453  logs/capture-redaction-fake-home-gpgsign.txt
d079a5c671dbf4cdbd78f79d7c5c619d6b21be2d8e4d7b089e2b869eb419874c  logs/capture-redaction-fake-home-iter-fsmonitor-1.5.txt
60661bca00b06e154794cb452ce3b23a4d407ae5de0873922903840e3e91a9f8  logs/capture-redaction-fake-home-iter-jitter18-full.txt
376a74bb25604a9cb27cbacde0d33df90fe5e38f415d25253440856b7a102ee7  logs/capture-redaction-fake-home-iter-sleep0.82-full.txt
9e6431c3a4f24205f58bcdc944fedc1dfadde04650971cdc52844511dc1d6dc0  logs/capture-redaction-finding1-after.txt
b57df7d67cabef21d8400bbe2a1ef48e51ce1d9a9518971afef1480f7faeba87  logs/capture-redaction-finding1-tests-before.txt
811e45ff79ae1712afc3104422dfd299035c95812d2fbce9c808a70618a647ba  logs/capture-redaction-mutants-review.txt
6c748bb0f5ac22f97c0696d5243f81b8230f47c741863d783e59719d6d1169df  logs/capture-redaction-typecheck-review.txt
```

## Commands

Finding 2, before any test-helper edit, at `8bdd3eb4`:

```
HOME=/tmp/capture-fake-home npx vitest run src/relay/workspace --reporter=verbose
```

Result: 16 failed, 231 passed, 247 tests. Log: `logs/capture-redaction-fake-home-before-16.txt`.
Which settings produced which failures: `SETTINGS.md`.

Same fake HOME after the helper, still at the 247-test tree (helper uncommitted, new capture tests not yet added):

```
HOME=/tmp/capture-fake-home npx vitest run src/relay/workspace --reporter=verbose
HOME=/tmp/capture-clean-home npx vitest run src/relay/workspace --reporter=dot
```

Both: 22 files, 247 passed, exit 0.

Finding 1 tests on unmodified `command-runner.ts` (`8bdd3eb4`):

```
npx vitest run src/relay/workspace/command-runner-capture-redaction.test.ts \
  -t "password value when the byte bound|fragment left in the clear|fits the bound"
```

2 failed, 1 passed (the clean-exit control), 15 skipped, exit 1.

After the withhold change, the capture, partial-secret, and output-sanitizer files:

```
npx vitest run src/relay/workspace/command-runner-capture-redaction.test.ts \
  src/relay/workspace/command-runner-partial-secret.test.ts \
  src/relay/workspace/output-sanitizer.test.ts
```

48 passed, exit 0.

Final tree, both homes:

```
HOME=/tmp/capture-fake-home npx vitest run src/relay/workspace --reporter=dot
HOME=/tmp/capture-clean-home npx vitest run src/relay/workspace --reporter=dot
```

Each: 22 files, 250 passed, exit 0.

```
npm run typecheck
```

Exit 0. `tsc -b --noEmit` plus the bridge, hermes-service, and scripts projects.

Mutants: each patch was applied, the named vitest filter was run, then
`git checkout --` restored `command-runner.ts` and `output-sanitizer.ts`.
Every mutant exited 1. The tree was clean afterwards. Log: `logs/capture-redaction-mutants-review.txt`.

| Mutant | Filter | Caught by |
|---|---|---|
| `chunk.toString('utf8')` instead of the decoder | split across reads | euro split stored as two U+FFFD |
| bound, then sanitize | when redaction lengthens | stored 120 bytes, limit allows 94 |
| UTF-16 walk in `boundOutput` | lone surrogate | `boundOutput('😀'.repeat(10), 10)` prefix was not two emoji |
| drop `decoder.end()` | trailing incomplete | stored `''` instead of U+FFFD |
| withhold only when `stoppedEarly` | password value when the byte bound | password repro kept the cut token |
| delete the trailing-token withhold | password value when the byte bound | same password repro |

## Change

`src/relay/workspace/command-runner.ts:103` withholds the trailing token when `bounded.truncated || stoppedEarly`, after redact-then-`boundOutput`. A withhold that grows past the limit is bounded again at lines 107–110.

Finding 3 (credential material in a real gitconfig) has no code change. The real `~/.gitconfig` was not read or modified.
