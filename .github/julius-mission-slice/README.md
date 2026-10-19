# The slice harness

Two files, no dependencies, seeded into `.julius/` of a mission workspace whose
seed is a SLICE of this repository rather than a throwaway tree.

They exist so that the sliced files can be **byte-identical** to the ones in
Sunday Relay: `resolve.mjs` teaches Node the extensionless relative imports Relay
writes, and `loader.mjs` registers it for the test process and every worker
`node --test` forks. Nothing here is part of a mission's deliverable — it is
committed in the seed, so `git diff` reports it only if a worker changes it,
which no mission asks for.

Type stripping needs no flag: the sandbox image is `node:22-bookworm-slim`, and
Node 22 runs `.ts` under `node --test` on its own. Verified against the real
binary, not assumed.

See `docs/JULIUS_MISSION_SANDBOX.md`.
