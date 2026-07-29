# WEBSITE / CLI PARITY CONTRACT

**Founder requirement.** Every meaningful capability developed for the Sunday
Relay website/application must also be implemented in the Sunday Relay
CLI/terminal experience.

This is not a suggestion. It is a permanent product-development requirement.
The website and the CLI are **two interfaces to the same Relay product**, and
they must not become two disconnected products.

---

## 1. What parity means

Both surfaces must share:

- the same product capability
- the same mission semantics
- the same safety rules
- the same permissions
- the same agent identities
- the same Mission Contract behavior
- the same command validation
- the same PSP behavior
- the same import entitlement behavior
- the same status truth
- the same review independence
- the same evidence requirements
- the same budget behavior
- the same failure behavior
- the same trace meaning
- the same user authority

Parity does **not** mean identical visual layout. The website may use graphical
controls, panels, animations, drag-and-drop and responsive components; the CLI
may use commands, prompts, tables, terminal-native selectors, text status and
terminal-compatible animation. Both must expose the same **real capability**.

Parity is **not** satisfied by:

- printing "Available in the website"
- a dead placeholder
- silently omitting the CLI implementation

---

## 2. Parity classes

### `functional_required`

The feature must exist on both surfaces.

Examples: mission creation, Mission Contract editing, agent import, PSP
application, mission commands, approvals, budget changes, review findings,
repairs, evidence inspection, mission cancellation, permission management.

### `semantic_visual_required`

Both surfaces must communicate the same state or identity; presentation may
differ.

Examples: the Relay Dog, mission status, agent status, warnings, completion
state, verification state, release state.

### `surface_specific`

Allowed **only** when the capability genuinely cannot apply to the other
surface — e.g. browser viewport layout, a keyboard-shortcut tooltip, terminal
shell-completion internals.

A `surface_specific` classification requires **all** of:

- an explicit reason
- an explicit owner / approver
- **founder approval**
- documentation
- no missing underlying product capability

A developer may not self-exempt a major product capability. The check enforces
this: a `surface_specific` record without a founder-approved exception fails.

---

## 3. The capability registry

**Canonical file:** `src/relay/parity/relay-surface-capabilities.json`
— **byte-identical in both repositories.**

It is JSON so that one file is read by both the TypeScript tests and the
dependency-free Node check script, with no build step and no second source of
truth. `src/relay/parity/surface-capability-types.ts` types it.

```ts
type RelaySurfaceCapability = {
  capabilityId; name;
  domain: 'project'|'mission'|'command'|'agent'|'psp'|'workspace'|'review'
        |'evidence'|'economics'|'trace'|'identity'|'relay_dog'|'settings';
  parityClass: 'functional_required'|'semantic_visual_required'|'surface_specific';
  websiteStatus: 'not_started'|'planned'|'implemented'|'tested';
  cliStatus:     'not_started'|'planned'|'implemented'|'tested';
  websiteEntryPoints: string[];  cliEntryPoints: string[];
  websiteTestReferences: string[]; cliTestReferences: string[];
  sharedDomainReferences: string[];
  exception?: { reason; approvedBy; approvedAt; expiresAt? };
};
```

**Statuses are evidence-based.** A capability is only `implemented` when a real
entry point exists, and only `tested` when a named test asserts it. A test
verifies that every referenced test file on the local surface actually exists,
so evidence cannot be invented.

### Current records (24)

| Capability | Class | Website | CLI |
|---|---|---|---|
| `relay-dog-identity` | semantic/visual | tested | tested |
| `relay-dog-state-semantics` | semantic/visual | tested | tested |
| `psp-agent-id-import` | functional | tested | tested |
| `mission-contract-creation` | functional | tested | tested |
| `mission-start` | functional | tested | tested |
| `mission-pause` | functional | tested | tested |
| `mission-resume` | functional | tested | tested |
| `mission-cancel` | functional | tested | tested |
| `agent-assignment` | functional | tested | tested |
| `agent-reassignment` | functional | planned | planned |
| `review` | functional | tested | tested |
| `repair` | functional | tested | tested |
| `approval` | functional | tested | tested |
| `mission-status` | semantic/visual | tested | tested |
| `evidence-inspection` | functional | tested | tested |

---

| Mission cost receipts | functional_required | tested | tested |
| Mission budget status | functional_required | tested | tested |
| Mission budget change (change_budget) | functional_required | tested | tested |
| Mission economics summary | functional_required | tested | tested |
| Mission cost breakdown | functional_required | tested | tested |
| Budget warning | functional_required | tested | tested |
| Budget hard limit | functional_required | tested | tested |
| Budget approval | functional_required | tested | tested |
| Cost per verified mission | functional_required | tested | tested |

## 4. The parity check

```bash
npm run relay:surface-parity:check           # local mode
npm run relay:surface-parity:check:strict    # strict CI mode
node scripts/relay-surface-parity.mjs --strict --companion <path>
```

Deterministic, dependency-free (node builtins only), and implemented **once**
in `scripts/relay-surface-parity.mjs` — the npm script and the test suite use
the same functions.

### It detects

- website capability implemented but CLI missing
- CLI capability implemented but website missing
- missing entry points for an implemented capability
- missing test references for a `tested` capability
- unapproved `surface_specific` exceptions
- exceptions missing a reason or a founder identity
- **expired** exceptions
- divergent / unknown capability ids, domains, classes and statuses
- duplicate capability records
- a missing official Relay Dog identity record
- a missing PSP Agent ID import record
- manifest **version** mismatch between repositories
- manifest **checksum** mismatch between repositories

### Cross-repository verification

The two repositories cannot import each other, so parity across them is proven
by a **canonical versioned manifest** plus a **synchronized snapshot**: the
registry is byte-identical, and the check compares manifest version and
checksum with the companion repository.

- **local mode** — if the companion is found, it is compared; if not, the check
  says plainly `cross-repository parity NOT verified` and does not pretend
  otherwise.
- **strict mode (CI)** — the companion is **required**. A missing or unreadable
  companion is a FAILURE. **The check never silently passes when the companion
  repository is unavailable.**

---

## 5. Required task-report section

**From this task onward, every Claude Code development task involving Sunday
Relay must include a section titled `WEBSITE/CLI PARITY IMPACT`,** stating:

- website capability changed
- CLI capability changed
- shared domain changed
- website tests added
- CLI tests added
- parity registry updated
- remaining difference
- founder-approved exception, if any

A Sunday Relay task **must not be reported complete** when a capability exists
on one surface, is missing on the other, and no founder-approved exception
exists. The final status in that case must be:

```
BLOCKED — WEBSITE/CLI PARITY INCOMPLETE
```

`READY` may not be claimed until the required parity exists.

---

## 6. Known gaps

**None.** The registry currently validates clean in both repositories, and
`npm run relay:surface-parity:check:strict` passes on both sides.

### Closed: mission pause / resume (was the milestone blocker)

The CLI has long been able to pause and resume a mission — `/pause` and
`/resume` in the interactive session, issuing Relay Core `pause-run` /
`resume-run` user commands. The website had no equivalent: its live mission
control offered STOP and RETRY only.

That gap is closed. `RelayMissionRunControls` now renders PAUSE and RESUME
beside STOP and RETRY, and every click goes through the **validated Mission
Command Protocol** (Milestone 2) using the canonical `pause` / `resume`
intents:

```
interpret (deterministic) → validate (24-step pipeline) → preview →
prerequisites (checkpoint) → ATOMIC execution → ordered events
```

Nothing in the website control layer applies a status itself. The executor
owns every transition and re-confirms mission and task revisions at apply
time, so a button cannot fabricate a pause, skip a checkpoint, bypass a stale
revision, or invent a resume.

Two limits are stated rather than papered over:

- **Relay pauses its own assignment, not an external process.** Relay moves
  execution to `waiting` and stops assigning work; it does not signal an agent
  process and does not report one as suspended. The success note says exactly
  that. This matches the CLI, whose `pause-run` is also an assignment pause.
- **A terminal run never resumes.** Completed, failed, cancelled, timed-out,
  orphaned and retry-requested runs require retry or reassignment, so RESUME
  is hidden with the exact reason attached accessibly — never a dead control.

The pinned-gap test (`has exactly the known, documented parity gaps — no
more`) now asserts an EMPTY gap list, so any future divergence fails
immediately.

### Shared economics domain (Milestone 5)

`src/relay/mission/economics/` is carried byte-identically by both repositories
(11 dependency-free core modules). Both surfaces render the same
`projectMissionEconomics` output, which is what makes economics parity real
rather than described.

## 7. Shared domains

Where both surfaces need the same rules, the rules live in a byte-identical
shared domain rather than being written twice:

| Domain | Location | Parity proof |
|---|---|---|
| Official Relay Dog sprite + states | website `src/relay/ui/official-relay-dog/`, CLI `src/relay/cli/product/` | `OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS` |
| PSP Agent ID entitlement + import | `src/relay/psp/` in both | `PSP_DOMAIN_CHECKSUMS` |
| Capability registry | `src/relay/parity/` in both | manifest version + checksum |

Each repository hashes its own copies and asserts the shared manifest, so a
change on one surface that is not mirrored on the other fails immediately.
