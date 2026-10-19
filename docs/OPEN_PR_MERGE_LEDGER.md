# Open PR merge ledger

**Snapshot:** 2026-08-30 UTC. **Current main:** `96451fc0c8da59de792d973113c4e203ddab6f01`. **Open PRs inspected:** **38/38**. No PR was merged or closed. GitHub REST PR details, local commit graphs, three-way integration against current main, changed paths, PR bodies, and rerun tests on the candidate were inspected. The token could read PR mergeability but not protected check-run details for every head; that limitation is recorded rather than treating missing checks as green.

## Disposition summary

| PR | Title | Area / dependency | Files | Merge / CI | Disposition |
|---:|---|---|---:|---|---|
| #201 | fix(relay): unify Compound Agent C.A.R.D. configuration across live onboarding | C.A.R.D. single-source seam; rooted on historical `main` | 28 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #198 | ARCHITECTURAL CORRECTION — take the Gauntlet Loop out of Julius entirely | Julius runtime continuation / boundary; stacked on `claude/julius-end-to-end` | 40 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #197 | Julius core #12 — three end-to-end Compound Agent scenarios, and three defects they found | Julius runtime continuation / boundary; stacked on `claude/julius-swarm-fairness` | 4 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #196 | Julius core #11 — name the shared lease protocol, add admission, stop a leaking error | Julius runtime continuation / boundary; stacked on `claude/julius-chaos-idempotency` | 6 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #195 | Julius core #10 — crash at every boundary, audit idempotency, prove the bounds | Julius runtime continuation / boundary; stacked on `claude/julius-trajectory-observability` | 3 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #194 | Julius core #9 — trajectory completeness, evals and observability from the record | Julius runtime continuation / boundary; stacked on `claude/julius-event-completeness` | 7 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #193 | Julius core #8 — event completeness, and the four things the audit found missing | Julius runtime continuation / boundary; stacked on `claude/julius-runtime-api` | 15 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #192 | Julius core #7 — the authoritative execution API, with tenant authorization | Julius runtime continuation / boundary; stacked on `claude/julius-unchained-continuation` | 7 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #191 | Julius core #6 — make Unchained change continuation, and prove it bypasses nothing | Julius runtime continuation / boundary; stacked on `claude/julius-approvals-lifecycle` | 9 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #190 | Julius core #5 — approvals, pause, resume and cancel as durable operations | Julius runtime continuation / boundary; stacked on `claude/julius-read-tenancy` | 12 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #189 | Julius core #4 — a run id is not an authorization: scope every read by project | Julius runtime continuation / boundary; stacked on `claude/julius-gauntlet-runtime` | 9 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #188 | Julius core #3 — /gauntletloop as a durable runtime | Julius runtime continuation / boundary; stacked on `claude/julius-subagents-gauntlet` | 10 | `clean`; Unavailable/no readable check runs | **SUPERSEDED** |
| #187 | Julius core #2 — sub-agents that actually execute (+ migration-chain invariants) | Julius runtime continuation / boundary; stacked on `claude/julius-core-handoff` | 11 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #186 | Julius core #1 — the run loop: make the components form one system | Julius runtime continuation / boundary; stacked on `julius/event-source` | 13 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #185 | Claude lane F — legacy Relay compatibility adapters (+ repository permissions across the boundary) | Relay/Julius integration; stacked on `claude/julius-terminal-projection` | 10 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #184 | Claude lane E — safe Julius → Relay Live Terminal projection | Relay/Julius integration; stacked on `claude/julius-command-contracts` | 6 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #183 | Claude lane D — Relay command contracts for Julius operations | Relay/Julius integration; stacked on `claude/julius-mission-adapter` | 5 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #182 | Claude lane C — Mission Contract → Julius bootstrap adapter + the Julius port | Relay/Julius integration; stacked on `claude/julius-integration-registry` | 5 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #181 | Claude lane B — server-authoritative integration registry | Relay/Julius integration; stacked on `claude/julius-relay-contracts` | 4 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #180 | Claude lane A — Compound Agent configuration contract (Relay↔Julius boundary) | Relay/Julius integration; rooted on historical `main` | 5 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #179 | feat(julius): persist safe operational events | Julius durable foundation; stacked on `julius/trajectory-evals` | 6 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #178 | feat(julius): persist trajectories and eval metrics | Julius durable foundation; stacked on `julius/repair-runtime` | 9 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #177 | feat(julius): execute durable bounded repairs | Julius durable foundation; stacked on `julius/context-snapshots` | 6 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #176 | feat(julius): persist reproducible context snapshots | Julius durable foundation; stacked on `julius/verification-runtime` | 9 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #175 | feat(julius): wire evidence-backed verification | Julius durable foundation; stacked on `julius/execution-pipeline` | 9 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #174 | feat(julius): wire authoritative worker execution | Julius durable foundation; stacked on `julius/recovery-manager` | 4 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #173 | feat(julius): recover expired work and dedupe results | Julius durable foundation; stacked on `julius/bounded-children` | 9 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #172 | feat(julius): bound sub-agents and gauntlet rounds | Julius durable foundation; stacked on `julius/policy-router` | 4 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #171 | feat(julius): enforce C.A.R.D. policy and provider routing | Julius durable foundation; stacked on `julius/durable-runtime` | 5 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #170 | feat(julius): persist runs and scheduler leases | Julius durable foundation; rooted on historical `main` | 6 | `clean`; Unavailable/no readable check runs | **CONSOLIDATE** |
| #144 | Add Wonderland domain: durable event store, hosted service, SSE/command host, and Relay bridge integration | Wonderland backend; rooted on historical `main` | 24 | `dirty`; Unavailable/no readable check runs | **NEEDS_REPAIR** |
| #143 | Scope mission reads and mutations to the participant that started them | Mission tenant security; rooted on historical `main` | 5 | `clean`; Unavailable/no readable check runs | **NEEDS_REPAIR** |
| #142 | Propagate durable mission and Hermes failures | Durability/error propagation; rooted on historical `main` | 7 | `clean`; Unavailable/no readable check runs | **NEEDS_REPAIR** |
| #141 | The Agent's progression reaches the website, and the earned tier outranks the chosen one | Coliseum UI progression; stacked on `relay/coliseum-progression` | 11 | `clean`; Unavailable/no readable check runs | **RESTACK_REQUIRED** |
| #140 | The Agent earns its chakra: XP becomes level, capability, and tier on one scale | Coliseum progression; stacked on `relay/coliseum-engine-wiring` | 8 | `clean`; Unavailable/no readable check runs | **RESTACK_REQUIRED** |
| #139 | The Coliseum's commands reach the real engines, and XP is only what the ledger holds | Coliseum engine wiring; stacked on `relay/wonderland-coliseum` | 10 | `clean`; Unavailable/no readable check runs | **RESTACK_REQUIRED** |
| #138 | The Wonderland Coliseum: duels are real work, and the meter only moves on proof | Wonderland Coliseum; rooted on historical `main` | 33 | `clean`; Unavailable/no readable check runs | **RESTACK_REQUIRED** |
| #129 | docs: correct stale 'no remote provider exists' claim | Repository-target documentation; rooted on historical `main` | 1 | `clean`; Unavailable/no readable check runs | **OBSOLETE** |

## Complete per-PR records

### PR #201 — fix(relay): unify Compound Agent C.A.R.D. configuration across live onboarding
- **Head/base:** `relay/card-seam` `e2c789cdf0d37df655314ac5a7b275d45cf0717f` → `main` `96451fc0c8da59de792d973113c4e203ddab6f01`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-28T02:47:48Z`.
- **Topology/area:** rooted on historical `main`; C.A.R.D. single-source seam. **Changed files:** 28 (2118 additions, 521 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. No migration in PR diff.
- **PR-body test claims:** - **Projections, not copies.** `projectMissionConfig(card)` derives the domain's `RelayMissionConfig` through the same `validateMissionConfig` the bridge applies, stamping the C.A.R.D. identity into the request's `pspId` slot as `<cardId>-r
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #198 — ARCHITECTURAL CORRECTION — take the Gauntlet Loop out of Julius entirely
- **Head/base:** `claude/gauntlet-out-of-julius` `cc62ca7721b9f3e33d82cf93043217bb4a8ff0fd` → `claude/julius-end-to-end` `aa1b84794452f462368d227bad7914748663000a`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T17:24:09Z`.
- **Topology/area:** stacked on `claude/julius-end-to-end`; Julius runtime continuation / boundary. **Changed files:** 40 (1740 additions, 1358 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** `gauntlet-boundary.test.ts` reads **both source trees** and fails on: an import in either direction, a gauntlet identifier anywhere in Julius's production code, a gauntlet method on the execution API or the runtime store, a gauntlet event t
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #197 — Julius core #12 — three end-to-end Compound Agent scenarios, and three defects they found
- **Head/base:** `claude/julius-end-to-end` `aa1b84794452f462368d227bad7914748663000a` → `claude/julius-swarm-fairness` `b20bbc5fe49dbc8532981050e455e960fa27d277`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T16:45:56Z`.
- **Topology/area:** stacked on `claude/julius-swarm-fairness`; Julius runtime continuation / boundary. **Changed files:** 4 (663 additions, 8 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** The in-memory model did not emit `evidence.recorded`, which the real repository commits in the **same transaction** as the evidence row. The scenario asked the ledger for an event that exists in production and never in a test — the most use
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #196 — Julius core #11 — name the shared lease protocol, add admission, stop a leaking error
- **Head/base:** `claude/julius-swarm-fairness` `b20bbc5fe49dbc8532981050e455e960fa27d277` → `claude/julius-chaos-idempotency` `3ef9dcc88256aadfaeef4e89123f296c9263843e`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T16:28:48Z`.
- **Topology/area:** stacked on `claude/julius-chaos-idempotency`; Julius runtime continuation / boundary. **Changed files:** 6 (491 additions, 4 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** `julius-lease-protocol.ts` states **eleven invariants** and provides a harness any implementation can be driven through. It returns a result *per invariant* rather than throwing on the first: a conformance run that stops at the first failur
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #195 — Julius core #10 — crash at every boundary, audit idempotency, prove the bounds
- **Head/base:** `claude/julius-chaos-idempotency` `3ef9dcc88256aadfaeef4e89123f296c9263843e` → `claude/julius-trajectory-observability` `1793720ab9daa0983d89e5129b9fa44749de4425`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T16:17:09Z`.
- **Topology/area:** stacked on `claude/julius-trajectory-observability`; Julius runtime continuation / boundary. **Changed files:** 3 (428 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** It is a claim about what happens when a process dies *after the claim and before the dispatch*, *after the provider answered and before the result was accepted*, *after the evidence landed and before verification ran*. Those instants are th
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #194 — Julius core #9 — trajectory completeness, evals and observability from the record
- **Head/base:** `claude/julius-trajectory-observability` `1793720ab9daa0983d89e5129b9fa44749de4425` → `claude/julius-event-completeness` `5268e18a29621cf31bac4cbacc75ff43c24c2965`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T16:09:17Z`.
- **Topology/area:** stacked on `claude/julius-event-completeness`; Julius runtime continuation / boundary. **Changed files:** 7 (631 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** Nothing is keyed by a run, mission, task, worker or user id — a metric keyed by an unbounded set eventually costs more than the thing it measures. The only dimensions are the runtime version and the trajectory kind, both small closed sets,
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #193 — Julius core #8 — event completeness, and the four things the audit found missing
- **Head/base:** `claude/julius-event-completeness` `5268e18a29621cf31bac4cbacc75ff43c24c2965` → `claude/julius-runtime-api` `3a6bfa8022d2666772ae28de318aba41b459a482`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T15:54:32Z`.
- **Topology/area:** stacked on `claude/julius-runtime-api`; Julius runtime continuation / boundary. **Changed files:** 15 (970 additions, 32 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** `julius-event-coverage.test.ts` holds the catalogue and reality against each other **in both directions**: a type *declared and named nowhere* is a promise nothing keeps; a type *written and not declared* is an event no consumer can name. T
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #192 — Julius core #7 — the authoritative execution API, with tenant authorization
- **Head/base:** `claude/julius-runtime-api` `3a6bfa8022d2666772ae28de318aba41b459a482` → `claude/julius-unchained-continuation` `fa6817f84332b3031263ed7a5298afc83ccfe6a6`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T15:11:16Z`.
- **Topology/area:** stacked on `claude/julius-unchained-continuation`; Julius runtime continuation / boundary. **Changed files:** 7 (864 additions, 5 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** The one surface anything outside the runtime reaches to start, inspect or control a run. **Transport-neutral on purpose** — no HTTP, no framework, no serialization — so the bridge mounts it, a CLI could call it, and a test drives it without
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #191 — Julius core #6 — make Unchained change continuation, and prove it bypasses nothing
- **Head/base:** `claude/julius-unchained-continuation` `fa6817f84332b3031263ed7a5298afc83ccfe6a6` → `claude/julius-approvals-lifecycle` `e1ebe26d11d88036f1e8949d13fc5bb8671057ef`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T14:56:02Z`.
- **Topology/area:** stacked on `claude/julius-approvals-lifecycle`; Julius runtime continuation / boundary. **Changed files:** 9 (689 additions, 10 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** The gap is invisible from either side: the fallback rule is correct about fallback, the provider rule is correct about providers, and only a caller can notice that a fallback **is** a provider use. #171 is not changed — both rules it alread
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #190 — Julius core #5 — approvals, pause, resume and cancel as durable operations
- **Head/base:** `claude/julius-approvals-lifecycle` `e1ebe26d11d88036f1e8949d13fc5bb8671057ef` → `claude/julius-read-tenancy` `dd1db4617904d5a0a1a3247e056eb6e2fa466673`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T14:38:39Z`.
- **Topology/area:** stacked on `claude/julius-read-tenancy`; Julius runtime continuation / boundary. **Changed files:** 12 (1097 additions, 74 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ### A defect the first version had, and its own tests caught A gated operation must move a READY run to BLOCKED, and **`READY → BLOCKED` is not a transition** — a run reaches BLOCKED from EXECUTING. Checking only the single step made every
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #189 — Julius core #4 — a run id is not an authorization: scope every read by project
- **Head/base:** `claude/julius-read-tenancy` `dd1db4617904d5a0a1a3247e056eb6e2fa466673` → `claude/julius-gauntlet-runtime` `3d901a260fd0646d1d82c1ef493f855a787619ee`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T14:26:19Z`.
- **Topology/area:** stacked on `claude/julius-gauntlet-runtime`; Julius runtime continuation / boundary. **Changed files:** 9 (153 additions, 73 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** The in-memory store consults the same predicate before every read and returns nothing on a mismatch — the same answer the SQL gives. A laxer model would let a test pass where production refuses, which is the worst kind of green. 129 julius
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #188 — Julius core #3 — /gauntletloop as a durable runtime
- **Head/base:** `claude/julius-gauntlet-runtime` `3d901a260fd0646d1d82c1ef493f855a787619ee` → `claude/julius-subagents-gauntlet` `df557b2300d5e2d6b6d50e06a93500a0668f2781`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T17:20:28Z`.
- **Topology/area:** stacked on `claude/julius-subagents-gauntlet`; Julius runtime continuation / boundary. **Changed files:** 10 (1095 additions, 8 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Fully superseded by #198.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** `advanceGauntlet` halts on duration and spend against the usage it is handed, so it is handed **every settled phase of the round** rather than only the last. A test proves the difference: an execute leg of 1000 and a review leg of 900 halt
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **SUPERSEDED**. Do not merge; retain only for historical review, then founder may close after consolidation lands.

### PR #187 — Julius core #2 — sub-agents that actually execute (+ migration-chain invariants)
- **Head/base:** `claude/julius-subagents-gauntlet` `df557b2300d5e2d6b6d50e06a93500a0668f2781` → `claude/julius-core-handoff` `2929201bdcadf0567285909b0db133530ad4b918`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T13:59:36Z`.
- **Topology/area:** stacked on `claude/julius-core-handoff`; Julius runtime continuation / boundary. **Changed files:** 11 (912 additions, 8 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** #172 built `authorizeSubagent`: a pure function checking C.A.R.D., depth, count and permission narrowing, returning a child task. **Nothing called it, nothing stored its answer, and the child never entered the durable graph** — so no bound
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #186 — Julius core #1 — the run loop: make the components form one system
- **Head/base:** `claude/julius-core-handoff` `2929201bdcadf0567285909b0db133530ad4b918` → `julius/event-source` `b98b845f4d2bac5df20b5e9958c92e3acde15149`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T13:38:04Z`.
- **Topology/area:** stacked on `julius/event-source`; Julius runtime continuation / boundary. **Changed files:** 13 (2774 additions, 2 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** Grepping merged main for callers of every Julius entry point *outside its own module and test* returned **zero** for all of them — `claimRunnable`, `JuliusExecutionCoordinator`, `evaluateJuliusVerification`, `planJuliusRepair`, `createJuliu
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #185 — Claude lane F — legacy Relay compatibility adapters (+ repository permissions across the boundary)
- **Head/base:** `claude/julius-legacy-adapters` `fa8b612e3dfac94b9c2592b090b31abf724f406d` → `claude/julius-terminal-projection` `e10ec1cf773971194da8edf429dc130f2ba65971`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:55:31Z`.
- **Topology/area:** stacked on `claude/julius-terminal-projection`; Relay/Julius integration. **Changed files:** 10 (894 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** Project identity and acceptance criteria, checked in one place rather than at each call site. An authored `MissionSpec` has no identity of its own, so the project comes from the **caller's authorization**, and `missionId`/`revision`/`bindin
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #184 — Claude lane E — safe Julius → Relay Live Terminal projection
- **Head/base:** `claude/julius-terminal-projection` `e10ec1cf773971194da8edf429dc130f2ba65971` → `claude/julius-command-contracts` `897b270356a55a3cde756fededfd5eb9d0212a71`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:45:36Z`.
- **Topology/area:** stacked on `claude/julius-command-contracts`; Relay/Julius integration. **Changed files:** 6 (1095 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** A redacted chain of thought is still a record that one existed. The whole line is replaced and nothing stores the original — asserted by serializing the entry and looking for the text. **Detection runs on the RAW summary BEFORE redaction**,
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #183 — Claude lane D — Relay command contracts for Julius operations
- **Head/base:** `claude/julius-command-contracts` `897b270356a55a3cde756fededfd5eb9d0212a71` → `claude/julius-mission-adapter` `a5805bade7f8ed12c94ca9dd95a9f18fd14cef54`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:38:55Z`.
- **Topology/area:** stacked on `claude/julius-mission-adapter`; Relay/Julius integration. **Changed files:** 5 (1211 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** Relay refuses `--rounds banana` and `--rounds -3` because those are not numbers of rounds. It does **not** refuse `--rounds 4` because a C.A.R.D. allows three — that is Julius's call, and a duplicated limit here would go stale in silence an
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #182 — Claude lane C — Mission Contract → Julius bootstrap adapter + the Julius port
- **Head/base:** `claude/julius-mission-adapter` `a5805bade7f8ed12c94ca9dd95a9f18fd14cef54` → `claude/julius-integration-registry` `86bb630554bc0e5ff818d5c4eac59d22242ddb75`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:40:50Z`.
- **Topology/area:** stacked on `claude/julius-integration-registry`; Relay/Julius integration. **Changed files:** 5 (990 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** Relay still has to be buildable against that seam today, so this declares the **narrow** interface Relay needs, in Relay's own namespace, tested against fakes. When the durable runtime lands, one adapter implements this port and nothing in
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #181 — Claude lane B — server-authoritative integration registry
- **Head/base:** `claude/julius-integration-registry` `86bb630554bc0e5ff818d5c4eac59d22242ddb75` → `claude/julius-relay-contracts` `ddbfca626fe0c73c4dc95d9384eefa8fd71250ff`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:40:42Z`.
- **Topology/area:** stacked on `claude/julius-relay-contracts`; Relay/Julius integration. **Changed files:** 4 (652 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** So every entry is **derived**. Integrations project `ROLE_OCCUPANTS` (already the authority on what may stand in a role slot); capabilities join from the reviewer harness catalog (already the authority on what an adapter has PROVEN). The te
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #180 — Claude lane A — Compound Agent configuration contract (Relay↔Julius boundary)
- **Head/base:** `claude/julius-relay-contracts` `ddbfca626fe0c73c4dc95d9384eefa8fd71250ff` → `main` `4a22a95b7c91b133181e3c6dcc6bb44bd6e95f84`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:40:53Z`.
- **Topology/area:** rooted on historical `main`; Relay/Julius integration. **Changed files:** 5 (1469 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** - **Julius can never occupy a worker slot** — two guards, because they fail differently. The structural guard answers `unknown_integration` ("you misspelled something"), which is the wrong sentence for this mistake and would start working t
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #179 — feat(julius): persist safe operational events
- **Head/base:** `julius/event-source` `b98b845f4d2bac5df20b5e9958c92e3acde15149` → `julius/trajectory-evals` `868576f9b720e74facf90a3c0a61dd61beee9745`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:12:27Z`.
- **Topology/area:** stacked on `julius/trajectory-evals`; Julius durable foundation. **Changed files:** 6 (13 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-events.test.ts src/relay/persistence/julius-event-postgres.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #178 — feat(julius): persist trajectories and eval metrics
- **Head/base:** `julius/trajectory-evals` `868576f9b720e74facf90a3c0a61dd61beee9745` → `julius/repair-runtime` `3e75062fcb5953aeeff07fbb86208a8921296ca8`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:09:19Z`.
- **Topology/area:** stacked on `julius/repair-runtime`; Julius durable foundation. **Changed files:** 9 (31 additions, 3 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-trajectory.test.ts src/relay/persistence/julius-trajectory-postgres.test.ts src/relay/persistence/wonderland-postgres.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #177 — feat(julius): execute durable bounded repairs
- **Head/base:** `julius/repair-runtime` `3e75062fcb5953aeeff07fbb86208a8921296ca8` → `julius/context-snapshots` `bedf90949906095c0b39c145eeb88654166defb5`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:07:54Z`.
- **Topology/area:** stacked on `julius/context-snapshots`; Julius durable foundation. **Changed files:** 6 (31 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-repair-runtime.test.ts src/relay/persistence/julius-repair-postgres.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #176 — feat(julius): persist reproducible context snapshots
- **Head/base:** `julius/context-snapshots` `bedf90949906095c0b39c145eeb88654166defb5` → `julius/verification-runtime` `b3be51c784cd531f2856a832b47e8369ccc13b3a`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T12:00:04Z`.
- **Topology/area:** stacked on `julius/verification-runtime`; Julius durable foundation. **Changed files:** 9 (23 additions, 3 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-context-snapshot.test.ts src/relay/persistence/julius-context-postgres.test.ts src/relay/persistence/wonderland-postgres.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #175 — feat(julius): wire evidence-backed verification
- **Head/base:** `julius/verification-runtime` `b3be51c784cd531f2856a832b47e8369ccc13b3a` → `julius/execution-pipeline` `34f33ae15996cb4fa4eef170770822797b7846ab`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T11:58:55Z`.
- **Topology/area:** stacked on `julius/execution-pipeline`; Julius durable foundation. **Changed files:** 9 (38 additions, 3 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-verification-runtime.test.ts src/relay/persistence/julius-verification-postgres.test.ts src/relay/persistence/wonderland-postgres.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #174 — feat(julius): wire authoritative worker execution
- **Head/base:** `julius/execution-pipeline` `34f33ae15996cb4fa4eef170770822797b7846ab` → `julius/recovery-manager` `6430209b92f1995d9f0cdd797fb2257c4c55e685`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T11:55:09Z`.
- **Topology/area:** stacked on `julius/recovery-manager`; Julius durable foundation. **Changed files:** 4 (58 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-execution-coordinator.test.ts src/relay/mission/julius/julius-policy-router.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #173 — feat(julius): recover expired work and dedupe results
- **Head/base:** `julius/recovery-manager` `6430209b92f1995d9f0cdd797fb2257c4c55e685` → `julius/bounded-children` `47050ed87e08e25a8bb778e2ed15a9da7fa20cc7`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T11:31:15Z`.
- **Topology/area:** stacked on `julius/bounded-children`; Julius durable foundation. **Changed files:** 9 (152 additions, 3 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-recovery.test.ts src/relay/persistence/julius-recovery-postgres.test.ts src/relay/persistence/wonderland-postgres.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #172 — feat(julius): bound sub-agents and gauntlet rounds
- **Head/base:** `julius/bounded-children` `47050ed87e08e25a8bb778e2ed15a9da7fa20cc7` → `julius/policy-router` `9ede30e977fdce88dd2a4f1c447c0be2fa54b7c9`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T08:24:16Z`.
- **Topology/area:** stacked on `julius/policy-router`; Julius durable foundation. **Changed files:** 4 (13 additions, 1 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #171 — feat(julius): enforce C.A.R.D. policy and provider routing
- **Head/base:** `julius/policy-router` `9ede30e977fdce88dd2a4f1c447c0be2fa54b7c9` → `julius/durable-runtime` `71f9a7063ba8e390c2de7faedce25041e9c3fef8`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T08:21:44Z`.
- **Topology/area:** stacked on `julius/durable-runtime`; Julius durable foundation. **Changed files:** 5 (54 additions, 1 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Critical boundary/security. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/mission/julius/julius-policy-router.test.ts src/relay/mission/julius/julius-runtime.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #170 — feat(julius): persist runs and scheduler leases
- **Head/base:** `julius/durable-runtime` `71f9a7063ba8e390c2de7faedce25041e9c3fef8` → `main` `4a22a95b7c91b133181e3c6dcc6bb44bd6e95f84`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-27T08:20:24Z`.
- **Topology/area:** rooted on historical `main`; Julius durable foundation. **Changed files:** 6 (100 additions, 5 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** Clean at PR base; tip integrated cleanly into candidate against current main.
- **Present elsewhere:** Yes: effective tip is in this consolidation candidate. **Supersession:** Partially: folded into consolidated tip rather than merged alone.
- **Security/migration:** Security-adjacent. Migrations 011–018 in effective Julius tip.
- **PR-body test claims:** ## Tests - `npm test -- --run src/relay/persistence/julius-postgres.test.ts src/relay/persistence/wonderland-postgres.test.ts src/relay/mission/julius/julius-runtime.test.ts` - `npm run typecheck`
- **Actually rerun now:** Candidate Julius/Gauntlet/tool suites plus final matrix (see consolidation report).
- **Disposition:** **CONSOLIDATE**. Do not merge alone; founder should review the effective consolidated state.

### PR #144 — Add Wonderland domain: durable event store, hosted service, SSE/command host, and Relay bridge integration
- **Head/base:** `codex/set-up-relay/wonderland-backend-branch` `ebd3ecc4b569a26c00b169119193fab8ee2f211b` → `main` `7276889ed1eae08f91100ae176f3c9bfc15f6425`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-24T16:03:52Z`.
- **Topology/area:** rooted on historical `main`; Wonderland backend. **Changed files:** 24 (911 additions, 0 deletions).
- **Mergeability/checks:** `mergeable=False`, state `dirty`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports dirty against current main.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** Critical boundary/security. Wonderland persistence/migration relevant.
- **PR-body test claims:** - Extends the mission registry with an `onUpdate` hook and a `RelayWonderlandPublisher` to map Relay mission updates into Wonderland events (added to `relay-bridge/mission.ts` and `relay-bridge/wonderland-mission-publish.test.ts`). - Adds c
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **NEEDS_REPAIR**. Do not merge until conflicts/security overlap and current-main behavior are repaired and rerun.

### PR #143 — Scope mission reads and mutations to the participant that started them
- **Head/base:** `devin/1787460383-mission-ownership` `53bf12dbbbbf26c4aca0e3faa2e981ace9b3c397` → `main` `7276889ed1eae08f91100ae176f3c9bfc15f6425`.
- **Author/source/update:** `devin-ai-integration[bot]` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-23T04:47:40Z`.
- **Topology/area:** rooted on historical `main`; Mission tenant security. **Changed files:** 5 (148 additions, 25 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports clean, but historical-base semantic restack still required.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** Critical boundary/security. No migration in PR diff.
- **PR-body test claims:** `npm run relay:surface-parity:check` — `PASS  website/CLI parity holds.` (27 CLI commands, 42/51 website entry points mounted; the one unmounted panel is pre-existing and untouched here.) Neither surface's contract changed. - `relay-bridge/
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **NEEDS_REPAIR**. Do not merge until conflicts/security overlap and current-main behavior are repaired and rerun.

### PR #142 — Propagate durable mission and Hermes failures
- **Head/base:** `relay/error-propagation` `02b32ecd6b7bd1559b0e5c59f3470748d6427289` → `main` `7276889ed1eae08f91100ae176f3c9bfc15f6425`.
- **Author/source/update:** `devin-ai-integration[bot]` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-23T04:39:28Z`.
- **Topology/area:** rooted on historical `main`; Durability/error propagation. **Changed files:** 7 (224 additions, 76 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports clean, but historical-base semantic restack still required.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** Durable mission discovery, checkpoint, resume, and stop failures now produce truthful safe notifications instead of unhandled rejections or false empty/removed state. - Focused durable-recovery and admission regression tests ## Tests
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **NEEDS_REPAIR**. Do not merge until conflicts/security overlap and current-main behavior are repaired and rerun.

### PR #141 — The Agent's progression reaches the website, and the earned tier outranks the chosen one
- **Head/base:** `relay/coliseum-progression-surface` `e3ea3e5c84769f1eed1af721fe8e7b12cd3fc608` → `relay/coliseum-progression` `5c602e1d592b91bb10a376b822842a277228f66b`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-18T20:22:58Z`.
- **Topology/area:** stacked on `relay/coliseum-progression`; Coliseum UI progression. **Changed files:** 11 (589 additions, 25 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports clean, but historical-base semantic restack still required.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** - **RelayAgentProgression panel** (mounted as an optional workspace prop, absent = unchanged): total XP, level with xp-into/xp-to-next (max level → "there is no next level", never invented), earned chakra tier (null → "the Dog keeps its gol
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **RESTACK_REQUIRED**. Independently valuable concept, but replay only its focused delta onto current main and revalidate.

### PR #140 — The Agent earns its chakra: XP becomes level, capability, and tier on one scale
- **Head/base:** `relay/coliseum-progression` `5c602e1d592b91bb10a376b822842a277228f66b` → `relay/coliseum-engine-wiring` `15481ad2960a342d1585eb8db3427bbaf47e5939`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-18T19:46:01Z`.
- **Topology/area:** stacked on `relay/coliseum-engine-wiring`; Coliseum progression. **Changed files:** 8 (475 additions, 29 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports clean, but historical-base semantic restack still required.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** Independent review: 0 Critical / 0 High / 1 Medium / 2 Low / 1 Informational — all repaired (dead scale deleted, demo gate note, shared turn-cap constant, single clamp). Full suite **7010 passed / 0 failed (336 files)**, `relay:build` + dem
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **RESTACK_REQUIRED**. Independently valuable concept, but replay only its focused delta onto current main and revalidate.

### PR #139 — The Coliseum's commands reach the real engines, and XP is only what the ledger holds
- **Head/base:** `relay/coliseum-engine-wiring` `15481ad2960a342d1585eb8db3427bbaf47e5939` → `relay/wonderland-coliseum` `0ef476a35ae797fd78de9d3aed5db4825b252044`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-18T19:17:39Z`.
- **Topology/area:** stacked on `relay/wonderland-coliseum`; Coliseum engine wiring. **Changed files:** 10 (1375 additions, 9 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports clean, but historical-base semantic restack still required.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** - **Real engine bindings** (`duel-engine-bindings.ts`): the composition root builds `DuelEnginePorts` from the actual engines — TRACE → hash-chained Aquala trace ledger, SB → repair-loop engine (converged/limit_reached/abandoned mapped hone
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **RESTACK_REQUIRED**. Independently valuable concept, but replay only its focused delta onto current main and revalidate.

### PR #138 — The Wonderland Coliseum: duels are real work, and the meter only moves on proof
- **Head/base:** `relay/wonderland-coliseum` `0ef476a35ae797fd78de9d3aed5db4825b252044` → `main` `7276889ed1eae08f91100ae176f3c9bfc15f6425`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-18T15:10:42Z`.
- **Topology/area:** rooted on historical `main`; Wonderland Coliseum. **Changed files:** 33 (3876 additions, 17 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports clean, but historical-base semantic restack still required.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** - **Duel domain** (`src/relay/mission/coliseum/`): lifecycle (challenge → accept → provision → active → concluded/aborted), participant-kind compatibility, and a sandbox guarantee — duel targets are constructible only from registry-checked
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **RESTACK_REQUIRED**. Independently valuable concept, but replay only its focused delta onto current main and revalidate.

### PR #129 — docs: correct stale 'no remote provider exists' claim
- **Head/base:** `relay/doc-repo-targets-truth` `c6b503e4f50774a5429704dac99b5ddcacf63bdf` → `main` `46c69e5e8c41ec0dbabdd13addee49ec5a21bde2`.
- **Author/source/update:** `ohdieyuh-glitch` / `ohdieyuh-glitch/sunday-relay`; updated `2026-08-12T14:13:27Z`.
- **Topology/area:** rooted on historical `main`; Repository-target documentation. **Changed files:** 1 (19 additions, 7 deletions).
- **Mergeability/checks:** `mergeable=True`, state `clean`. Unavailable/no readable check runs. **Current-main conflict:** GitHub reports clean, but historical-base semantic restack still required.
- **Present elsewhere:** No exact patch-id match on current main. **Supersession:** Not proven.
- **Security/migration:** No primary security claim. No migration in PR diff.
- **PR-body test claims:** None stated
- **Actually rerun now:** Not rerun in isolation; current-main applicability audited only.
- **Disposition:** **OBSOLETE**. The narrow documentation claim is stale relative to current main; founder may close after confirming no desired wording remains.

## Real stack DAG
```text
current main 96451fc
├── #170 → #171 → #172 → #173 → #174 → #175 → #176 → #177 → #178 → #179
│   └── #186 → #187 → #188 → #189 → #190 → #191 → #192 → #193 → #194 → #195 → #196 → #197 → #198
│       (#198 removes the Julius→Gauntlet coupling introduced by #188; consume only the effective #198 tip)
├── #180 → #181 → #182 → #183 → #184 → #185  (parallel Relay/Julius boundary lane)
├── #201 (C.A.R.D. single-source seam)
├── #138 → #139 → #140 → #141 (historical Coliseum stack; must be restacked, not merged as-is)
├── #142 (durability errors), #143 (mission ownership), #144 (Wonderland backend; dirty)
└── #129 (stale documentation-only root)
```

## Cross-stack findings
- #198 and #185 share a historical base but integrate cleanly as parallel tips; the candidate uses merge commits so published stacks are not rewritten.
- #201 touches the live onboarding/UI configuration seam and integrated without textual conflicts, but its browser and seam tests remain the semantic authority.
- #188 is knowingly invalid in isolation. The candidate never exposes it as a mainline state: the effective #198 tip is merged atomically.
- #138’s comparison against current main includes massive apparent deletions because its historical base predates extensive product work. It must never be merged based on GitHub’s `clean` label.
- #144 is textually dirty and overlaps Relay bridge mission/server composition; it requires a focused new integration rather than conflict-button merging.
- #142/#143 touch security/durability paths that have continued evolving. Their ideas require a fresh current-main audit and repair, not blind replay.

## Founder-only actions
1. Review the consolidation PR and its effective changes; do not merge the individual Julius stacks first.
2. If the consolidation is accepted, merge it as one founder-authorized state, then close #170–#198, #180–#185, and #201 as consolidated/superseded with links to the landed SHA.
3. Decide whether to sponsor separate current-main restacks for #138–#144. No automated closure or merge is authorized.
4. Close #129 only after confirming its old documentation wording has no desired unique content.
