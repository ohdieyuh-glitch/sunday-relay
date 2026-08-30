# Julius tooling and capability audit

**Audit target:** the consolidation candidate based on main `96451fc0c8da59de792d973113c4e203ddab6f01`, including the effective #198 Julius tip, #185 Relay boundary tip, #201 C.A.R.D. seam, and the new provider-neutral tool substrate. A capability is marked **wired** only when a production composition calls it; tests alone are not wiring.

## Architectural conclusion

Julius remains the authoritative model-independent controller. The domain defines authorization, requests/results, budgets, evidence facts, idempotency, and tool lifecycle. The Node workspace adapter implements local filesystem/Unix behavior behind the port. Provider adapters translate their protocols into `ToolInvocationRequest`; they do not define policy. Relay terminal code may project audited facts but does not execute commands.

```text
worker/provider protocol
  → ToolInvocationRequest
  → JuliusToolController
      → typed registry
      → C.A.R.D. decisions (tool/read/mutate/process/network)
      → budget reservation
      → audit lifecycle
      → JuliusToolAdapter port
  → NodeJuliusToolAdapter
      → bounded workspace filesystem or /bin/bash --noprofile --norc -lc
  → normalized result + evidence + mutation hashes
  → Julius authoritative continuation/verification
```

The Gauntlet feature is absent from Julius production identifiers and imports. Generic iterative-review bounds remain in C.A.R.D.; the activated feature consumes generic interfaces from `mission/gauntlet`.

## Julius capability matrix

Legend: **Y** proven in the candidate; **P** partial/model-only; **N** absent or unreachable. “API” means the generic Julius runtime API, not merely an exported function. “E2E” means a composed scenario, not a unit test.

| Capability | Domain | Persisted | Wired | Reachable | Policy | Concurrent safe | Recoverable | Evidence | Observable | API | E2E | Finding |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Durable runs/task DAG | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Runtime loop composes claims and transitions. |
| Leases/stale authority | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Generation fencing and stale-completion tests exist. |
| Worker registry/provider routing | Y | P | Y | Y | Y | Y | Y | Y | Y | Y | Y | Registry itself is composition state, not a durable catalog. |
| C.A.R.D. | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | #201 supplies one UI authority; tool operations are generic. |
| Budgets/retry/fallback | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Tool calls and actual runtime settle the budget. |
| Sub-agents | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Child permissions must be a subset; same pipeline executes children. |
| Context snapshots/Project Brain | Y | Y | Y | Y | P | Y | Y | Y | Y | Y | Y | Compilation is bounded; production Project Brain feed composition needs deployment verification. |
| Independent review/verification/repair | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Reviewer results return to Julius; completion is not a worker decision. |
| Pause/resume/cancel/approvals | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Durable lifecycle stack included. |
| Recovery/idempotency | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Fault-injection and duplicate-result scenarios pass. |
| Trajectories/evals/events/outbox | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Facts only; no hidden reasoning contract. |
| Relay bootstrap/commands/terminal | Y | P | P | P | Y | P | P | Y | Y | P | P | Contracts/adapters exist, but current bridge startup does not yet instantiate a durable Julius runtime. |
| Tool authorization/registry | Y | N | N | N | Y | Y | P | Y | Y | P | Y | In-memory idempotency needs a durable invocation repository before multi-process deployment. |
| Filesystem/search/mutation | Y | N | N | N | Y | P | P | Y | Y | P | Y | Real disposable filesystem proven; mutation provenance contains before/after hashes. |
| Bash/process/test/build | Y | N | N | N | Y | Y | P | Y | Y | P | Y | Real spawn/process-group lifecycle proven locally. |
| Network isolation | Y | N | P | P | Y | P | N | Y | Y | N | P | General processes are classified network-capable and denied when network=false. Allowed execution requires a mediated-isolation attestation. This host forbids `unshare`, so a real allowlisted egress runtime is a deployment gap. |
| Coding engineering cycle | Y | N | P | P | Y | P | P | Y | Y | N | Y | Fixture cycle proves read/search/write/Bash/test evidence, but no live provider is connected to this controller yet. |

## Tool registry matrix

| IDs | Structured | Reads | Mutates | Process | Network-classified | Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| `fs.read/list/stat` | Y | Y | N | N | N | Artifact/read facts |
| `fs.write/mkdir/move/copy/remove` | Y | Y | Y | N | N | `FILE_MUTATION`, path + hashes |
| `search.grep/find/glob` | Y | Y | N | N | N | Bounded search facts |
| `process.exec`, `shell.bash` | Y | Y | Y | Y | Y | `COMMAND_EXECUTION` |
| `git.status/diff/show/log` | Y | Y | N* | Y | Y | Command evidence; bounded log |
| `git.apply` | Y | Y | Y | Y | Y | Command evidence; check before apply |
| `test.run` | Y | Y | Y | Y | Y | `TEST_RESULT` |
| `build.run` | Y | Y | Y | Y | Y | `BUILD_RESULT` |

`*` The registry describes status/diff/show/log as nonmutating, but all general processes still require the workspace and network isolation attestations because executable behavior cannot be made safe by parsing command text.

## Security properties proved

- Absolute paths, `..` traversal, and symlink escapes are rejected after resolving the real workspace root and existing parent.
- A no-mutation C.A.R.D. denies Bash/process execution before budget reservation or spawn; therefore denied operations have zero filesystem effects.
- A no-network C.A.R.D. denies all general processes before spawn. Shell command inspection is intentionally not used as a security boundary.
- Bash uses `/bin/bash --noprofile --norc -lc`, a deliberate minimal environment, workspace HOME/TMPDIR, a bounded cwd, separate stdout/stderr caps, timeout/cancellation, and process-group SIGTERM/SIGKILL.
- Secret-shaped output is redacted before normalized results/evidence facts leave the adapter.
- Concurrent duplicate idempotency keys share one promise; completed duplicates return the original result and do not settle budget twice.
- Sub-agent permission narrowing remains in the inherited Julius runtime; a child cannot widen parent permissions.

## Explicit production gaps

1. **Durable tool invocation/outbox:** idempotency and lifecycle are process-local. Add tenant-scoped invocation rows, unique `(project_id, idempotency_key)`, lease generation, atomic budget/outbox settlement, and restart replay.
2. **Deployment sandbox:** the adapter fails closed unless composition declares workspace-only filesystem isolation and mediated network. The production deployment must mint those attestations from a container/microVM runtime, not from worker input. This CI host reports `unshare: Operation not permitted`; no host-level network-denial claim is made.
3. **Artifacts:** output caps are real, but oversized logs are truncated rather than streamed to a durable artifact store. Add encrypted tenant-scoped artifacts and references.
4. **Patch artifacts:** `fs.patch` performs an exact, unique-context replacement with optional optimistic before-hash and records before/after hashes. Persisting the equivalent patch as an artifact remains required.
5. **Provider loop:** existing provider adapters have not yet been translated to emit/consume this tool protocol. The local E2E proves the substrate, not live-model integration.
6. **Resource controls:** process count, CPU, memory, disk quota, and allowed executable sets require the deployment sandbox. Timeout/output/tool-call controls alone are not a complete hostile-code boundary.

These gaps prevent describing the local adapter as a production hostile-code sandbox. The consolidation is founder-reviewable architecture and a tested local execution substrate; production enablement must remain off until gaps 1, 2, 3, 5, and 6 are closed.
