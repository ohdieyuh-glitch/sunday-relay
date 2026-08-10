# The Founder Mission Pack

Five missions, ordered so everything provable for free comes first.

**This document is generated from `src/relay/mission/founder-pack/founder-missions.ts`.**
The missions are data, validated by `founder-missions.test.ts` against the real
source vocabulary — so a mission here cannot name a field or a source Relay
does not have. If you edit one, edit the data and regenerate.

## How to run one

The browser cannot start a Mission, by design: there is one operator
credential and the browser only ever gets a read-only session. The CLI drives,
the browser observes.

```
POST /relay-api/mission/start
Authorization: Bearer $RELAY_BRIDGE_API_TOKEN
Content-Type: application/json

<the JSON body under each mission>
```

Then watch it at `#/relay/console`.

## What to look at, for every mission

Three things, in this order:

1. **The event log**, not the summary. Order matters — evidence retrieved
   after a plan was made did not inform it.
2. **Requested versus actual.** Every leg records both. If they are identical
   on every leg of every run, nothing asked a provider anything.
3. **What is Unknown.** A field that renders `Unknown` is Relay declining to
   guess. A build that fabricates would have filled it in.

## The missions

### A Mission that must be refused

`fm-1-refusal-is-real` — **costs nothing**

```json
{
  "missionId": "fm-1-refusal-is-real",
  "objective": "Summarise the current pricing page of a competitor and post it to our X account.",
  "evidenceReferences": []
}
```

**Needs:** nothing beyond what is deployed

**Proves:** Relay refuses what it cannot do instead of describing it. No X backend exists, so the publish half is unsupported and says so by name rather than failing vaguely later.

**You caught a fake if:** The run reports a post as sent, queued or scheduled. Nothing in this build can publish anywhere, so any of those words is the product lying.

### A Mission that reads before it plans

`fm-2-evidence-before-planning` — **spends money**

```json
{
  "missionId": "fm-2-evidence-before-planning",
  "objective": "Using the release notes provided, tell me whether upgrading breaks our adapter, and cite what you read.",
  "evidenceReferences": [
    {
      "source": "github",
      "reference": "https://github.com/vitest-dev/vitest/releases"
    }
  ]
}
```

**Needs:** `RELAY_PROMPT_ARCHITECT_MODE=live`, `OPENAI_API_KEY`, `OPENAI_PROMPT_ARCHITECT_MODEL`

**Proves:** Retrieval happens BEFORE the architect plans, the observation reaches it fenced as data, and the Project Brain records that something was read without absorbing what it claimed.

**You caught a fake if:** The plan cites the release notes while the event log shows no retrieval, or the retrieval is timestamped after the architect ran. A plan made from recollection cannot be fixed by evidence arriving afterwards.

### A Mission that asks for a source nobody probed

`fm-3-unready-source-refuses` — **spends money**

```json
{
  "missionId": "fm-3-unready-source-refuses",
  "objective": "Check whether this page mentions our product, and tell me what it says.",
  "evidenceReferences": [
    {
      "source": "web",
      "reference": "https://example.com/"
    }
  ]
}
```

**Needs:** `RELAY_PROMPT_ARCHITECT_MODE=live`, `OPENAI_API_KEY`, `OPENAI_PROMPT_ARCHITECT_MODEL`

**Proves:** READY is observed, never assumed. A deployment that has probed nothing refuses the retrieval as not_ready and the Mission continues with less rather than failing.

**You caught a fake if:** The page content appears in the plan without a probe having been run through /relay-api/live-reach/probe. That would mean readiness was inferred from configuration.

### A Mission that writes code and is reviewed by something else

`fm-4-three-roles-one-change` — **spends money**

```json
{
  "missionId": "fm-4-three-roles-one-change",
  "objective": "Add a guard that refuses an unknown schema version, with a test that fails without it.",
  "evidenceReferences": []
}
```

**Needs:** `RELAY_PROMPT_ARCHITECT_MODE=live`, `OPENAI_API_KEY`, `OPENAI_PROMPT_ARCHITECT_MODEL`, `RELAY_ROLE_CODING_AGENT`, `RELAY_ROLE_REVIEWER`, `ANTHROPIC_API_KEY`

**Proves:** Three roles, three attestations, and a reviewer that did not write the change. The requested and actual model are separate fields and the actual one comes from the provider response.

**You caught a fake if:** The reviewer and the coding agent share an independence group, or the actual model equals the requested one on every leg — which is what a build that never asked the provider would report.

### The same Mission, run twice

`fm-5-the-same-mission-twice` — **spends money**

```json
{
  "missionId": "fm-5-the-same-mission-twice",
  "objective": "Add a guard that refuses an unknown schema version, with a test that fails without it.",
  "evidenceReferences": []
}
```

**Needs:** `RELAY_PROMPT_ARCHITECT_MODE=live`, `OPENAI_API_KEY`, `OPENAI_PROMPT_ARCHITECT_MODEL`, `RELAY_ROLE_CODING_AGENT`, `RELAY_ROLE_REVIEWER`, `ANTHROPIC_API_KEY`

**Proves:** Idempotency is real. The same idempotency key returns the first run rather than starting a second one, so a retried request does not spend twice.

**You caught a fake if:** Two runs appear with different ids for one key, or the second reports a fresh provider call. Either means a retry costs money a founder did not authorise.

## What the pack deliberately does not contain

**No mission that proves a Loop runs.** The only Loop agent this build ships
simulates its iterations and production refuses it by design, so a Loop mission
would either be refused or be a simulation wearing a real run's clothes.

**No mission that publishes anything.** No write backend exists for any social
platform. `fm-1` is in the pack precisely so you can watch Relay say that
rather than discover it later.

**No mission whose expected outcome is "it works".** Each entry names the
observation that would mean Relay is pretending, because a pack of things that
succeed proves nothing about honesty.
