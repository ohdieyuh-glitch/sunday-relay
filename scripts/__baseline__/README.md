# Frozen review baselines

Byte-exact copies of files as they stood at the head an independent review
BLOCKED, kept so a base-vs-head regression comparison can run **anywhere** —
including CI, whose `actions/checkout` performs a shallow clone in which the
base commit's tree is not available and `git show <sha>:<path>` fails.

| File | Frozen from | Compared by |
|---|---|---|
| `relay-repository-boundary.d21d383.mjs` | `d21d383ab020a7039ee877d5270cd513470d943b` | `scripts/boundary-scanner-regression.test.ts` |

**Never edit a file in this directory.** Each copy is byte-identical to its
source commit, carries no added header for that reason, and is guarded two
ways by the test that uses it:

- when the git object IS reachable (a deep clone), the copy is asserted
  byte-identical to `git show <sha>:<path>`;
- always, the copy's SHA-256 is asserted against the digest recorded in the
  test — so a doctored "baseline" that flatters the repair cannot pass.
