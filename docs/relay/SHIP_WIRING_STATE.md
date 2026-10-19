# Ship wiring — what is built, and the prerequisite the ship tail hit

The path from "a hosted mission targets a real repository" to "it ships" was
built and tested piece by piece on `relay/ship-wiring`. This records the exact
state, because the ship TAIL turned out to have a prerequisite the current code
actively prevents — found by tracing, not by shipping a broken route.

## Built and tested (offline, this machine)

1. **`ship-runner.ts`** (on main, #122) — COMMIT → PUSH → PR → MERGE → DEPLOY →
   LIVE VERIFY → SHIPPED, with the two founder-named invariants.
2. **`ship-mission.ts`** — `shipVerifiedMission`, the seam that gives the runner
   a caller. Shipping is a SEPARATE, explicitly-authorized operation. Real
   git/deploy/HTTP tests; both guards mutation-proven.
3. **`repository-registration-node.ts`** — the durable registration store. Read-
   back validated (key re-derived), `null`≠`[]`, corrupt≠fatal. Mutation-proven.
4. **`repository-routes.ts`** + server wiring — an operator can register a
   repository over HTTP; domain-validated, secret-free, operator-only.
5. **`/mission/start` resolution** — an operator names a `repositoryKey`; the
   target is RESOLVED from the store and handed to the coding leg. A hosted
   mission can now BUILD / VERIFY / REVIEW against a real registered repository.

## The prerequisite the ship tail hit

**The coding leg disposes the worktree on success.** `runCodingMission` calls
`workspace.cleanupWorkspace(..., authorizeRemoval: true)` and `source.dispose()`
in a `finally`, when the coding leg returns — which is BEFORE the reviewer runs
(the code's own comment: "the reviewer has not run yet"). The reviewer then
works off the artifact DIGEST, not the worktree.

So by `verified_complete`, **the verified artifact no longer exists on disk.**
`shipVerifiedMission` needs the worktree to commit from; called against a
disposed one it would commit against a deleted directory.

Shipping a verified mission therefore requires, as its own careful unit:

1. **Conditional worktree RETENTION.** When a mission carries a
   `repositoryTarget` and may ship, the coding leg must NOT dispose the worktree
   on success — it must survive verification, review, and the ship.
2. **Eventual disposal of the retained worktree.** A worktree kept past coding
   is a resource that must be cleaned up — after the ship, or on mission
   teardown, or by a sweeper. A retained worktree that is never removed is a
   disk leak, so this is a resource-lifecycle change, not a one-line edit.
3. **The ship route** — an operator triggers a ship on a verified mission; it
   reads the retained worktree, the judgement, and the target, and calls
   `shipVerifiedMission`.

### Worktree retention — BUILT and proven both ways

The prerequisite is closed. The coding leg now uses `manual_cleanup` when a
`repositoryTarget` is present, retains `ws.workspacePath` on a run that PASSED
verification, and exposes it on `CodingOutcome.retainedWorktreePath`. A fixture
mission, and any real-target run that did NOT pass verification, retains nothing
and its worktree is removed on the spot — so nothing leaks on failure.

The proof needed a real-target scenario that PASSES verification, and the reason
the earlier attempt failed was found by tracing: Relay's verification runs a
HARDCODED `node --test test/normalize.test.js` (`RELAY_TEST_ARGS`). The existing
real-target test's project put its test at `test/greet.test.js`, so verification
found nothing and never passed. `verifiableProject()` puts the test where Relay
runs it and the fake agent edits `src/normalize.js` to pass — so the mission
verifies, and retention fires. Both sides are held by named tests:

  - a VERIFIED real-target run retains a worktree holding the edited diff
    (removing the retention fails this test);
  - a FAILED real-target run retains nothing (retaining without the
    verification guard fails this test — no leak on failure).

What REMAINS is the ship route: an operator triggers a ship on a verified
mission; it reads `retainedWorktreePath`, the judgement, and the target, and
calls `shipVerifiedMission`, then disposes the retained worktree. That, plus the
registry exposing the retained path + judgement + target on a completed mission,
is the last offline-buildable step.

## The founder boundary, unchanged

A LIVE GitHub ship — the actual push/PR/merge/deploy against a real repository —
needs a real registered GitHub repository, a real push credential, and explicit
ship authorization. That is the founder's to grant; no code closes it.
