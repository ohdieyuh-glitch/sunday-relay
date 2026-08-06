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
— **one file, read by both surfaces.** (It was previously described as
"byte-identical in both repositories"; the surfaces now live in one
repository, so there is one registry and no mirror to keep in step.)

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
  // Every field below is resolved on disk. `relay …` command notation is
  // legitimate ONLY in cliEntryPoints and cliTestReferences; in any other
  // field it is a failure, because nothing resolves a command on disk.
  websiteEntryPoints: string[];  cliEntryPoints: string[];
  websiteTestReferences: string[]; cliTestReferences: string[];
  sharedDomainReferences: string[];          // REQUIRED, and verified like the rest
  exception?: {
    reason;                                  // a real justification, not a placeholder
    approvedBy;                              // the CANONICAL founder identity
    approvedAt;                              // ISO, not in the future
    expiresAt;                               // ISO, in the future — MANDATORY
    affectedCapability;                      // exactly this capabilityId, no wildcard
    missingSurface: 'website' | 'cli';       // the surface genuinely absent
    evidence: string[];                      // FILES (or file#anchor) that resolve
                                             // on disk — never a `relay …` command
  };
};
```

**Exemption is all-or-nothing.** An exception grants an exemption only when it
is valid in EVERY respect; partial compliance grants nothing. The previous rule
accepted any non-empty `approvedBy` and treated `expiresAt` as optional, so
`{reason: "x", approvedBy: "me", approvedAt: …}` was a self-granted, permanent
waiver that the check reported as PASS. There is also a bounded maximum
lifetime (90 days), and capabilities carrying **core mission truth** — the
Relay Dog identity and state semantics, PSP import, mission contract and
status, review, repair, approval, evidence inspection, and verified mission
cost — cannot be exempted by any approval at all.

**Statuses are evidence-based.** A capability is only `implemented` when a real
entry point exists, and only `tested` when a named test asserts it. A test
verifies that every referenced test file on the local surface actually exists,
so evidence cannot be invented.

**A declared field that nothing verifies is not evidence.** Every declaration
in the record above is resolved against this repository — the file must exist,
sit inside the repository (no absolute path, no `..`, no symlink escape), and
any `#anchor` must name something the file genuinely contains. That includes
`sharedDomainReferences`, which is REQUIRED and names the modules both
surfaces import: it was declared in the registry and walked by nothing, so its
entries were carried, totalled nowhere and never resolved. It is checked now.
An exception's `evidence` is held to the same terms — a waiver may not cite
proof that does not exist, and a `relay …` command may not stand in for it,
because no check resolves a command on disk. The registry currently holds
**zero exceptions**, which is the state to keep.

### Current records (25)

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
| Agent operating profile (runtime, mission contract, environment, tools) | functional_required | tested | tested |

## 4. The parity check

```bash
npm run relay:surface-parity:check           # local mode
npm run relay:surface-parity:check:strict    # strict CI mode
node scripts/relay-surface-parity.mjs --strict --companion <path>   # opt-in
```

Deterministic, dependency-free (node builtins only), and implemented **once**
in `scripts/relay-surface-parity.mjs` — the npm script and the test suite use
the same functions.

A passing strict run reports what it actually inspected, at manifest `1.2.0`:

```text
  declared surface files: 300/300 present
  declared CLI commands: 27 (verified by the CLI's own command tests)
  website entry points reachable: 42/51 mounted
```

The file total counts every declaration that resolved, across all five
declaration fields plus any exception evidence. It rose when
`sharedDomainReferences` joined the fields the checker walks — those
declarations existed before and were counted in nothing. It rose again from
200 to 215 when the MCP Foundation registered `mcp-connection-management` and
`mcp-mission-preflight`, whose shared-domain declarations name the projection,
connection, registry, risk, approval and preflight modules both surfaces
render from. It rose to 222 when those two capabilities declared the settings
host that actually mounts them.
`docs/documentation-contract.test.ts` holds all three quoted lines to what the
checker really prints, so a stale number fails rather than reassures.

### Existence is not reachability

The third line is a different measurement from the first, and it exists
because the first one was passing while the product's claim was false.
`mcp-connection-management` was declared `tested` on both surfaces — a real
component, a real test, a resolving path — through an entire milestone in
which **no browser entry rendered it**. Every file the registry named existed.
The website still did not have the capability.

So an implemented website entry point must be reachable by following imports
from a real browser entry (`src/relay/main.tsx`), which is what a bundler does
and therefore what "an operator can get to this" means.

A surface that genuinely is not mounted is not silently tolerated. It must be
recorded in `UNMOUNTED_WEBSITE_SURFACES` with a reason stating what an operator
cannot reach, the checker PRINTS every such record on its own `NOT MOUNTED`
line, and the record is verified in both directions: a recorded path that has
since become reachable FAILS (`stale-unmounted-record`), so mounting something
forces the disclosure to be corrected instead of rotting into a permanent
excuse, and a record no capability declares FAILS too
(`unused-unmounted-record`).

One surface is recorded today: `RelayMissionEconomics.tsx`, which nine
economics capabilities declare and which only its own tests render. That is a
pre-existing gap the MCP milestone did not create and did not close.

### It detects

- website capability implemented but CLI missing
- CLI capability implemented but website missing
- missing entry points for an implemented capability
- missing test references for a `tested` capability
- unapproved `surface_specific` exceptions
- exceptions missing a reason, the canonical founder identity, a creation date,
  an expiry date, the affected capability, the missing surface, or evidence
- **expired** exceptions, exceptions with no expiry at all, and exceptions
  whose lifetime exceeds the bounded maximum
- wildcard exceptions, exceptions naming a different capability, exceptions
  claiming the wrong surface is missing, and exceptions on capabilities that
  carry core mission truth
- an implemented or tested website entry point that **no browser entry can
  reach** (`website-entry-unreachable`) — the file exists, its tests pass, and
  nothing in the running website renders it
- an unmounted-surface record that has gone stale in either direction
  (`stale-unmounted-record`, `unused-unmounted-record`)
- declarations that are neither a `relay …` command nor a well-formed file
  path — including a path that whitespace would previously have demoted to an
  unchecked "command"
- a `relay …` command notation in a field that declares FILES
  (`command-notation-not-permitted`). A command is verified by the CLI's own
  command tests, not by this check, so command notation is legitimate **only**
  in `cliEntryPoints` and `cliTestReferences`. Anywhere else — the website's
  own surface, `sharedDomainReferences`, or an exception's evidence — it
  declares something nothing on disk will ever be asked to produce
- a `sharedDomainReferences` entry that does not resolve. The field is REQUIRED
  and names the modules BOTH surfaces import, but it was absent from the field
  list the checker walked: its declarations were carried in the registry,
  counted in no total and inspected by nothing. It is now resolved on exactly
  the same terms as every other file claim
- declared paths that escape the repository (absolute, `..`, or a symlink),
  and anchors naming a symbol or text the file does not contain
- a reference declared twice, one file claimed as BOTH surfaces' entry point,
  and a surface whose every test reference also belongs to the other
- divergent / unknown capability ids, domains, classes and statuses
- duplicate capability records
- a missing official Relay Dog identity record
- a missing PSP Agent ID import record
- when — and only when — a companion registry is passed with `--companion`:
  a manifest **version** mismatch, or a manifest **checksum** mismatch, between
  this repository's registry and that file

### Cross-surface verification

Both surfaces live in this one repository and read the **same** registry file,
so there is no snapshot to synchronize and no companion checkout to compare
against. Parity is proven by reading the canonical versioned manifest directly:
`npm run relay:surface-parity:check:strict` resolves every declared path on
disk and fails if a capability is implemented on one surface and not the other.

- **companion comparison is OPT-IN.** It runs only when `--companion <path>` is
  passed explicitly. No path is searched by default, and no run requires one —
  there is no second checkout to reconcile. When the flag is absent the check
  says so (`companion: not requested — both surfaces are verified in this
  repository`) and verifies both surfaces from the one registry, which is the
  whole check, not a degraded version of it.
- **an explicitly requested companion must be readable.** Passing
  `--companion <path>` is a claim that a registry is there; a missing or
  unreadable file at that path is a FAILURE (`companion-unreadable`), never a
  silent skip. Version and checksum mismatches are then reported as failures
  too.
- **strict mode (CI)** adds one rule the local run only warns about: a registry
  that declares **no verifiable file evidence at all** is a FAILURE
  (`no-file-evidence`), because `0/0 present` must never read as a pass.

*(Historical: this section previously described two repositories that could not
import each other, reconciled by a synchronized byte-identical snapshot, and
said the companion was REQUIRED in CI. That arrangement is superseded — the
surfaces now share canonical modules directly, and the bullets above describe
what the checker actually does.)*

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

**None.** The registry validates clean, and
`npm run relay:surface-parity:check:strict` passes for both surfaces.

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

`src/relay/mission/economics/` is ONE canonical implementation (dependency-free
core modules) that both surfaces import. `src/relay/mission/economics-barrel.ts`
is a thin re-export with no logic of its own, provided because the CLI boundary
permits the `../mission` barrel but not a deep `../mission/economics` path.

Both surfaces render the same `projectMissionEconomics` output, which is what
makes economics parity real rather than described — including the
`dataSourceLabel` that discloses development-fixture figures, and the
`at least` / `at most` bounds that keep an incomplete total from reading as an
exact one.

## 7. Shared domains

Where both surfaces need the same rules, the rules live in a shared domain
rather than being written twice. Two shapes appear below, and the table says
which is which:

- **one implementation, imported twice** — the capability registry, the PSP
  domain, Mission Economics, and the Relay Dog sprite + states. Nothing to
  mirror: each surface renders the same module in its own medium (DOM and
  terminal), so there is no second copy that could diverge;
- **two byte-identical copies, checksum-proven** — no domain is carried this
  way any more. The Relay Dog was the last one, and it was de-duplicated into
  `src/relay/shared/`.

| Domain | Location | Parity proof |
|---|---|---|
| Official Relay Dog sprite + states | `src/relay/shared/` — both surfaces' barrels re-export it | by construction: one module. Each surface's parity suite asserts its barrel resolves here and holds no local copy |
| PSP Agent ID entitlement + import | `src/relay/psp/` — imported by both surfaces | `PSP_DOMAIN_CHECKSUMS` |
| Capability registry | `src/relay/parity/` — read by both surfaces | manifest version + checksum |

Sunday Relay is ONE repository. The website and the CLI are two product
SURFACES inside it, not two checkouts, and they share the canonical Relay
contracts and state directly — so a shared domain is a single module both
surfaces import, never a copy either side has to keep in step.

Where a domain is a single shared module — as the Relay Dog now is — there is
nothing to hash: the module graph is the proof, and
`OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS` no longer exists. Where a domain is still
checksum-proven, the hash guards the domain's own content — it is not
reconciling separate checkouts.

What must stay equal is MISSION TRUTH and product semantics. Presentation is
free to differ — the DOM and a terminal are different media — but the browser
and Node runtime boundaries remain enforced regardless, so "shared" never means
a surface may import code the other's runtime cannot execute.
