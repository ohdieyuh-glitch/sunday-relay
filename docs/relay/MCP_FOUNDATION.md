# Sunday Relay — MCP Foundation

**Relay is an MCP host and a policy authority.** Agents do not connect to MCP
servers. They ask the Relay MCP Gateway, and the Gateway decides.

This document describes what is implemented in this milestone, and — with equal
weight — what is not.

---

## 0. What this milestone is NOT

Stated first, because the most common failure of a document like this is
implying capability that does not exist.

Relay does **not** have:

- live GitHub MCP;
- live filesystem MCP for users;
- live database MCP;
- live browser MCP;
- live deployment MCP;
- a public marketplace, or any MCP publishing flow;
- production OAuth;
- any MCP production deployment.

Every registry entry that ships today is a **simulation fixture** marked
`simulation: true`, connecting to no live service. The CLI and the website both
render that flag on every row. `mcp-mission-psp.test.ts` asserts it over the
whole registry, so an entry added without it fails a test rather than appearing
in the product as a live connector.

Relay is also **not** an MCP server. §12 below records the architectural
contract for that; nothing of it is implemented, and
`relayMcpServerIsAvailable()` returns `false` with no flag that changes it.

---

## 1. Protocol and SDK

| | |
| --- | --- |
| MCP protocol revision | **2025-11-25** |
| SDK package | `@modelcontextprotocol/sdk` |
| SDK version | **1.30.0**, pinned exactly |

The version is pinned with no range operator. `mcp-boundary.test.ts` asserts the
`package.json` entry matches `^\d+\.\d+\.\d+$` and starts with `1.`, so a
floating range, a `latest`, or a v2 alpha fails a test.

### Why Relay re-checks the protocol version itself

The pinned SDK exports:

```
LATEST_PROTOCOL_VERSION             = '2025-11-25'
DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26'
SUPPORTED_PROTOCOL_VERSIONS         = [2025-11-25, 2025-06-18, 2025-03-26,
                                       2024-11-05, 2024-10-07]
```

So `client.connect()` succeeding proves only that **one of five** revisions was
spoken, and a server that says nothing lands on 2025-03-26. Relay's baseline is
2025-11-25 and only that. Both transports therefore capture the negotiated
revision through the SDK's own `Transport.setProtocolVersion` hook and re-check
it with `negotiateProtocol()` before handing a client out; the connection
manager checks it again. A client that cannot speak the baseline is closed at
the boundary rather than returned.

`MCP_SUPPORTED_PROTOCOL_REVISIONS` is a list of one, deliberately. Accepting a
second revision means every capability, annotation and error shape below it has
a second behaviour that nothing in this repository tests.

The **2026-07-28 draft is not the baseline.** It appears in
`MCP_KNOWN_REVISIONS` so a server announcing it is refused with a stated reason
rather than falling through a generic "unknown version" path.

### Transports

| Transport | Status |
| --- | --- |
| local **stdio** | implemented |
| remote **Streamable HTTP** | implemented |
| deprecated HTTP+SSE | **not supported**, named with a reason |
| WebSocket | not part of the spec Relay implements |

---

## 2. Architecture

```
src/relay/mcp/
  domain/       Relay-owned normalized contracts        (pure, browser-safe)
  policy/       risk, permissions, approvals, redaction (pure, browser-safe)
  registry/     curated server definitions              (pure, browser-safe)
  mission/      mission binding, preflight, Brain       (pure, browser-safe)
  psp/          PSP requirements and trust manifest     (pure, browser-safe)
  gateway/      the Relay-controlled invocation gateway (pure, browser-safe)
  client/       connection manager                      (server-side)
  transports/   stdio and Streamable HTTP + the SDK     (SERVER-ONLY)
  testing/      offline fake servers and fixtures       (SERVER-ONLY)
```

### The SDK adapter boundary

**The MCP SDK is imported by `transports/` and `testing/` and by nothing else.**
Everything above speaks `McpClientPort` from `domain/mcp-ports.ts`, which
contains no SDK type in any signature. `mcp-boundary.test.ts` enforces this
structurally and names the offending file when it fails.

Three consequences, each of which is the actual reason for the rule:

1. the gateway, the policy layer, the preflight, the CLI and the website can be
   written, typed and tested with **no SDK installed at all** — and are;
2. an SDK upgrade changes `transports/` and nothing else;
3. nothing durable can hold a live handle. A raw SDK object owns a socket or a
   child process; storing one in a snapshot, a capsule or a ledger entry turns
   that record into a resource leak.

### Where Relay does NOT use the SDK, and why

`transports/stdio-process-transport.ts` implements the SDK's own `Transport`
interface instead of using `StdioClientTransport`. **No JSON-RPC is written by
hand** — the SDK's `ReadBuffer`, `deserializeMessage` and `serializeMessage`
do the framing and the SDK `Client` owns all protocol behaviour. Only the
process is Relay's, for two verified reasons:

1. **`StdioClientTransport` copies parent environment.** It spawns with
   `env: { ...getDefaultEnvironment(), ...serverParams.env }`, and on POSIX
   `getDefaultEnvironment()` returns `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`
   and `USER` read from `process.env`. There is no option to disable it. An
   environment built from empty that the transport then merges parent variables
   into is not an environment built from empty.

2. **It cannot prevent orphans.** Its spawn options have no `detached`, so the
   child joins Relay's process group and `process.kill(-pid)` is unavailable.
   Killing only the direct child leaves any helper the MCP server spawned
   running after the mission ends.

---

## 3. Identity — a label is not a verification

Four fields, never merged:

| Field | Meaning |
| --- | --- |
| `configuredName` | what the operator typed. Carries no authority. |
| `requested` | what the curated registry entry expects. |
| `declared` | what the server said it was. **Untrusted input.** |
| `verified` | what Relay independently confirmed, and how. `null` until it did. |

`declared` and `verified` are separate because merging them makes a server's own
claim into Relay's belief about it. Every policy decision reads
`identityConfirmed()`, never a name.

Also kept separate: configured vs. actual transport; requested vs. negotiated
protocol; configured capability expectations vs. discovered capabilities.

**What verification means today, honestly:** for stdio it is a match between the
registry's declared identity and the server's own declaration, plus the
executable allowlist that decided what could launch. For Streamable HTTP it adds
the origin the response actually came from. It is **not** a signature check —
Relay has no publisher-signing story yet, and `verificationMethod` says
`registry_match`, not something stronger.

---

## 4. Connection lifecycle — fourteen states, not a boolean

```
configured  connecting  negotiating  ready  degraded
authorization_required  permission_blocked  capability_changed
unreachable  protocol_mismatch  malformed_response  timed_out
shutting_down  closed  failed
```

`connected: true` cannot distinguish a server that is up but unauthorized from
one that is up and authorized, and makes `permission_blocked` look like
`unreachable` — so the operator fixes the network when the problem was a policy.

**Only `ready` may invoke.** `canInvoke()` returns false for the other thirteen,
including `degraded` and including `capability_changed`, which exists precisely
so a mid-mission surface change **pauses** invocation instead of silently
widening it. There is no direct `capability_changed → ready` edge; re-entry goes
through `connecting`, because that edge is exactly "inherit the old approval".

A connection is bound to one account, one workspace and optionally one project.
There is no pooling and no keying by URL — every such optimization is a route by
which Workspace B ends up using Workspace A's authenticated session.

---

## 5. Capability snapshots and fingerprints

A Mission Contract binds to a **snapshot id**, not to a connection, because a
connection's capabilities change underneath it.

Fingerprints are deterministic and reuse the trace domain's `canonicalSerialize`
and `sha256Hex`. Normalization adds, on top of recursive key sorting:

| | |
| --- | --- |
| whitespace | collapsed — a reflowed description is not a capability change |
| set-valued lists (`required`, `tags`, …) | sorted |
| order-significant lists (`enum`, `examples`, `oneOf`, …) | **not** sorted |
| timestamps | never admitted at all |
| unknown extension keys | **preserved** — otherwise a server could change behaviour through an extension field without changing its fingerprint |

The `mcpfp1:` prefix versions the rules, so an old digest can never be compared
against a new one and read as "changed".

### Change classification

Ten kinds, because "the capabilities changed" is not a decision anyone can make:

`tool_added`, `tool_removed`, `tool_description_changed`,
`tool_input_schema_changed`, `tool_output_schema_changed`,
`tool_annotations_changed`, `resource_added/removed/changed`,
`prompt_added/removed/changed`, plus `protocol_version_changed` and
`server_identity_changed`.

**Only `tool_description_changed` does not force re-approval** — a description is
the one part of a tool that cannot change what it does. It is still recorded,
because a rewritten description is a common injection vector.

---

## 6. Risk classification — annotations are evidence, not authority

Classes: `read_only`, `workspace_write`, `external_write`, `financial`,
`deployment`, `credential_access`, `destructive`, `unknown`.

A server that wants to be trusted only has to set `readOnlyHint: true`. If Relay
classified from annotations, its permission model would be a suggestion box the
least trustworthy party fills in. So the classifier **never reads an annotation
to decide a class**; it reads them only to record corroboration or
**contradiction**, and a contradiction is a recorded security signal worth more
than the hint was.

Precedence: a founder-authorized override → the curated registry declaration
(a **floor**, never a ceiling) → Relay's own analysis of the normalized name,
description, input schema and argument values → `unknown`.

**`unknown` fails closed and sits ABOVE `destructive` in severity.** It is not a
middle ground: a tool Relay cannot classify is more dangerous than one it
classifies as destructive, because the destructive one is at least understood.

An override may always **raise** risk. Lowering requires `founderAuthorized:
true` and is recorded in the evidence trail.

An **unverified server identity cannot hold a low classification** — anything
below `external_write` is demoted to `unknown`.

---

## 7. Per-agent permissions

### The Independent Reviewer

**No MCP connections, no tools, no resources, no prompts.** This is the first
branch of `evaluatePermission`, before roles, grants, risk or approvals can be
consulted. It is not a default a grant can override; the test proves it with a
maximally-permissive grant, an explicit approval and a `read_only` class, across
every capability kind.

This mirrors, in the permission layer, what
`relay-bridge/reviewer-harness/hermes/isolated-profile.ts` already enforces in
the process layer with `mcp_servers: {}`. **Both mechanisms are unchanged by
this milestone**, and `mcp-boundary.test.ts` asserts the isolated profile still
emits `mcp_servers: {}` and that no reviewer-harness file imports the MCP
subsystem. `security-reviewer` is on the same permanent denial list: a reviewing
role with tool access is not independent of what it reviews.

### Prompt Architect

Allowed: `read_only` only — documentation search, repository reading, approved
MCP prompts. Denied, and not even approvable: writes, branch mutation, external
messages, deployment, financial, credential access, destructive tools. An
architect that can write is a coding agent with a different name.

### Coding Agent

Allowed: `read_only` and **mission-scoped, path-scoped** `workspace_write`.
Approvable with a human: `external_write`. Denied: deployment, secret mutation,
financial, destructive.

Path scoping **refuses** absolute paths and any `..` segment rather than
resolving them — a prefix check on an unresolved path is how `src/../../etc/passwd`
passes an `src/` filter.

Grants name **exact** capabilities. There is deliberately no wildcard grant.

---

## 8. Approvals — an approval never widens

Policies: `always_allow`, `allow_for_mission`, `allow_once`, `ask_every_time`,
`deny`.

Every widening path §12 of the directive names is a field `approvalCovers()`
compares:

| Widening | Prevented by |
| --- | --- |
| read Repository A ⇏ Repository B | `argumentFingerprint` |
| create a branch ⇏ merge | `capabilityName` |
| query a database ⇏ mutate it | `riskClass` + `capabilityName` |
| write one path ⇏ every path | `argumentFingerprint` |
| invoke one tool ⇏ the whole server | `capabilityName` |
| run once ⇏ unlimited recurrence | `maximumInvocations` / `usageCount` |

An approval is also void the moment the **capability snapshot fingerprint**
changes: the human approved a surface, and the surface moved.

`allow_for_mission` is the one deliberate relaxation — it drops the argument
binding for one named capability within one mission, which a human chooses
explicitly with that consequence stated.

`always_allow` is bounded, not infinite. An unlimited approval is
indistinguishable from turning the check off; a finite ceiling produces an
`exhausted` state a human can see and renew.

---

## 9. The Gateway

The only path from an agent to an MCP server. A model hands it a Relay
`connectionId` and a capability **name that must already exist in an approved
snapshot**. It cannot pass a URL, a command, a server definition, a transport, a
header or a credential — there is no field on `McpGatewayRequest` through which
any of those could travel.

Seventeen steps, in order, with no early success:

```
receive → validate mission/agent → load connection → load APPROVED snapshot →
confirm capability in THAT snapshot → normalize arguments → classify risk →
evaluate permission → resolve approval → create invocation → invoke client →
enforce timeout/cancellation → validate result → redact and size-bound →
store evidence → append audit record → return sanitized result
```

Three properties worth naming:

- **the capability is looked up in the approved snapshot, never on the live
  connection.** A server that grew a tool after approval cannot serve it,
  because the Gateway does not know it exists;
- **permission evaluation precedes any transport contact.** Every refusal test
  asserts a dispatch **count of zero** — "was refused" and "was refused before
  it did anything" are different claims;
- **the Gateway races its own deadline** against the client call, so a transport
  that ignores its timeout still cannot hang a mission.

`settleInvocation()` is the only constructor of a terminal result, and a failure
always derives its own state. A timeout, a cancellation or a process crash
**cannot** be recorded as a completion even when partial content arrived.

Every invocation — including every refusal — writes one audit record carrying
identity, server, snapshot id, capability fingerprint, argument fingerprint,
risk class, permission decision, approval reference, timings, outcome, evidence
references, failure category and transport evidence. It carries a **shape
summary and a digest**, never the argument values, and never raw results.

---

## 10. Results, redaction and prompt injection

Every MCP result is untrusted input in the same sense as a public form field.

**Bounded:** total bytes, block count, per-block bytes, structure depth, item
count. An oversized block becomes an evidence **reference**, never a truncation
that reads as complete.

**Redacted:** secret-shaped material is removed before content reaches evidence,
a log, the ledger or the browser — on the way *out* of a server as well as in,
because a tool result is a convenient exfiltration channel. Local filesystem
paths are redacted too: host topology is not evidence.

**Labelled:** instruction-shaped text is flagged with the signal named
(`override-previous-instructions`, `role-reassignment`, `permission-request`,
`self-approval-request`, `completion-claim`, `allowlist-mutation-request`,
`exfiltration-request`, …).

**Attributed:** every surviving block carries its source server, the capability
fingerprint and the retrieval time.

### What this does NOT claim

**It does not solve prompt injection.** Detection is pattern-based and an
adversary who knows the patterns can phrase around them. Labelling produces
evidence and policy signals. The actual defence is **structural**: returned text
has no path to a permission, an allowlist, an approval, a mission constraint or
a completion, because none of those read tool output. The tests prove it by
trying — feeding the most direct instruction-shaped payload through the Gateway
and asserting the permission decision, the approval set and the mission state
are byte-identical afterwards, and that the escalation the payload asked for is
still refused.

Resources and prompts are treated the same way. A listed resource is not
automatically attached to context; an MCP prompt is **context, not authority**.

---

## 11. Credentials

`McpCredentialReference` is an opaque record that **cannot hold a secret**. It
says a credential exists, who owns it, roughly what it can do and whether it is
valid. It never says what it is. That is why it can travel anywhere Relay's
domain travels — PSP exports, Mission Contracts, Project Brain, the Trace
Ledger, Execution Capsules, the website.

`FORBIDDEN_CREDENTIAL_FIELDS` is checked structurally at every boundary a
reference crosses, and `mcp-boundary.test.ts` asserts no MCP domain record
declares such a field.

Resolution to real material happens behind `McpCredentialResolverPort`, on the
server side, immediately before a transport opens. The resolved value is never a
field on a domain record, never returned from a port, never logged and never
persisted.

- **stdio:** only specifically allowlisted variables reach the child; the parent
  environment is never copied.
- **Streamable HTTP:** authorization is attached server-side to the approved
  origin only, and the guarded fetch **drops** it the instant a redirect changes
  origin.

**No real OAuth is performed.** The SDK's `authProvider` hook is deliberately not
wired. OAuth states are represented truthfully — `authorization_required`,
`authorization_expired`, `insufficient_scope`, `revoked` — and refused, rather
than inventing a custom flow.

---

## 12. Network policy and SSRF

The mistake this refuses to make: *"the hostname string looks public, therefore
the destination is public."* `evil.example.com` can have an A record of
`169.254.169.254`.

Two stages, both must pass:

1. **URL policy** — scheme (`http`/`https` only), embedded credentials refused
   outright rather than stripped, fragments refused, literal addresses
   classified;
2. **resolved addresses** — every address DNS returned is classified. A mixed
   public/private answer is **refused**, not resolved to the safe one: picking
   the safe answer hands address selection to whoever controls the record.

Blocked always, under every policy: cloud metadata (AWS/GCP/Azure/Alibaba/ECS,
including the IPv6 form), link-local, unspecified, multicast, reserved,
unparsable. An IPv6 address that carries an IPv4 address is classified as the
IPv4 address it carries — and it is classified from the **parsed number**, not
from the text, because the two are not the same input. `new URL()` rewrites
`https://[::ffff:127.0.0.1]/` into `[::ffff:7f00:1]` before any policy code
runs, so a rule matching only the dotted-quad spelling never fires in
production. Covered: IPv4-mapped (`::ffff:a.b.c.d` in either spelling),
IPv4-translated (`::ffff:0:a.b.c.d`), the well-known NAT64 prefix
(`64:ff9b::/96`), 6to4 (`2002::/16`) and the deprecated IPv4-compatible form
(`::a.b.c.d`). A malformed IPv6 literal is `unparsable`, which is blocked —
never `public`.

Loopback is blocked by default and permitted **only** through
`MCP_LOOPBACK_TEST_NETWORK_POLICY`, a named object rather than an environment
variable, so production configuration cannot acquire it by accident. Private
networks (e.g. Railway private networking) require an explicit
`allowPrivateNetwork` policy.

Redirects are followed **manually** and counted, each hop re-checked; the
`Authorization` (and `Proxy-Authorization`, `Cookie`, `X-Api-Key`) headers are
**removed** the moment an origin changes and stay removed for the rest of the
chain. Content type must be `application/json` or `text/event-stream`. Response
size is capped **during** transfer, not after buffering.

HTTP authentication failure is classified `authentication_failed`, distinctly
from `server_unreachable`, `timed_out`, `protocol_mismatch` and
`malformed_response`.

---

## 13. stdio process safety

- executable **allowlist** — names only; a path is refused outright. During
  private beta the list contains only the offline fixture servers, because
  Relay has curated no real stdio server yet;
- argument allowlist per registry entry; an argument containing shell
  metacharacters is refused even though `shell: false` makes it inert;
- **no command string exists anywhere** — an executable name and an argument
  array go in and come out, so shell injection is unrepresentable rather than
  defended against;
- environment **built from empty**, never filtered down from `process.env`;
- isolated working directory, or an approved filesystem root;
- startup and per-request timeouts; cancellation;
- stderr piped (never inherited), **redacted then bounded**;
- **process-group termination** — `detached: true` at spawn, then SIGTERM to
  `-pid` and SIGKILL after a grace period. The test asserts against the process
  table, so a helper the server itself spawned is caught, not just the direct
  child;
- non-JSON-RPC stdout is `non_mcp_stdout`, distinct from `malformed_response`;
- a crashed process latches a fatal failure that is checked **before and after**
  every call, so it can never serve one.

---

## 14. Registry

Private beta: **curated definitions only.** There is no "add server by URL"
path, no "add server by command" path, and no marketplace.

States: `draft`, `reviewed`, `approved`, `deprecated`, `revoked`, `blocked`.
Only `approved` and `deprecated` are connectable. `revoked` is a distinct state
from `deprecated` and `blocked` because withdrawing a server after a security
finding is the one registry operation that has to work under pressure — and it
has a fixture that proves the refusal.

Fixture categories: filesystem/repository, Git/GitHub, documentation/context,
database schema (read-only), browser/testing. All `simulation: true`. The
Git-hosting fixture is deliberately `reviewed`, not `approved`: it is the one
category whose write surface reaches outside the workspace, and it stays
unconnectable until a real server is really reviewed.

---

## 15. PSP Agent MCP requirements

A PSP declares **server classes**, never endpoints — a PSP that could name an
endpoint could point an importing user at one.

A PSP may declare required/optional classes, minimum protocol revision,
acceptable transports, required tools/resources/prompts, required scopes,
per-role grants, approval policy, trust requirements, known capability
fingerprints (advisory) and health requirements.

**A PSP export never contains a credential.** The export is built field by field
from an allowlist rather than filtered from an object, so a field added tomorrow
does not appear unless someone adds it deliberately. The test builds an export
from a requirement deliberately polluted with every token-shaped field name and
asserts the result is clean.

The **trust manifest** shown to an importing human names: requires Git hosting,
read-only, modifies workspace, creates external records, deployment capable,
credential access, destructive capabilities, human approval required, verified
registry server, plus every write-capable capability and every operation that
will interrupt a run.

Import readiness reports missing connections, missing credentials, insufficient
scopes, unverified servers, unsupported transports and capability drift.
Required unavailable **blocks**; optional unavailable **degrades truthfully**.
Every import shows: *this agent definition carries no credentials; connect your
own accounts.*

Ship on Sunday commerce is **not** implemented here — only the PSP MCP contract
underneath it.

---

## 16. Project Brain and the Trace Ledger

Project Brain shows configured requirements, connected server identities,
negotiated protocol versions, snapshot ids, health, degraded and unavailable
connectors, permission and approval decisions, invocation summaries and evidence
references.

It never carries raw credentials, authorization headers, unrestricted MCP
output, local executable paths, child environments or refresh tokens.
`assertProjectionIsSafe()` re-derives that from produced output.

Claims and evidence stay separate: `MCP_TRACE_CLAIM_KINDS` records what the
system asserts; evidence references point at what was captured.

---

## 17. Mission Contract preflight

Before a mission is ready, preflight verifies registry entries, connections,
health, protocol acceptability, snapshot approval, required
tools/resources/prompts, credentials, scopes, grants, pre-approvals, network
policy and unresolved capability changes.

Failure categories: `required_connection_missing`,
`optional_connection_unavailable`, `credential_missing`,
`authorization_required`, `insufficient_scope`, `protocol_mismatch`,
`capability_missing`, `capability_changed`, `permission_missing`,
`approval_missing`, `server_unreachable`, `registry_untrusted`,
`network_policy_blocked`.

**Required unavailable → `blocked`. Optional unavailable → `degraded`.** Never
the reverse, and never a third option where a mission proceeds hoping the
connector returns. Every finding names what is wrong in actionable terms and
contains no secret.

---

## 18. Surfaces

**CLI** (`relay mcp …`): `catalog`, `connections`, `inspect <id>`,
`capabilities <id>`, `test-connection <id>`, `approvals`, `approve <id>`,
`revoke <id>`, and `relay mission mcp preflight <mission-id>`.

**Website**: Project Settings → section **14 MCP CONNECTIONS**, in the existing
design language. Not a generic SaaS settings dashboard.

Both render the **same projection**
(`mcp/domain/mcp-surface-projection.ts`) with the same labels for connection
states, risk classes, permission decisions and approval states, so the two
surfaces cannot invent different vocabularies. Both keep the seven facts
distinct: configured, reachable, ready, trusted, authorized, degraded,
capability-changed.

Neither can display a token, a header, a credential, a resolved executable path,
a child environment or an unrestricted result — the projection types have no
such field.

**The website component IS mounted into the running application.** It was not
for the first nine commits of this milestone, and that fact was disclosed here
rather than implied away; this section records what changed.

`RelayMcpConnections` is now rendered by **section 14, MCP CONNECTIONS**, of
`RelayProjectSettings` — the real settings host that `src/relay/main.tsx`
reaches through `RelayPreviewApp`. An operator navigates to it: Relay Entry
Home → PROJECT SETTINGS → the numbered rail entry `14 MCP CONNECTIONS`, or
directly at `#/relay/project/:id/settings`. `REVIEW AND START` moved to 15.

The seam is `src/relay/ui/project-settings/SettingsMcp.tsx`, and it is
deliberately thin: it decides only whether there is an MCP surface to render,
and adds no row, label or state word of its own. Everything it displays comes
from `src/relay/ui/mcp/mcp-settings-view.ts`, which calls the SHARED projection
(`projectCatalog`, `projectConnections`, `projectApprovals`) the CLI calls. The
host supplies state; the view projects it; the component renders it.

**Four states, kept apart.** `loading` claims nothing. `unavailable` states a
reason and is NOT rendered as an empty list — "Relay could not look" is a
different fact from "Relay looked and found nothing configured". `ready` shows
the curated registry and says plainly that no connection and no approval
exists. `degraded` and `blocked` carry a real mission preflight verdict, and
the section reports it in `data-mcp-readiness`; with no mission asking for
preflight the value is `not_evaluated`, which is deliberately not `ready`.

**What the mounted surface is NOT.** It grants nothing: the section renders no
input, select or textarea at all — and no button either. It cannot open a
connection — the browser has no transport, no connection manager and no
credential path, and says so on the page.

`RelayMcpConnections` accepts optional `onReconnect`, `onDisconnect` and
`onRevokeApproval` handlers, and **each control renders only when its handler
is supplied**. The mounted host passes data and no handlers, so it renders none
of the three. This is not tidiness. A button wired to `handler?.(id)` with no
handler is a control that does nothing and reports nothing, and on this
particular page the worst case is exact: an operator clicks `Revoke` on a live
MCP approval, sees no error, and reasonably concludes a risk-bearing approval
was revoked. A dead affordance on a security surface is a lie the page tells,
so there is no dead affordance. Every registry row is a simulation fixture and labels itself. The
Independent Reviewer's permanent denial is stated on the section in every
state, naming the roles read from `MCP_FORBIDDEN_ROLES` rather than a sentence
that could outlive the policy.

The CLI surface was wired from the start: `relay mcp …` and `relay mission mcp
preflight` are routed in `src/relay/cli/main.ts` and run end to end.

**The parity check now proves reachability, not existence.** A declared website
entry point must be reachable by following imports from `src/relay/main.tsx`;
`scripts/relay-surface-parity.mjs` fails `website-entry-unreachable` otherwise.
This milestone is exactly why: for nine commits the registry declared
`mcp-connection-management` as `tested` on both surfaces, every declared file
resolved, and no browser entry rendered the component.

**What the walker counts as an edge, stated exactly.** Comments are stripped
before import specifiers are read, and type-only clauses (`import type …`,
`import { type X } …`, `export type … from`) contribute nothing, because
TypeScript erases them and a surface reachable only through one is not reachable
in the shipped bundle. Both once produced a false pass in the checker whose
whole purpose is preventing one. **Two over-approximations survive and are not
hidden.** A barrel's `export … from './X'` is followed even when nothing
consumes the re-exported binding — the edge is real in the module graph, but a
tree-shaking bundler may drop it. And a TypeScript import-type node in type
position (`import('./x').T`) is erased by `tsc` and counted here; there are
seven, across five files. Both are in the phantom direction, and neither changes
the answer today: a reachability walk driven by the TypeScript parser returns
the same 270 modules, so every target is reachable by a real edge as well.

---

## 19. The offline proof

`mcp-offline-proof.test.ts` runs the whole path against **real spawned MCP
servers speaking real MCP over stdio**, and a real Streamable HTTP server on an
ephemeral loopback port:

```
Mission Contract → MCP preflight → registry verification → connection →
protocol negotiation → capability discovery → snapshot fingerprint →
permission check → approval decision → tools/call → sanitized result →
audit record → evidence reference → clean closure
```

**No LLM. No paid API request. No external network.** A guard makes any external
fetch *fail* rather than succeed quietly, and its attempt counter is asserted to
be zero at the end of the run.

The twenty required scenarios are each a named test: architect read-only,
coding-agent read, mission-scoped write, external write blocked, approval
permits exactly one, reviewer receives nothing, capability change pauses,
required MCP blocks readiness, optional MCP degrades, credential missing blocks,
protocol mismatch ≠ network failure, malformed JSON-RPC never succeeds,
oversized result referenced, timeout ≠ completion, cancellation ≠ completion,
crash ≠ completion, HTTP auth failure classified truthfully, SSRF blocked,
injection labelled and powerless, secrets redacted.

---

## 20. Current limitations

- the mounted website surface is **read-only**: it renders the curated registry
  and any MCP state a host supplies, and it grants, connects and revokes
  nothing. The browser cannot open a connection at all (see §18);
- the browser host supplies NO connection, approval, capability snapshot or
  mission preflight today, so the mounted section shows the registry and an
  empty, truthfully-labelled connection list;
- every registry entry is a fixture; no live MCP server is curated;
- no real OAuth; credential resolution is a port with no production adapter;
- server identity verification is a registry match, not a signature;
- prompt-injection detection is pattern-based and does not claim completeness;
- artifact checksums are `null` on the fixtures rather than fabricated;
- Relay-as-MCP-server is a contract only;
- nothing here is deployed.

---

## 21. Future: Relay as an MCP server

**Not implemented.** `MCP_RELAY_SERVER_STATUS` is `not_implemented` and
`relayMcpServerIsAvailable()` returns `false` unconditionally — there is no flag
that changes either.

Potential future resources: `relay://projects/{id}/brain`,
`relay://missions/{id}/status`, `relay://missions/{id}/evidence`,
`relay://agents/{id}/capabilities`.

Potential future tools: `relay.mission.create`, `relay.mission.pause`,
`relay.mission.resume`, `relay.mission.inspect`, `relay.approval.respond` — the
last requiring an **authenticated human**, never an agent, since an agent
answering its own approval request is the failure the approval broker exists to
prevent.

Never exposed: arbitrary terminal execution, provider credentials, unrestricted
Project Brain, another project's workspace data, mission mutation without an
entitlement check, raw transcripts, or the Reviewer surface — which stays
MCP-free in both directions.
