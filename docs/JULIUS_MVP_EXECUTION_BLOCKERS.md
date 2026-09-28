# What stops Julius doing ordinary work, measured rather than described

**This page is the investigation the founder asked for, not a plan.** Every number
was measured in this repository and every mechanism was read in the code. Where a
finding turned out to be false, that is said plainly, because two of the eight
cases in the file-creation brief were already satisfied and I had told the
integration lane otherwise.

**One thing changed while investigating.** File creation is no longer a missing
capability: `src/relay/mission/julius/julius-file-creation.ts` is a pure kernel
decision and the hosted envelope grants `Write` only together with it. It is
COMPOSED AND NOT YET REACHED — no live caller passes a creation policy, and a
test asserts that so the gap cannot be mistaken for working.

---

## The headline, in one table

| # | Finding | Verdict | The task it stops |
|---|---|---|---|
| 1 | Coding Agent cannot create a file | **P0, capability now built, wiring outstanding** | "Add a settings page" — any mission needing a new file |
| 2 | Workspace ceiling is 4 MiB of FILESYSTEM | **P0, an undefended NUMBER, not a wrong control** | Any mission on a real repository, including Julius's own |
| 3 | No network in the sandbox | **P0, and the same blocker as 2** | Any project whose tests need installed dependencies |
| 4 | Node-only image | **P0 for game development** | Compiling or running anything that is not Node |
| 5 | Agent cannot run a bounded command | **P1** | Iterating: format, typecheck, re-run one test, read output |
| 6 | A build is proven only by TEST or DIFF | P1 | A deliverable that is not a file change |
| 7 | One plan task and one build task | P1 | Decomposing a mission into separately reviewed parts |
| 8 | No action capability | POST-MVP | Placing the order rather than preparing it |
| 9 | Research grant is a one-row table in source | P1 | A research mission, without a merge |

---

## 2. File creation: what was actually missing

**Two of the eight required cases were already true.** A created file DOES appear
in `DIFF` evidence, and a new-file mission does NOT park on an empty diff. The
attempt snapshot is `git add -A` into a TEMPORARY index followed by
`git write-tree`, so the tree holds what the DIRECTORY holds, untracked files
included, with the real index untouched. `coder-workspace-new-file.test.ts` proves
it against real git, with a control showing an untouched workspace reports nothing.

I had asserted the opposite to the integration lane as a real constraint before
checking it. It was wrong.

**The one real boundary is an IGNORED path.** `git add -A` honours `.gitignore`, so
a mission whose product lands in `generated/` produces no evidence at all and would
park with nothing missing that anyone could name. That is pinned as a case.

**What was missing was the ability to create the file, and the authority to bound
it.** The obvious fix — move `Write` into the allow-list and rely on the existing
audit — is not safe, and the reason is specific: that audit is a tree snapshot of
the WORKSPACE, its authority is real for everything inside it, and a write to an
absolute path outside it is not caught, it is UNSEEN. The agent is a child process
on the bridge host, not a process inside the sandbox. "Not observed" is the one
answer a containment control may never give.

So the SDK's pre-hoc `canUseTool` asks Julius before any write. The agent requests;
Julius decides; deny is the default; every refusal has a name and every decision is
recorded, allowed ones included, because a permission system that logs only refusals
cannot answer "what did this dispatch create".

**Outstanding:** no live caller passes a creation policy, because the path bounds
live in Julius's coding-agent permissions packet while the invoker seam carries only
a tool policy. Wiring that is a deliberate act with a security consequence — the
first dispatch that can write a file it chose — and it should not arrive as a side
effect. A test fails the day someone does it.

## 3. Command execution: the substrate exists, the policy does not

**The founder's two concepts, separated.** (A) Julius running the declared
verification command, and (B) the Coding Agent running bounded commands while
solving. Julius does A today through `ShellEffectPort.run`, and that port already
carries most of what B needs:

| Control | Present today |
|---|---|
| workspace confinement | yes, the container |
| timeout | yes, `timeoutMs` per call |
| output ceiling | yes, `MAX_SANDBOX_OUTPUT_BYTES` |
| captured stdout/stderr | yes, on the result |
| provenance | yes, an `invocationId` derived from the lease generation |
| authority | yes, a recorded task claim, or the effect is refused |
| deduplication | yes, an `invocationKey` per step |
| cancellation | yes, via the sandbox lifecycle |
| **command policy** | **NO — it takes any command string** |
| **a request path for the agent** | **NO** |
| **a per-dispatch step budget** | **NO** |

**So B is not a new subsystem. It is a policy and a request path on an existing
port.** Today only Julius composes the commands — base, status, diff, test — so no
policy was ever needed. The moment an agent can ask, one is required.

**A structured interface can satisfy the MVP, and raw Bash is not needed.** Julius's
own registry already names the shapes: `test.run`, `build.run`, `git.status`,
`git.diff`, `git.log`, `process.exec`. The safety property that matters is that the
agent supplies ARGUMENTS, not a command line: `test.run` with a file path rather
than `bash -lc "…"`. That removes shell injection as a category rather than
filtering for it, and it maps onto the founder's examples — compile the changed
target, run a focused test, run a formatter or typechecker, inspect output.

**This is a design, not a capability.** Nothing is built for B in this pass, and it
should not be read as available. The symmetric shape to file creation would be a
pure kernel decision over `{toolId, arguments}` plus the same `canUseTool` seam.

## 4. The 4 MiB ceiling: the right control, in the right place, at a number nothing defends

**WHAT IT PROTECTS: host RAM, through the size of the filesystem backing the
workspace.** `assertEnforceableWorkspaceCeiling` calls `statfs` and refuses when the
filesystem's TOTAL capacity exceeds the bound, not when the bytes used do. The
comment beside it gives the measured reason a declared number is not enough: before
the rule, a 200,000-byte write into a declared 65,536-byte ceiling completed in
full. The inode branch beside it has its own measurement: 300,000 directories on a
4 MiB tmpfs pinned 283 MiB of kernel memory while both `df` and `du` reported zero.

**THE CONTROL IS IN THE RIGHT PLACE, and I said otherwise in the first draft of this
page.** The live policy is `readWorkspace: true`, so the live path is always a BIND
MOUNT — and a bind mount carries no size argument. `statfs` on the source is the
only observable property there is, which makes this check logically necessary rather
than merely present. The `--tmpfs` branch beside it needs no check because `size=`
is self-enforcing, which is exactly why it is skipped.

**THE NUMBER IS WHAT NOTHING DEFENDS.** There is no derivation of 4 MiB anywhere in
the repository. The constant's own comment is descriptive — "the ceiling the
real-infrastructure suite declares" — and it entered as a test-suite figure that
hardened into production policy. Three facts put it in perspective:

- the EXECUTOR's own validator accepts a workspace up to 1 TiB, so 4 MiB is Julius's
  choice and not a platform limit;
- the same container is given an UNCHECKED 16 MiB `/tmp` — four times the workspace
  ceiling, on the same host RAM the ceiling exists to protect;
- and a 1 GiB memory allowance sits beside it.

There is a defended 4 MiB in this codebase, and it is a different one:
`MAX_EXECUTOR_RESPONSE_BYTES`, the HTTP response envelope, argued from a measured
worst case of about 3.7 MB. The two numbers are numerically identical and causally
unrelated.

**IT IS NOT ABOUT MODEL CONTEXT, and the two are already fully separate.** The
context packet is built from Project Brain ENTRIES against a character budget
(200,000 for the coder and architect, 24,000 for the reviewer) and touches no
filesystem. The agent reads files on demand through its own tools. Only CHANGED
files come back into a model's view afterwards, at most eight of them at 64 KiB
each, and the paths come from Relay's inspection rather than from the agent. **A
40 MiB workspace would not add one token to any prompt.**

**ONE STRUCTURAL FACT THAT MAKES THIS SHARPER THAN A STORAGE QUESTION.** The hosted
agent runs on the HOST with its `cwd` set to that 4 MiB tmpfs. The Docker sandbox and
its bind mount are used for the verification effects — snapshot, diff, test. So the
ceiling is a bound on the AGENT'S OWN WORKING DIRECTORY, not merely on container
storage.

**MEASURED, through the gate's own `git archive | wc -c` path, which pads every file
to a 512-byte boundary:**

| Workload | tar bytes | Against 4 MiB |
|---|---|---|
| This repository, excluding dependencies, `.git` and build output | 26,081,280 | **6.2x over** |
| `src/relay/` | 15,626,240 | **3.7x over** |
| `relay-bridge/` | 3,952,640 | 94% of the ceiling |
| `src/relay/mission/julius/` | 3,256,320 | 78% of the ceiling |
| One mission slice file | 20,480 | 0.5% |

**And the effective ceiling is lower than 4 MiB, because the workspace is a git
repository.** The provisioning script runs `git init`, `git add` and `git commit`
inside that same tmpfs, and the loose objects land there too. Adding a
gzipped-archive proxy for that cost puts both `relay-bridge/` and
`src/relay/mission/julius/` OVER the ceiling despite each fitting the gate. The
usable budget for a slice is nearer **3.2 MB of source**.

**WHAT REAL MISSIONS HAVE USED: at most 2.7%.** Mission 5, the largest, seeded six
files at 112,640 tar bytes. Missions 4 and 6 used 2.4% and 0.5%. So the ceiling has
never bound an actual mission — it binds only the missions the design cannot express,
which is precisely why it reads as harmless until someone asks for a repository.

**AND RAISING IT ALONE WOULD NOT BE ENOUGH, which is the finding that matters for
sequencing.** A larger ceiling makes "here is my repository" PROVISIONABLE. It does
not make it WORKABLE, because the sandbox has no network with which to install
dependencies and until this pass the agent could not create a file. Those three are
one problem for planning purposes: the ceiling admits the repository, the
pre-sealed dependency install makes its checks runnable, and creation lets the work
produce new files. Any one of them alone leaves a mission that still cannot finish.

## 5. Network: classified, and the answer is not "add network"

| Task class | Needs outbound network | Where it belongs |
|---|---|---|
| Local repository work | No | nowhere |
| Documentation and research | Yes | **already separate** — the research policy and Live Reach, mediated, allowlisted per mission |
| Package metadata | Yes, at provision time | before the sandbox is sealed |
| Dependency installation | **Yes, and this is the blocker** | before the sandbox is sealed |
| Arbitrary API calls | Mission-specific | not in the MVP |
| Arbitrary web access | No | never |

**The separation the founder asked for already exists.** The sandbox knows nothing
about research: a grep for research in `sandbox-limits.ts` and
`docker-sandbox-adapter.ts` finds nothing. Research reach is its own mediated
channel with its own per-mission grant, and a contract cannot grant itself the
internet.

**The MVP need is dependency installation, and the safe form is not network in the
sandbox.** Install into the workspace BEFORE sealing it, then run the check with
`--network none` exactly as today. That keeps the execution sandbox network-free,
which is the property worth keeping.

**Which makes this the SAME blocker as the ceiling.** A populated `node_modules` is
hundreds of megabytes; a 4 MiB workspace cannot hold one. Findings 1, 2 and 3 are
one problem for planning purposes, and the order matters: the ceiling admits the
repository, the pre-sealed install makes its checks runnable, and creation lets the
work produce new files. Any one alone leaves a mission that still cannot finish.

## 6. Game development: what the image actually prevents

The image is `node:22-bookworm-slim` plus `util-linux`, `git`, `ca-certificates`
and `procps`. No compiler, no Python, no .NET, and no network to install one. CI
asserts every mission's command is `node`.

| Representative game-dev task | Possible today |
|---|---|
| Edit Unreal C++ source as text | Yes |
| Create a new source or header file | Yes, once creation is wired |
| Change a configuration file | Yes |
| Run a static or project check | **No — nothing in the image can** |
| Invoke an approved Unreal build | **No** |

**Do not containerize Unreal, and the founder already said so.** The engine is tens
of gigabytes; putting it in a sandbox to satisfy a checklist would be theatre.

**The honest position is that game-dev work today is EDIT-AND-REVIEW, and that is
now a complete path rather than a broken one.** With no deterministic command, the
build is held to its `DIFF` and the Independent Reviewer must still accept — which
is exactly the mode the preflight fix unblocked. A game-dev mission can therefore
complete with a reviewer's judgement over a real change, and with NO execution
evidence. That is a weaker claim than a compiled build and it must be stated as one.

**What would make it stronger is a mediated HOST tool, not a bigger container.**
The build runs where the engine already lives and Julius consumes the result as
evidence. That is the same shape as the executor: Julius asks, something else
performs, the receipt is the evidence.

## 7. Classification, with the fields the founder asked for

**P0 — prevents an ordinary primary MVP workload**

| Finding | Mechanism | Smallest safe fix | Security | Kernel or adapter |
|---|---|---|---|---|
| Cannot create a file | `Write` denied in the hosted envelope | done: pure kernel decision + pre-hoc authority; wiring outstanding | the first dispatch that writes a file it chose; deny-by-default and named refusals | kernel decision + bridge adapter |
| 4 MiB workspace | `statfs` total-size refusal on a bind mount, which is the only observable bound there | provision a larger dedicated store: the NUMBER, which nothing derives, not the control, which is necessary | a bigger workspace holds more of the repository, so `permittedPaths` starts carrying real weight | adapter and provisioning only |
| No network | frozen `DENY` + `--network none` | install dependencies before sealing; keep the sandbox offline | none added, which is the point | provisioning only |
| Node-only image for game dev | one image, no compiler | mediated host build tool, not a bigger image | a host tool runs outside the sandbox and needs its own bound | adapter |

**P1 — materially limits the MVP, with a viable constrained path**

Bounded command execution for the agent, the TEST-or-DIFF evidence vocabulary, one
plan and one build task, and the one-row research grant table. Each has a
constrained path that works today: Julius runs the declared check, a diff proves a
deliverable, segmentation bounds mission size rather than shape, and an operator can
merge a research row.

**POST-MVP**

Acting on the world. Preparation is useful on its own and the breadth proof already
parks an action mission honestly rather than completing on a document that claims
the action happened.

## What this page does not do

**It does not raise readiness.** Nothing here is new evidence of Julius completing
useful work. One capability was built and is unreached; everything else is a
measurement.

**It does not recommend building all of it.** The ceiling and the dependency
question are one problem and are worth solving together. Bounded command execution
is a design that should wait until the first is done, because a command that cannot
see a real repository has little to run.
