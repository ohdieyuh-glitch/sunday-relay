# Audit: other assumptions of the README class — 2026-09-10 04:30Z

Prompted by run 34433098911, where the preflight died on a filename that was
true of three paid missions by coincidence. The question: **does anything else
in the paid path assume a workspace shape that only the three throwaway-tree
missions happen to have?**

Checked against trusted main `d7af081b`. NOT folded into the frozen candidate
`bafc3603` — the founder may already be running the ceremony script, which pins
that head and tree.

## Result: no second instance found in the production paid path

| Suspicion | Finding |
|---|---|
| Another hardcoded workspace filename | Only `julius-live-preflight.ts:316` (`README.md`) — the one being repaired. Nothing else in the workflow, the provisioner, the live scripts or `relay-bridge/julius/`. |
| **Flat vs nested workspace.** All three prior missions are 4 files at the root; Mission 4 is nested 5 deep plus `.julius/`. A `*` glob or a basename-as-path would break identically. | **Not a production risk.** Nothing in the production path enumerates the workspace. The coder gets `cwd` pinned to `workspacePath` (`hosted-envelope.ts:147`) and discovers files with its own `Read`/`Glob`/`Grep`. |
| Missing `package.json` (all three prior missions ship one; Mission 4's slice has none) | No production reader. The `package.json` in `julius-live-preflight-gates.test.ts:68` is the *repository's*, not the workspace's. Mission 4's test command needs none. |
| `mission-seed.ts` | Database seeding only — no workspace-shape assumption. |
| The live step itself | Invokes a prebuilt bundle with `--contract`; starts no build, depends on no package manager, reads no workspace file. |

## One coverage nuance, not a run risk

`deliverablesOf` in `scripts/julius-first-live-mission.test.ts:80` builds a
slice mission's file list from `slice.txt` **only**, so the `seed/` overlay file
is outside the "every seeded file is named by its contract" check. Mission 4's
overlay *is* named — by `testCommand` — so the rule holds in fact. Worth
widening when something else touches that test; it cannot fail a paid run.

## Mission 4 dispatch-readiness, measured

- `julius-live-contract-check.mjs`: **CONTRACT OK**, 20 USD / 3 cycles, 11 blocking criteria
- provisioned workspace: **39,560 bytes** of 4,194,304; 6 tracked files
- declared test command under Node 22.22.2 type stripping, no dependency:
  **9 of 10 fail** with `memory_trust_not_implemented`, **exit code 1**
- the single passing test asserts the closed vocabularies, which are real values
  in the stub rather than throwing functions — it passes honestly
- the contract names the deliverable path, the spec path as do-not-edit, both
  read-only type sources, the erasable-syntax limit, and no-network/no-node_modules
