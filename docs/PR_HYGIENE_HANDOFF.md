# PR hygiene handoff — the historical open-PR backlog

> **Status: COMPLETE.** This records a finished repository-hygiene pass. It is a
> handoff to future sessions, not a work item. Nothing here is in flight.

| | |
|---|---|
| Session scope | Open-PR archaeology, then authorized cleanup and one security salvage |
| Trusted `main` throughout | `ca77604a7197be0937c0ae82f968987496c82513` (PR #252) |
| Date | 2026-09-11 |
| Provider calls made | **zero** |

---

## 1–3. The numbers

| | Count |
|---|---:|
| **Original open PRs** | **45** |
| **Closed** | **37** |
| **Remaining (historical)** | **8** |

The eight that remain are open **on purpose**. They hold work that cannot be
discarded, and each belongs to a separate future engineering/salvage session —
not to a cleanup pass.

### Why all 45 needed triage at once

`scripts/julius-main-provenance.mjs` requires a landed candidate's **author** to
be `julius-worker[bot]`, pinned by test:
`expect(WORKER_AUTHOR_LOGINS).toEqual(['julius-worker[bot]'])`. The sole
approver is `ohdieyuh-glitch`, and an identity that may approve may never
author.

All 45 open PRs were authored by `ohdieyuh-glitch` (43) or
`devin-ai-integration[bot]` (2). **None could land as authored** — merging any
would make `main` `unprovenanced` and block every paid live mission. So "open"
had stopped meaning "landable", which is what this pass corrected.

---

## 4. The 37 closed, and their disposition

Every closure carries a comment on the PR naming the landing that superseded it.
**Supersession was proven by content** — file-by-file blob comparison, exported
symbol containment and string-literal containment against trusted `main` — never
inferred from a newer PR existing.

### One landing explains 35 of them

`6c369256` — *"Julius beta: an executor control plane Julius cannot reach past"*
(**#208**, 2026-09-01, 203 files, +24,452/−531). Its tree is **byte-identical**
to the consolidation candidate `73af710`, and it is the commit that first brought
these chains' files onto `main`.

| Group | PRs | Disposition | Evidence |
|---|---|---|---|
| Julius durable foundation | 170, 171, 172, 173, 174, 175, 176, 177, 178, 179 | STACK_CLOSE | 233/233 exported symbols and 721/721 string literals present on `main`; migrations 011–018 byte-identical |
| Relay↔Julius boundary (Claude lanes A–F) | 180, 181, 182, 183, 184, 185 | STACK_CLOSE | At the tip, 22 of 24 files byte-identical; the 2 that differ are test files where `main` is strictly better (adds `relay-boundary:allow-fixture` annotations and defanged secret fixtures) |
| Julius core continuation | 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198 | STACK_CLOSE | #198's correction is on `main` verbatim; `git grep "from '.*gauntlet" -- src/relay/mission/julius/` returns nothing |
| Consolidation & beta hardening | 202, 203, 204, 205, 206, 207 | STACK_CLOSE | `6c369256^{tree}` == `73af710^{tree}`; #207's tip is a direct ancestor |
| C.A.R.D. seam | 201 | SUPERSEDED_CLOSE | 24 of 28 blobs byte-identical; its 2 "absent" files were **deletions** `main` also made |
| Project Brain writer / Beta Gate | 235 | SUPERSEDED_CLOSE | Landed via `8e4b21d0` (#238); `main` → this head is **+520 / −34,190** |

Two closures carry notes worth keeping:

- **#188** was corrected *inside its own chain*: its twelve `JuliusGauntlet*`
  symbols are absent from `main` **and from the chain's own tip**, because #198
  deleted them. It was never independently mergeable.
- **#189** established "a run id is not an authorization" for the **Julius
  runtime only**. Its comment says explicitly that it does **not** close the
  `relay-bridge` mission-ownership gap — that is #143's, and remains open.

---

## 5. The eight SALVAGE_FIRST PRs

**#129 · #138 · #139 · #140 · #141 · #142 · #143 · #144**

---

## 6. What remains to inspect or salvage, in one sentence each

| PR | What is still worth having |
|---|---|
| **#129** | A documentation correction that is still factually needed — `main` today still asserts a thing its own code contradicts. |
| **#138** | The Coliseum domain core: proof-gated scoring (`proof-meter.ts`), duel lifecycle, and the sandbox brand whose unique-symbol *plus* module-private `WeakSet` refuses a runtime forger that casts past the type. |
| **#139** | The binding layer that connects Coliseum commands to the real trace, repair and reviewer engines — every one of which still exists on `main` at the same path and symbol. |
| **#140** | XP → level → capability → **earned** chakra tier as a pure projection of an append-only ledger, which `main` explicitly does not have (`relay-chakra.ts`: "Relay has **NO level ledger**"). |
| **#141** | The website/CLI progression surface and `preferredChakraTier(earned, chosen)` — the rule that an earned tier outranks a chosen one. |
| **#142** | Four still-live error-propagation defects: `main` has not touched any of its seven files in 70+ commits. |
| **#143** | A live cross-participant authorization gap on the bridge mission registry — **already salvaged**, see §8. |
| **#144** | Three small non-duplicated pieces — a presence-expiry scheduler, an HMAC-signed artifact store, and log-derived diagnostics — inside a domain `main` has otherwise re-implemented and bettered. |

---

## 7. #138–#141 are ONE Coliseum salvage family

**Treat these four as a single product decision, not four independent future
products.** They are a linear stack (`138 → 139 → 140 → 141`) whose value is
only coherent end to end: the domain, its engine bindings, the progression it
feeds, and the surface that renders it. Extracting any one alone produces a
capability with nothing to score, nothing to bind, or nothing to display.

Together they are **32 files absent from `main`** — `src/relay/mission/coliseum/`
and `src/relay/ui/coliseum/` do not exist there in any form or under any other
name.

Three things a future session must settle **before** writing code:

1. **Is it still wanted?** Every current doc on `main` names the Coliseum and
   files it under not-built. `README.md` §16: *"None of it is implemented. It is
   written down so the direction is legible, not so it can be mistaken for a
   feature list."* §12 is blunter: *"A competitive layer over an unproven runtime
   would be a game about nothing."* That is a product call, not an audit finding.
2. **It cannot be merged as authored.** Its base predates `main` by 91 commits,
   so GitHub's `clean` label is meaningless here — `docs/OPEN_PR_MERGE_LEDGER.md`
   warns of exactly this. The repo's own recommendation is **RESTACK_REQUIRED**:
   a fresh focused branch off current `main`, never a merge of the historical
   branches.
3. **Two architectural assumptions have since been ruled against.** It re-exports
   through `src/relay/mission/index.ts`, a pattern `main` now forbids because
   that barrel is reachable from the browser entry point; and it mounts its UI on
   `RelayProjectWorkspace`, which #199/#200 replaced as the front door.

---

## 8. #143 — the security candidate, and why it is waiting

A worker-authored salvage candidate already exists and is **frozen**:

| | |
|---|---|
| branch | `relay/mission-participant-scope` |
| head | `8682c06c940198c9811fbea869125b5158cc9bf3` |
| tree | `0b7ab2fdd920bc523642c35c3bbe209930e5a63b` |
| base | `ca77604a` (trusted `main`) |
| shape | 1 commit, 8 files, +853 / −81 |
| author **and** committer | `julius-worker[bot] <325202980+julius-worker[bot]@users.noreply.github.com>` |
| PR body | `docs/JULIUS_MISSION_OWNERSHIP_PR.md` on that branch |

**The defect it closes.** `visibleTo` appeared **0 times** in
`relay-bridge/mission.ts`. Any authenticated participant could read another
participant's mission, cancel their running work, retry it (**a retry spends**),
or obtain it outright by colliding on a caller-chosen mission id through
`POST /mission/start`. Authentication was working; nothing downstream asked
*whose* mission it was.

**Evidence carried on the branch.** 18 regression proofs; a four-mutation
falsification campaign, all four killed (predicate defeated → 12 tests fail;
`get` unscoped → 6; collision restored → 2; route claiming operator identity →
8); full suite **528 files, 10,298 passed, 0 failed**; four typechecks, three
builds, every gate and drill.

**Why it is waiting.** It is deliberately NOT reintegrated in this session. It
must land through the worker-App ceremony in `docs/JULIUS_WORKER_PR_RUNBOOK.md`
— the PR has to be **opened by the App**, approved by the founder at the exact
head, and squash-merged — and it is sequenced behind the current PR #253
landing. **Another session owns its reintegration and provenance ceremony.**

Two consequences for whoever picks it up:

- **Do not add commits to that branch.** The head and tree above are what the
  ceremony binds to; a new commit invalidates them.
- **Historical #143 stays open until the replacement lands**, then closes with a
  comment naming the new trusted landing.

Also discovered and deliberately left alone: the ship surface (`shipContext`,
`beginShip`, `endShip`, `recordShipOutcome`) is gated by **repository-registration**
ownership — a different and stronger authority than mission ownership.
Substituting one for the other would have removed a real capability. One residual
is recorded rather than silently changed: `shipContext` is read before the
ownership check, so a foreign caller can distinguish `409 mission_not_shippable`
from `403 repository_not_yours` and thereby learn whether a mission is shippable
— one bit, no content.

---

## 9. #129 — a documentation truth issue that is still true

`docs/relay/FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md` on `main` still
reads, verbatim:

> **Not built:** §4 branch and pull-request policy is *authorized* and performed
> by nothing — **no remote provider exists** — and §5's credential handling is
> designed but has no client to hold a credential.

That is false. `relay-bridge/github-remote-provider.ts` and
`relay-bridge/ship-runner.ts` both exist on `main`, and `main`'s own
`REPOSITORY_TARGETS.md` says the provider *"is written and proven offline and has
never made a request, because no credential exists here."* **`main` currently
contradicts itself**, inside a document whose own header warns against exactly
this defect class.

Two cautions for a future session:

- `docs/OPEN_PR_MERGE_LEDGER.md` marks #129 **OBSOLETE**. That verdict is
  **wrong** — it is a 2026-08-30 snapshot, and the stale sentence is still
  standing. Fix the ledger entry in the same change.
- Update against the **current** implementation, not the old PR text: its "as of
  2026-08-12" framing needs refreshing, and the paid runs on `main` are **LLM**
  provider calls, not GitHub-remote calls, so they neither support nor undermine
  the edit.

---

## 10. #142 — error propagation and recovery

The freshest of the eight by code drift: **`main` has not touched any of its
seven files since the merge-base**, so the defects are live exactly as authored.

| Still on `main` | Consequence |
|---|---|
| `durable-store.ts` — bare `catch {}` at three sites | a denied `listKeys()` returns `[]`, so the UI reports "no missions to recover" instead of "storage unavailable" |
| `durable-store.ts` — swallowed `remove()` failure | `stop()` proceeds to clear UI state while the durable record survives |
| `local-transport.ts` — `settle('failed', null)` | a Hermes run that stops without reporting an outcome settles with no reason and no usage |
| `main.ts` — silent `cancelAll()` | a cancellation that does not settle during shutdown says nothing |

**Constraint for the salvage:** the store change and the hook change are a
**matched pair**. Landing either alone regresses — store-only yields unhandled
rejections, hook-only yields dead catch blocks. Re-audit the current code rather
than cherry-picking, and carry no stale provider or runtime assumptions across.

---

## 11. #144 — a delta analysis is required before any extraction

**Do not transplant this domain.** `main` already carries a later, larger,
canonical implementation of the same specification — and the specification
itself, at `docs/relay/WONDERLAND_BACKEND_CONTRACT.md`.

| #144 proposed | What `main` already has |
|---|---|
| `src/relay/wonderland/service.ts`, `types.ts`, `contracts.ts` | `src/relay/mission/wonderland/wonderland-backend.ts` — same event version, envelope, visibility and idempotency model |
| a JSON-file store | `src/relay/persistence/wonderland-postgres.ts` + migrations 001–010 |
| an SSE/command host | `relay-bridge/wonderland-routes.ts` + `wonderland-realtime.ts` (LISTEN/NOTIFY fanout, durable replay) |
| mission phase → event | `observeRelayTransition`, landed as `dfc03c73` (#147) — the same change its body claims |

It is an abandoned parallel lane whose successor landed on the same day
(2026-08-24, roughly PRs #145–#168). GitHub reports it `dirty`, and its only two
modified files are precisely the two `main` rewrote to mount its own backend —
so landing it as authored would stand up a **second** event store, SSE host,
presence table and phase publisher inside one process.

**Only three pieces look genuinely non-duplicated**, and each is small enough to
be an issue rather than a revival:

1. `presence-scheduler.ts` — **a real, currently-unfilled gap.** `main` defines
   `WonderlandBackend.expirePresence()` and **nothing calls it**; presence leases
   are only checked lazily at battle start, and nothing emits
   `presence.left{reason:'expired'}`. About 20 lines close it.
2. `artifacts.ts` — an HMAC-signed, path-contained artifact store; `main` carries
   only `artifactIds: string[]`.
3. `observability.ts` — diagnostics derived from the durable log, which the
   backend contract asks for.

---

## 12. No history was destroyed

- **No branch was deleted.** Every branch behind all 37 closed PRs was verified
  still present on the remote after the pass.
- **Nothing was merged, retargeted, rebased, force-pushed, or rewritten.** No PR
  body was edited.
- Closing a PR does not delete it: all 37 keep their diffs, commits, review
  history and the comment explaining the closure, and any of them can be
  reopened.
- `main` was never written to by this session and stands unchanged at
  `ca77604a`.

The archaeology is also reproducible: the clone was **shallow** at session
start, which falsely reported unrelated histories for every pre-August branch.
Any future pass must `git fetch --unshallow` **before** making an ancestry claim.

---

## 13. Future work belongs in new, dedicated sessions

Each remaining item is a separate engineering effort with its own scope, its own
provenance ceremony and its own founder decision. Do **not** continue this
session for any of them; start a fresh one per item, and re-read trusted `main`
at the start of each because it moves daily.

Suggested order, by remaining value and independence:

| Order | Session | Why it goes here |
|---:|---|---|
| 1 | **Reintegrate the #143 candidate** | A live authorization gap; the work is already done, gated and frozen — it needs the ceremony, not engineering |
| 2 | **#142 error propagation** | Four live defects, zero code drift, small and self-contained |
| 3 | **#129 documentation truth** | Small; may be bundled with a compatible truth/hygiene candidate if that does not obscure provenance |
| 4 | **#138–#141 Coliseum** | Largest, and blocked on a product decision before any code |
| 5 | **#144 Wonderland delta** | Delta analysis first; likely resolves to three small issues and a close |

Two rules that apply to every one of them:

- **Base on current trusted `main`, never on the historical PR's base.** Fetch
  and verify the head is provenance-accepted before branching.
- **Salvage the capability, not the architecture.** These PRs predate the
  three-peer-worker model, Julius mission authority, C.A.R.D., the current
  Project Brain, the Mission Contract and governed research. Where an old PR
  carries a structure that now conflicts with those, take what it *does* and
  leave how it did it.
