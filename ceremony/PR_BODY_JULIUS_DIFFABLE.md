# Julius PR 10: a source file git cannot diff is a file nobody reviewed

Found while mapping the next boundary: `grep` reported a 52 KB production file
as **binary**. Five production files carry literal NUL bytes, and three of them
were genuinely binary to git — **including two that landed in #279, whose
review therefore could not see them.**

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind. The attempt ceiling is untouched, and no
paid-qualification parameter moved.

---

## The defect

Git decides a file is binary by looking for a NUL byte in its first 8 000, and
a binary file produces

```
Binary files a/relay-bridge/julius/coder-workspace.ts and b/… differ
```

instead of a diff — in `git diff`, in `git log -p`, and **in the pull-request
view a reviewer reads**. The separators were written as raw bytes where an
escape was meant:

```
const SECTION = '<NUL>JULIUS-SECTION-9f2a<NUL>';
const fields  = output.split('<NUL>');
const SAFE_PATH = /^[^<NUL>-<0x1f><0x7f>]+$/u;
```

| file | NULs | to git |
|---|---|---|
| `relay-bridge/julius/coder-workspace.ts` | 6 | **binary** (mine, #279) |
| `src/relay/mission/julius/julius-workspace-attribution.ts` | 2 + 0x1f + 0x7f | **binary** (mine, #279) |
| `src/relay/mcp/domain/mcp-fingerprint.ts` | 1 | **binary** |
| `relay-bridge/julius-live-mission.ts` | 2 | text — the NUL sits at byte 28 852 |
| `src/relay/mcp/domain/mcp-capabilities.ts` | 3 | text — same reason |

The last two were one edit away: move that line earlier, or grow the file, and
the threshold is crossed silently.

**Measured, not assumed.** `git diff --no-index` against a one-line-changed copy
returns no text diff for the three, and a normal diff for `render.ts` — which
holds ESC bytes and is perfectly diffable. ESC is therefore deliberately NOT
refused: the CLI renders real ANSI sequences, and banning them would be a rule
about taste rather than about whether a change can be seen.

## The change

Every NUL is written as an escape. **The character is identical at runtime** —
the escape and the byte are the same character — so no behaviour moves; what
moves is whether the file can be read by the people who approve it. `scripts/source-is-diffable.test.ts` now
fails if any tracked source file carries a NUL, naming the file and the byte
offset, and saying whether it falls inside git's sniffing window.

This PR's own diff still shows `Bin` for three files, because the OLD side is
binary. It is the last binary diff they will ever have.

## The trap is real, and it caught me three more times while I fixed it

- writing the gate file, the tooling turned the escape in my content into an
  actual NUL — **the gate file itself would have been binary**;
- writing the mutant definitions, the same thing, and Python then refused to
  import them: `source code string cannot contain null bytes`;
- a Python heredoc turned `\000` in a code COMMENT into a NUL.

Each time, the gate I had just written caught it. That is the argument for the
gate in one line.

---

## Proofs

**New proofs (7)**

- `scripts/source-is-diffable.test.ts` (3) — the scan is an exported function,
  so the repository check and the known-bad cases run the SAME code: a clean
  buffer, an early NUL (reported `BINARY to git`), a **late** NUL past byte
  8 000 (still an offender, because one edit moves it inside), and several
  files reported together. Plus a check that the file list is real, so the gate
  cannot pass by finding nothing.
- `coder-workspace.test.ts` (2) — **the separator on the wire**: the executor
  prints the marker with `printf`, so the shell text and the constant the parser
  splits on must agree byte for byte; the emitted octal form is pinned, once
  before each of the four sections. And the parser **is not fooled by output
  containing the marker WORDS** without the NUL guards — which is why the guards
  exist at all.
- `julius-workspace-attribution.test.ts` (1) — a path carrying any control
  character or DEL is refused by name, and the rest of the change set survives.
  NUL is excluded on purpose: it is the field separator, so it cannot occur
  inside a field.
- `mcp-domain.test.ts` (1) — a fingerprint cannot be collided by moving
  characters between the domain tag and the value.

## Mutation testing

| Set | Run | Killed | Not killed |
|---|---|---|---|
| PR 10 — the separators, the path rule, the gate | 11 | 9 | 2, equivalent |
| PR 1 – PR 9 regression, at this head | 291 | 276 | 15 — **identical to PR 9, no new survivor** |

Four PR 10 survivors on the first run drove real additions rather than
argument: the gate had no proof it could detect anything (now a tested
function), the separator's wire format was unpinned, and DEL in a path was
untested. Two remain and are **provably** equivalent: `fingerprintValue`'s
domain tags are a closed set and canonical serialization never begins with `.`,
and a capability sort key is `name + fingerprint` where a fingerprint has a
fixed 71-character shape — so in both cases the concatenation is uniquely
splittable and the separator cannot be load-bearing for any reachable input.

The regression set's 15 are the same 9 stale-anchor duplicates (whose
re-anchored twins are all killed in the same run), 2 deliberate
re-measurements, and the 4 analysed at #281 and #283. All 17 PR 9 mutants are
killed here.

## Gates at the frozen head

Frozen head `cdde6cd379b7e3abafab0b59655bd02a364857af`, tree `88efb580718a932aa1f9c46dcf45eca416d93fcd`, on main
`f8ff9ef8217808428d859afe5e5c0471bec43dea`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK; `git diff --check` — clean
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check`
  and `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Broad `vitest run`, whole suite: **12 033 tests on the branch, 177 failing**.
  Seven failures were branch-only; every one is accounted for. Four pass when
  run alone. `reviewer-deadline` **fails identically on the untouched
  baseline**. `repository-target-observer` is load-sensitive git work — it
  passes on a re-run on the branch (43/43, 64 s) and its failing subtest
  differs between runs.
- Honest limitation: the paired baseline run collected 10 192 tests against the
  branch's 12 033, so many suites did not load in that worktree and its
  "baseline-only" side is not trustworthy. The branch-only direction, which is
  the one that matters here, was settled by running each failure in isolation
  against both trees rather than by trusting that comparison.

**CI on the frozen head, all green:** Verify Relay (10m15s),
`first-live-topology` both jobs, `sibling-control-plane`, and the Vercel builds.

## A note on the base

`julius-accept-main` currently refuses main as **unprovenanced**: #282 was
squash-merged onto a base that had moved (my #283 landed first), so the tree on
main is not the tree that was reviewed, and the gate reports
`approved_by=none`. That is not this PR and not mine to revert — the lane that
landed it has been told, and has changed its process. A PR landed with
base == current main and tree == the approved head's tree restores provenance,
which is what this one is shaped to do.

## Not in this PR

- **Artifact bodies are still process-local** — the durable store exists, is
  verified, and is wired to nothing. That was the boundary I was mapping when
  this surfaced, and it is the next one.
- The attempt ceiling (2 declared vs 3 operative) remains the founder's
  decision. The job stays 120 minutes with the coder's share at 40.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
