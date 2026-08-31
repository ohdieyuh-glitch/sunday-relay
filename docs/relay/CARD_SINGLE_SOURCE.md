# The C.A.R.D. — one configuration, one source of truth

**Invariant (founder, 2026-08-27).** A participant configures the C.A.R.D. of a Compound
Agent **once**. Every part of Relay — the in-world creation flow, the pre-Mission edit
surface, the Mission runner, the request the bridge validates, Wonderland's readiness —
reads and writes the **same authoritative record**. The participant configures again only
when they explicitly **edit** the existing C.A.R.D., explicitly create a **new C.A.R.D.**,
or create a **new Compound Agent** that needs its own.

"C.A.R.D." is the only user-facing name. `psp` survives as an internal wire name on the
bridge (`/relay-api/psp`, `pspId`) and in module names; it never reaches the participant.

## Where the record lives

`src/relay/ui/relay-experience/onboarding.ts` — `CompoundAgentDraft`, persisted durably in
`localStorage['sunday-relay.compound-agent.v1']`. It holds:

| group | fields |
|---|---|
| Compound Agent | `name`, `promptArchitectId`, `codingAgentId`, `reviewerId`, `reviewerPolicy` (catalogue ids from `project-settings/options.ts`) |
| operating profile | `mode`, `network`, `review`, `brainUpdate` |
| execution boundaries | `spendUsd`, `runtimeMinutes`, `agentCalls`, `reviewCycles`, `repairCycles` (`null` = not set, disclosed), `completionRule`, `permissions` |
| activation | `activatedAt` — its presence **is** the activation state |
| identity envelope | `cardId`, `agentId`, `participantId`, `revision`, `createdAt`, `updatedAt` — minted and advanced by the store, never typed by the participant |

Store rules (`saveAgentDraft`, `loadAgentDraft`, `claimCard`, `cardCurrency`, `newCardForAgent`,
`startNewCompoundAgent`):

- identity is minted on the first save and never re-minted; a stale in-memory copy can neither
  re-assign identity nor rewind the revision counter;
- the revision advances **only** when a configured value changes — and every persisted change
  counts: the world persists each edit as it is made, so a C.A.R.D. typed in the world reaches
  activation at a revision in the tens, while the edit surface adds one per Save. The number is
  a change counter, not a session counter, and only its ordering is load-bearing;
- a record saved before identity existed is migrated on read (revision 1);
- sign-in **claims** an unbound record for the participant; a record claimed by someone else is
  refused and left untouched (`wrong_participant`);
- a consumer holding a `CardReference` can ask whether it is still current
  (`stale_revision` / `card_replaced` / `wrong_agent` / `no_card`).

## Projections, not copies

`src/relay/ui/relay-experience/card-projection.ts`:

- `projectMissionConfig(card)` → the domain's `RelayMissionConfig`, run through the same
  `validateMissionConfig` the bridge applies. The C.A.R.D.'s identity travels in the request's
  `pspId` slot as `<cardId>-r<revision>` so a Mission can say which revision it ran under
  (`parseCardRef` reads it back; the runner shows "Provenance: revision N of your C.A.R.D.").
  When the participant explicitly loads a saved profile for a Mission, that slot carries the
  profile's own id instead — a profile saved from the runner is stamped with its own id, never
  with the C.A.R.D. reference it was saved from (`profileConfig`), so provenance is always
  either the C.A.R.D. revision or the profile the participant chose.
- `applyMissionConfigToCard(card, edit)` writes an edit of that shape **back into** the record;
  fields the edit is silent on keep their value; identity is never touched.
- `CARD_FIELDS_NOT_IN_MISSION_CONFIG` names the values the legacy request cannot carry —
  `name`, `network`, `brainUpdate`, `reviewerPolicy`, `activatedAt`. They stay authoritative in
  the record. `unaccountedCardFields()` is asserted empty in tests, so a new field can never be
  dropped in silence.

Role picks are carried as the catalogue ids the participant chose. The bridge records and
displays `roles`; it staffs its slots from the deployment environment and does not resolve
these ids (see `mission-config.ts`). If a registry ever resolves them, it refuses unknown
selectors there.

## The journey after the fix

```
Aquala → ENTER RELAY → create the Compound Agent (8 steps, C.A.R.D. included) → ACTIVATE RELAY
   → sign-in (GitHub)  ── claims the C.A.R.D. for the participant
   → connect a repository
   → Mission runner: "Running under C.A.R.D. <name> · revision N"
        └─ Start Mission sends projectMissionConfig(card); refused if the store moved past
           the revision the runner holds (the current record is reloaded instead)
        └─ Edit C.A.R.D. → the edit surface, hydrated from the record → Save = revision N+1
```

- `RelayConfigureAgent` **edits** the record and never creates one; with no record it says so
  and seeds nothing; a Save over a record that moved since the surface opened is refused and the
  current record reloaded. The old `sessionStorage['sunday-relay.configured-psp']` store and the
  `DEFAULT_BETA_CONFIG` seed are gone — they were the second source of truth.
- The runner's requested view discloses what the request does **not** carry (network, Project
  Brain, reviewer policy) beside what it does.
- A signed-in participant **without** an activated C.A.R.D. is sent to the world to build one.
- A C.A.R.D. claimed by another participant is neither run under nor edited; the only way on is
  an explicit **Create a new Compound Agent**, owned by the signed-in participant.
- **EDIT C.A.R.D.** re-opens the same record; **NEW C.A.R.D.** keeps the Agent and resets its
  operating profile under a new `cardId` (not yet activated); **NEW COMPOUND AGENT** inherits
  nothing. All three are offered in the world (demo and live) and, for a signed-in participant,
  from the Mission runner — where New C.A.R.D. / New Compound Agent route back into the world on
  the right step (the C.A.R.D. step / step one) to be completed and activated.
- Demo and live builds write and read the same record; the live gate additionally binds it to
  the participant and projects it for the bridge. `wonderlandReadiness` now uses the same live
  gate (`VITE_RELAY_LIVE=1`) as the entry.

## Not in this change (deliberately)

A server-side authoritative copy (so the record survives a browser, not just a redirect) is the
next stage; the unmerged `src/relay/mission/card/` domain at `1f6b908` is a candidate for it.
Until then the bridge's saved profiles (`/relay-api/psp`) remain a participant-scoped library a
Mission may explicitly load a profile from — an explicit act, never an automatic override.
