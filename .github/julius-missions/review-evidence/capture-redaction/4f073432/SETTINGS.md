# Fake HOME settings and the failures they caused

DEVELOPER-SUPPLIED EVIDENCE. All of these runs are `npx vitest run src/relay/workspace` at `8bdd3eb4`, before any test-helper edit, with `HOME` pointed at a temp directory. The real `~/.gitconfig` was not read.

The config that reproduced the reviewer's count is the last row. A fixed sleep cannot land on 15: twelve tests finished together at 4977–4990 ms under a 0.82 s hook, so the next fixed step fails all twelve (22 total). A 40 ms extra delay on about 10% of fsmonitor queries splits that cluster.

| Setting | Suite | Result | What failed |
|---|---|---|---|
| `commit.gpgsign=true`, `gpg.format=openpgp`, no secret key | full, 247 tests | 63 failed, 184 passed | every fixture commit: gpg skipped the fixture identity, no secret key. Log `capture-redaction-fake-home-gpgsign.log`. Not the reviewer's shape. |
| `core.hooksPath` pre-commit that exits 1 | full, 247 tests | 63 failed, 184 passed | every fixture commit refused. Too broad. The verbose log was not retained; the count was recorded before that file was reused. |
| `core.fsmonitor` sleep 1.5 s, response `1\n`, plus `url.insteadOf`, a failing credential helper, `init.defaultBranch=trunk`, `pull.rebase=true`, `gpgsign=false` | full | 45 failed (39 timeouts, 6 other) | timeouts, plus stale-status assertions and the get-url rewrite. Log `capture-redaction-fake-home-iter-fsmonitor-1.5.log`. |
| `core.fsmonitor` sleep 0.7 s, response `/\0` (git treats that as a clean tree) | three git files, 87 tests | 11 failed | 5 timeouts, stale status (`clean` instead of `allowed`, `nothing to commit`, `sourceDirtyAtPin` false), and the get-url rewrite. |
| fresh fsmonitor token plus `/`, sleep 1.05 s, plus `url.insteadOf` | three git files | 30 failed | 29 timeouts and the get-url assertion |
| same, sleep 0.85 s | three git files | 22 failed | 21 timeouts and the get-url assertion |
| same, sleep 0.75 s | three git files | 10 failed | 9 timeouts and the get-url assertion |
| same, sleep 0.78 s and 0.82 s | full, 247 tests | 10 failed, 237 passed | same 9 timeouts and one assertion. Log `capture-redaction-fake-home-iter-sleep0.82-full.log`. |
| sleep 0.82 s plus an extra 40 ms on 18% of queries | full | 20 failed | the 9 timeouts, most of the 4977–4990 ms cluster, and the get-url assertion. Log `capture-redaction-fake-home-iter-jitter18-full.log`. |
| sleep 0.82 s plus an extra 40 ms on 10% of queries, plus the config below | full | **16 failed, 231 passed, 247 tests** | 15 timeouts and one assertion. Log `capture-redaction-fake-home-before-16.log`. |

`user.name` / `user.email`, `init.defaultBranch=trunk`, and `pull.rebase=true` were present in the reproducing config. They did not add an assertion of their own. The only non-timeout failure in that run is `url.insteadOf`:

`repository-target-observer.test.ts` "permits only get-url" expected `https://github.com/o/r.git` and received `https://example.invalid/instead/o/r.git`.

The 15 timeouts are `Test timed out in 5000ms` in `mission-worktree.test.ts`, `repository-target-observer.test.ts`, and `workspace.test.ts`. The hook answers with a fresh token and `/`, so git still rescans; the delay is what crosses the 5 s test timeout.

Reproducing `~/.gitconfig` (no credentials):

```
[user]
	name = Fake Reviewer
	email = fake-reviewer@example.invalid
[init]
	defaultBranch = trunk
[commit]
	gpgsign = false
[url "https://example.invalid/instead/"]
	insteadOf = https://github.com/
[core]
	fsmonitor = /tmp/capture-fake-home/fsmonitor
[pull]
	rebase = true
```

Hook:

```
#!/bin/sh
sleep 0.82
n=$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')
if [ $((n % 100)) -lt 10 ]; then
  sleep 0.04
fi
printf '%s\0/\0' "$(date +%s%N)"
```

The same HOME after `git-fixture-env.ts` was loaded by the workspace tests: 247 passed (247-test tree) and 250 passed (after the three capture tests). A clean empty HOME passed both trees as well.
