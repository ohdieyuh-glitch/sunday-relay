# What Julius can and cannot be asked to do, and which of those is a beta blocker

**This page classifies the generality audit's findings.** The audit said where
Julius is narrow. This says which of those narrownesses stops a real user task,
and it names the task. Every claim below was verified by reading the code in this
repository, not inferred from a sweep, and the file and line are given so a
reader can disagree with evidence.

**The one finding already fixed is not in the table.** The paid preflight refused
every empty `testCommand`, contradicting the parser that documents an empty
command as a deliberate declaration. That was the last of three guards that made
Julius coding-only on the live path, and it is fixed with seventeen cases in
`scripts/julius-contract-verification-modes.test.ts`.

**THE CLASSIFICATION TURNS ON WHO COMPOSES THE MISSION.** Several findings are a
LIMITATION when an operator writes the contract and a BLOCKER when a player does.
An operator can select a file slice, seed an empty stub, pick a test command and
merge a research grant. A Wonderland player typing an objective can do none of
those, and the integration lane is building exactly that route. So each row below
is classified twice where the answer differs, because a single verdict would be
wrong for one of the two callers.

| # | Finding | Operator-composed | Player-composed |
|---|---|---|---|
| 1 | Coding Agent cannot create a file | MVP LIMITATION | **MVP BLOCKER** |
| 2 | Coding Agent cannot run a command | MVP LIMITATION | MVP LIMITATION |
| 3 | 4 MiB workspace ceiling | MVP LIMITATION | **MVP BLOCKER** |
| 4 | No network in the sandbox | **MVP BLOCKER** | **MVP BLOCKER** |
| 5 | Node-only execution image | **MVP BLOCKER** for game dev | **MVP BLOCKER** for game dev |
| 6 | A build is proven only by TEST or DIFF | MVP LIMITATION | MVP LIMITATION |
| 7 | One plan task and one build task | MVP LIMITATION | MVP LIMITATION |
| 8 | No action capability, only mediated read | POST-MVP | POST-MVP |
| 9 | Research authority is a one-row table in source | MVP LIMITATION | **MVP BLOCKER** |

---

## 1. The Coding Agent cannot create a file

`relay-bridge/hosted-coding-agent/hosted-envelope.ts:39` allows `Read`, `Glob`,
`Grep`, `Edit`. Line 48 denies `Write` and `NotebookEdit`. The live trio builds
`coding-agent-claude-hosted` (`live-composition.ts:239`), so this is the envelope
the paid path uses, and the kernel has already absorbed the constraint as a
premise: `julius-worker-participation.ts:31` reasons that the agent "cannot create
a file, `HOSTED_DISALLOWED_TOOLS` denies Write, so a file-based channel is not
available to it".

**What works.** Change behaviour in an existing file. Add a function to a file
that exists. Fix a bug. Make a seeded failing test pass. That is the whole of
paid mission 6 and it is a real software-development task.

**What does not.** "Add a dark-mode toggle" if any new file is needed. "Extract
this into its own module." "Add a test for this function" when the test file does
not exist. "Delete the dead file." "Rename this file." Every one of those needs a
human to commit an empty stub first, and CI enforces that the contract never asks
otherwise: `scripts/julius-first-live-mission.test.ts:613` asserts the contract
"must ask for edits, never for a new file".

**Why the two verdicts differ.** An operator writing a contract can seed the stub
and name it, which is what `.github/julius-missions/*/seed/` is. A player typing
"add a settings page" cannot, and nothing in the player route can invent the file
list. For the player path this is the first thing that will fail, and it will fail
by producing a mission that cannot express its own deliverable.

## 2. The Coding Agent cannot run a command

Same lines: `Bash`, `BashOutput`, `KillShell` denied, and the reason given is
sound — a hosted agent with a shell could read the deployment's environment and
defeat the credential boundary.

**This is less severe than it sounds, and the distinction matters.** Julius itself
runs commands. `live-composition.ts` requires an `executor shell port` or refuses
to build the coder, and the runtime runs the mission's base, status, diff and test
steps through it. So the mission's declared check DOES run; what cannot happen is
the AGENT deciding to run something mid-task.

**What does not work.** "Run the formatter." "Regenerate the snapshot." "Update
the lockfile." "Run the migration and then fix what breaks." Anything iterative
where the agent needs to see a command's output to decide its next edit. The agent
gets one shot at the edits and then the runtime checks it.

## 3. The 4 MiB workspace ceiling

`BETA_WORKSPACE_BYTES = 4_194_304` (`workspace-provisioning.ts:26`), enforced by
`assertEnforceableWorkspaceCeiling` (`docker-sandbox-adapter.ts`), which measures
the workspace's filesystem with `statfs` and throws
`sandbox_workspace_ceiling_unenforceable` when `total > workspaceBytes`. Read that
again: the check is on the TOTAL SIZE OF THE FILESYSTEM, not on the bytes used. So
the workspace must be a dedicated store of at most 4 MiB, and a directory on the
runner's root filesystem is refused outright because that filesystem is tens of
gigabytes. `.github/julius-live-workspace.sh` says so in as many words.

**What this means concretely.** Julius never sees a repository. It sees a slice
somebody chose, which is what every mission's `slice.txt` is. "Fix the bug in my
repo" is not a mission Julius can accept; "fix the bug in these three files" is.

**Why it is a player blocker.** Choosing the slice is choosing which files the fix
may touch, which requires already knowing where the bug is. That is a large part
of the work, and it is the part a player is asking Julius to do.

## 4. No network in the sandbox

`sandbox-limits.ts:49` freezes `network: 'DENY'`, `docker-sandbox-adapter.ts:153`
passes `'--network','none'` unconditionally in the `docker create` argv, and
`prepareWorkspace` throws `sandbox_mediated_network_unavailable` if a policy asks
for `MEDIATED`. There is no per-mission override anywhere: the policy is a
module-scope `Object.freeze`.

**This is the row I would argue is the most limiting of all, and it is a blocker
for both callers.** A sandbox with no network and no `node_modules` cannot run the
test suite of essentially any real JavaScript project. CI already encodes the
consequence rather than hiding it: `julius-first-live-mission.test.ts:657` asserts
every mission's command matches `/^node --test /` and forbids `npm `, `npx `,
`yarn ` and `pnpm ` outright, with the comment "the sandbox is `--network none`
and holds no node_modules, so anything that would fetch or resolve a package
cannot pass."

**What works.** A mission whose check needs nothing but Node builtins. Mission 6
qualifies, and that is not a coincidence: it was chosen partly because its import
closure is one file whose only non-builtin import is type-only.

**What does not.** Any project with a dependency. Any mission needing a package,
a schema fetched at test time, or a service.

## 5. The Node-only execution image

`.github/julius-live-images.sh:13` builds the only sandbox image:
`FROM node:22-bookworm-slim` plus `util-linux`, `git`, `ca-certificates` and
`procps`. No Python, Rust, Go, Java or .NET, no compiler, no `make`, and no
network with which to install one. And `julius-first-live-mission.test.ts:640`
asserts `expect(command, mission).toBe('node')` over every mission directory, so a
non-Node mission does not merely fail, it turns this repository's CI red.

**Game development is a primary MVP workload, and it is entirely outside this
image.** Unreal, Unity and Godot are not installable into a 4 MiB network-free
`node:22-slim` container under any configuration. Julius can edit game source as
TEXT — a `.cpp`, a `.cs`, a `.gd` file — and can prove nothing about it, because
nothing in the image can compile or run it. For game development the honest
statement is that Julius can propose a change and an Independent Reviewer can
judge it by reading, with no deterministic evidence available at all.

## 6. A build is proven only by TEST or DIFF

`bootstrap.ts` chooses the build task's required evidence, and the live coder
records only `TEST` and `DIFF` for a build. Every `ARTIFACT` row in
`live-workers.ts` belongs to the architect, a consultation or a rebuttal, and
`verifyTask` scopes evidence to the task, so those never satisfy a build.

The contract can now DECLARE what proves a criterion, and the gate deliberately
restricts that vocabulary to `TEST` and `DIFF` with the reason attached: a
contract allowed to require `ARTIFACT` would pass every check and then park in
`VERIFYING` forever, after the whole mission's spend. Naming a producible set is
the fix; widening the producible set is a separate change to the live coder.

**What does not work.** A mission whose deliverable is not a file change. The
breadth proof already parks such a mission honestly rather than completing on a
document that claims the work was done, which is the right behaviour and is why
this is a limitation rather than a defect.

## 7. One plan task and one build task

`bootstrap.ts` seeds exactly `plan` and `build`. Nothing mints a second work task:
the other task types are guidance, architecture, rebuttal, review, repair and
segment continuations. So the architect's plan cannot decompose a mission into
parts that are separately built and separately reviewed.

Segmentation bounds mission SIZE, not decomposition, so this is a limitation on
shape rather than on scale. A mission that would naturally be "migrate the schema,
then update the callers, then update the tests" arrives as one build.

## 8. No action capability, only mediated read

`julius-research-policy.ts` refuses any action verb in a research allowlist, with
the correct reasoning that "research is looking" and a mission must not authorise
a worker to act on the world by putting the verb in a research allowlist. There is
no other door: combined with `network: 'DENY'` and no `WebFetch`, Julius's only
channel outward is a mediated read.

**This bounds the founder's fourth mission class to PREPARATION.** Julius can
produce the shopping list, the draft email, the filled form. It cannot place the
order, send the mail or submit the form. The breadth suite already proves an
"order the groceries" mission parks unverified rather than completing on a document
claiming the order was placed, which is the behaviour to keep.

This is POST-MVP because acting on the world is a larger authority question than a
capability gap, and because preparation is genuinely useful on its own.

## 9. Research authority is a one-row table in source

`scripts/julius-live-contract-check.mjs` holds `MISSION_RESEARCH` with exactly one
entry, granting `read_item` on `www.postgresql.org` to `julius-continuous-1`.
Everything else falls to `NO_RESEARCH` with every budget at zero, and a contract
declaring research without a grant is refused: "a contract cannot grant itself
research authority."

**The shape is right.** A contract must not grant itself the internet. The
limitation is that the only grant path is a merge, so a research mission cannot
research until someone lands a row. For an operator that is a pull request. For a
player it is a blocker, because a player cannot merge.

---

## Two things this page deliberately does not do

**It does not recommend building any of these before beta.** The founder's
instruction was to classify, and several of these are weeks of work that would
compete with the paid qualification mission for the same time.

**It does not lower the readiness number.** Nothing here is new capability lost;
it is existing capability described accurately for the first time. The number
moves on evidence from a paid run, not on a better description of the same code.

## How to re-check every number on this page

```
node --test                                  # not used here; these are greps
grep -n "HOSTED_ALLOWED_TOOLS\|HOSTED_DISALLOWED_TOOLS" relay-bridge/hosted-coding-agent/hosted-envelope.ts
grep -n "BETA_WORKSPACE_BYTES=" src/relay/workspace/julius-tools/workspace-provisioning.ts
grep -n "sandbox_workspace_ceiling_unenforceable" src/relay/workspace/julius-tools/docker-sandbox-adapter.ts
grep -n "network: 'DENY'" relay-bridge/julius/sandbox-limits.ts
grep -n "FROM node:22" .github/julius-live-images.sh
grep -n "toBe('node')\|never for a new file" scripts/julius-first-live-mission.test.ts
```

`scripts/julius-generality-classification.test.ts` runs the load-bearing ones, so
a drift in any of them fails rather than leaving this page quietly wrong.
