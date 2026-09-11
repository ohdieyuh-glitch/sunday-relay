# Julius: a mission belongs to whoever started it, and to nobody else

Salvage of #143, re-audited and repaired against current trusted main rather than
replayed. The original was right about the gap and — on the bridge as it exists
today — wrong about the mechanism, in a way that would have escalated privilege
rather than contained it. That is the substance of this PR, and it is section two.

No provider was contacted. No mission spent anything. Operator behaviour is
byte-for-byte unchanged, and a proof asserts it on every verb.

---

## 1. The gap, still live

The mission-family gate proved a caller held *a* session. It never proved the
mission named in the path was THEIRS. Mission ids arrive as `missionId` in the
start body — caller-chosen, therefore guessable — and `listForParticipant` was the
only ownership-aware read in the registry. Every other verb took an id and
answered:

| route | before | after |
|---|---|---|
| `GET /relay-api/mission/:id` | 200 with the owner's objective, events, repository target | 404 |
| `POST /relay-api/mission/:id/cancel` | 200, their mission cancelled | 404 |
| `POST /relay-api/mission/:id/retry` | 200, their mission re-driven — and retry re-drives the pipeline, so it **spends** | 404 |
| `POST /relay-api/mission/start` `{id: theirs}` | 200 with their view, via the idempotent branch | 409 `mission_id_unavailable` |

The reach was not limited to participants. `/mission/:id` sits in
`BROWSER_READABLE`, so a `browser_read_only` session — the weakest credential the
bridge issues — could read any mission by id, every operator-started paid Julius
mission included.

`missionCaller.participantId` was already in scope at all four call sites; the
retry route was already using it for the beta-admission guard. The identity was
present and simply never asked about ownership.

## 2. The null trap — why this is a repair, not a replay

#143 expressed the caller's scope as one nullable participant:

```ts
visibleTo(rec, asParticipant) = asParticipant === undefined
  || rec.startedByParticipant === (asParticipant ?? null)
```

On this bridge that is an escalation. A session minted `browser_read_only`
carries `participantId: null` (`grants.ts:197`, `:254`), and an operator-started
mission carries `startedByParticipant: null`. Under one `string | null` field
those two nulls are the same value — "an anonymous browser is asking" collapses
into "the operator is asking" — and the anonymous session inherits the operator's
view of **every** mission, which is the opposite of what the change is for.

So the scope is a type, not a nullable field:

```ts
export interface MissionOwnershipScope { readonly participantId: string | null }
```

Absent means the operator. Present means a browser, and then `participantId` is
what was bound into the session at mint. The collapse is now unrepresentable
rather than merely unlikely — and mutation M2 below reintroduces #143's exact
formula and dies.

## 3. The rule

One rule, in one place, so no route can hold a different opinion:

- **no scope (the operator credential)** — every mission. Unchanged.
- **a participant** (`browser_control`, `participantId` non-null) — exactly the
  missions they started. Never another participant's, never an operator's.
- **an anonymous session** (`browser_read_only`, `participantId` null) —
  **nothing.** Not one mission, not even an operator-started one.

The third clause is the one that deserves an argument, and section 4 is that
argument.

`get` / `cancel` / `retry` answer `null` for a mission that does not exist AND for
one the caller may not see — deliberately the same answer, so the route's existing
404 covers both and nothing can be probed. `cancel` and `retry` refuse **before**
touching the record, so a mission cannot reveal it was targeted by changing.
`start` returns `LiveMissionUpdate | null` and refuses a read-only scope outright,
on a taken id and a free one alike: starting runs the three-role pipeline, so a
watch that could start could spend. The idempotent branch still returns a
participant's own in-flight mission; a collision with someone else's id yields
null, which the route answers 409 without naming whose it is.

The scope is derived **once** from the kept authorization decision and from nothing
else — never from the request body, which is what a caller claims rather than what
they are.

## 4. THE RESIDUAL: the paired-browser watch of an operator mission is now closed

Read this section before approving. It is a deliberate loss of an intended
behaviour, not an oversight.

A pairing grant is a real credential, and watching a Julius mission run from a
paired browser is a real product feature. This change stops that watch working
for **operator-started** missions, and the reason is a fact about the credential
rather than a judgement about the feature:

> `StoredGrant` and `StoredSession` (`relay-bridge/browser-session/grants.ts`)
> carry `{grantId/sessionId, secretHash/tokenHash, origin, expiresAt, scope,
> participantId, consumedAt/revokedAt}` — and **no mission, run, or resource
> field of any kind.**

So "the mission scope explicitly granted to that paired watch" is, today, the
empty set. A credential whose granted scope is empty must read nothing. The
alternative — admitting any redeemed grant to every operator-started mission —
is generic unauthenticated mission readability wearing a pairing credential, and
it is exactly what a stolen or over-shared grant would exploit. Holding a valid
grant is not the same as having been granted a mission.

Proof 32 pins the grant's key set exactly, and proof 33 the session's, so a
future field cannot appear quietly: whoever adds one breaks those proofs first
and must then decide, on purpose, what `missionVisibleTo` does with it.

**The defined way to restore the watch**, when you want it, is to make a grant
able to name what it is a grant TO:

1. `reviewer pair-browser <origin> --mission <missionId>` mints a grant carrying
   that mission id;
2. the id is stored on the grant, inherited unchanged by the session it is
   redeemed for (the exchange already cannot widen what was minted), and
   surfaced on the browser decision;
3. `MissionOwnershipScope` gains that id, and the anonymous branch admits exactly
   it and nothing else — still read-only, still no cancel, retry, start or
   enumeration.

That is a reviewable authority change with its own proofs, not something a
security repair should infer on your behalf. Until it exists, the closed door is
the honest one. Nothing about the **operator's** own view of a mission changes,
so the founder can watch any mission today with the operator credential exactly
as before.

## 5. Evidence

- **41 ownership proofs** against the real registry, the real session store and
  the real authorization gate, in eight sections:
  - **A (1–9)** the rule over every combination of owner and asker, including
    proof 8 (an anonymous session sees nothing, swept over every owner shape) and
    proof 9, which holds the null trap open: the operator and an anonymous
    session must get **opposite** answers on the same mission — an assertion
    that could not even be written if the scope were one nullable field.
  - **B (10–16)** reading, including non-probeability for a participant (15) and
    for an anonymous session (16): a real operator mission and a fictional one
    are the same answer, so a paired browser cannot discover which ids are live.
  - **C (17–20)** cancelling, asserting the owner's mission is **unchanged**
    after a refused attempt, not merely that the attempt returned null.
  - **D (21–23)** retrying — the vector that spends.
  - **E (24–27)** starting, including proof 25: a read-only session starts
    nothing on a free id either, and no record is left behind.
  - **F (28)** the operator, byte-for-byte unchanged on every verb against both
    an operator-owned and a participant-owned mission, because the regression
    that would matter most here is a security repair that quietly narrowed the
    operator.
  - **G (29–37)** what a pairing grant actually confers — mint, redeem, present.
    Proof 34 is the end-to-end one: a valid, correctly-redeemed grant is
    **admitted** at the route (`/mission/:id` is in `BROWSER_READABLE`, so the
    decision really is `browser`) and still reads neither an operator's mission
    nor a participant's. A route-level allow is not an ownership decision — which
    is precisely the confusion that produced the original hole. Proof 37: offered
    an identity on a read-only grant, the store drops it, so read-only means
    acting as nobody.
  - **H (38–41)** the wiring, read off `server.ts`, because A–G drive the
    registry directly and would every one of them still pass with the guard
    unreachable from production.
- **19 adversarial mutations, 19 killed, 0 survivors.** Among them: the rule
  removed; #143's exact formula reintroduced (M2); **the anonymous branch widened
  to every operator mission — the residual above, taken (M3)**; the branch
  inverted (M4); `cancel` refusing only after it had already mutated state (M6);
  `retry` unscoped (M7); a read-only session allowed to start a mission (M9) and
  the subtler version that refuses only a taken id (M10); the operator narrowed
  (M11); each of the four routes dropping the scope (M12–M15); `/missions`
  enumerating for a null participant (M16); the 409 naming whose mission it is
  (M17); a read-only grant minted **with** the requested participant (M18); and
  the route table admitting POST from a read-only session (M19).
- Full suite on the frozen tree: **10,376 passed, 0 failed**, 530 files passed
  (3 skipped files, 30 todo). Four-pass typecheck clean; `build`, `relay:build`,
  `relay:bridge:build` clean; `git diff --check` clean.
- `relay-repository-boundary.mjs`, `relay-parity-gate.mjs`,
  `relay:surface-parity:check:strict`, `julius:harness:check` all pass.
- Drills: `relay:cli:contract-verify`, `relay:yc-demo:check`,
  `relay:persistence:contract-verify`, `relay:persistence:recovery-drill`,
  `relay:workspace:verify`, `relay:claude:contract-verify` — all pass, no
  provider call.

## 6. Not carried over from #143

The original also bumped `nanoid` and `hono` in `package-lock.json` against
advisories current in August. Those pins are seven months stale and this tree's
lockfile has moved; replaying them would be guesswork. Dependency posture is
audited on its own terms, separately, rather than smuggled in on a security
repair whose diff should be readable.
