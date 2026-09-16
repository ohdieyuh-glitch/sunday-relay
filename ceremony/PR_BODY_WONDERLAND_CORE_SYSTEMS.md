# Wonderland private-beta core systems: Wonder Web, Project Workspace, multiplayer, accounts, sandbox wallet

**Do not merge without fresh exact-head founder approval of `272e7f77b7535a211f8fc59d34a2943920d80f8f`.**

This is the **worker-authored replacement for #272**. It carries exactly the approved #272 functionality with no new work of any kind, and it exists for one reason: provenance.

A founder-authored #272 squash-merged onto `main` would leave `main` `unprovenanced` under `scripts/julius-main-provenance.mjs`. That would block `julius-accept-main` and live Julius missions until a later worker-authored PR repaired the chain. It fails two independent rules: #272's author is not `julius-worker[bot]`, and its approved tree `ab597edf` is not the tree a squash would land. This PR satisfies both.

---

## Provenance

| | |
|---|---|
| Replaces | #272 (founder-authored), head `b8c81904d8e189bc53aa51bf6a7f29832b91fc7d`, tree `ab597edf…`, left untouched as the reviewed reference |
| This head | `272e7f77b7535a211f8fc59d34a2943920d80f8f` |
| Base | trusted `main` `8f3ea7e15366124af184729553bfc6571eb197e7` (the #271 squash) |
| Tree | `de599a5edcf8bc54747526ba16a7fc982fbc192b`, the post-#271 integration tree qualified on 2026-09-16 |
| Shape | 16 commits over `main`; every commit authored **and** committed by `julius-worker[bot] <325202980+julius-worker[bot]@users.noreply.github.com>` |
| Branch | `relay/wonderland-core-systems-worker` |

### The rewrite changed provenance, and nothing else

Every check below was run against git objects, not restated:

| # | Check | Result |
|---|---|---|
| 1 | head tree vs qualified integration tree | **identical**: `de599a5e` |
| 2 | base | first commit's parent is `8f3ea7e1`; `main` is contained in the head |
| 3 | commit count | 16, the same as #272 |
| 4 | identity | exactly one author and committer line: `julius-worker[bot]` |
| 5 | commit messages | **byte-identical** to #272's 16 approved messages |
| 6 | per-commit patches | **16/16 identical `patch-id`s**; each commit introduces exactly the change its approved original did |
| 7 | #272's effective diff on this base | identical to #272's own diff: 52 paths, same modes and blobs |
| 8 | #271 functionality | all 43 landed #271 paths present byte-for-byte |
| 9 | files lost | none: 1,739 on `main` + 51 added = 1,790, and 0 deletions |
| 10 | real money | `fundingSource: 'PROVIDER'` constructed nowhere; no payment SDK |

### Provenance preflight: the real gate, fed evidence

`scripts/julius-main-provenance.mjs --evidence`. The reviewed tree and base containment are the real values from git. The squash SHA, PR number and approval are hypothetical until they exist, and the output says `source=file`.

| Route | Verdict | Reason (the gate's own words) |
|---|---|---|
| **this PR**, approved at `272e7f77` | **`provenant`** | "main … carries the tree of 272e7f77…, approved by ohdieyuh-glitch" |
| #272 as-is, for contrast | `unprovenanced` | "the landed candidate was authored by ohdieyuh-glitch, not the coding worker" |

After the merge, `julius-main-provenance.mjs ohdieyuh-glitch/sunday-relay main` against GitHub (`source=github`) is the authority, and `ceremony/verify-landing.mjs` runs the ten landing proofs.

---

## Verification

**Relay CI on this exact head, before the PR was opened:** `Relay CI` run [35108690392](https://github.com/ohdieyuh-glitch/sunday-relay/actions/runs/35108690392) (`workflow_dispatch` on head `272e7f77`): **success**, with every step green. Those steps are the repository boundary scan; typecheck (4 passes); tests, where **587 files passed, 3 skipped; 11,539 tests passed, 30 todo, 0 failed**; the website, CLI, bridge and Hermes builds; the production-entry check; the documentation contract; the parity gate; surface parity, normal and strict; the demo readiness check; and offline CLI contract verification. The extra test steps (13, 46 and 2 tests) also passed.

**Integration qualification of tree `de599a5e`** (2026-09-16, local, provider-free):

| Gate | Result |
|---|---|
| typecheck, all four passes | pass |
| Julius harness check | OK; the committed manifest regenerates byte-identical |
| repository boundary | pass |
| parity gate, surface parity strict | pass |
| `git diff --check` | clean |
| full suite, 4 shards (Windows) | 11,543 tests; **142 failures across 42 files, identical on this tree, on #271's head alone, and on pre-#271 `main` `2c91dd11`**. All pre-existing on `main`, with zero #271 × #272 interactions and zero #272 regressions. |

The Windows failures are environment-bound: child processes, Docker, the Hermes binary, POSIX permissions, a stubbed `gh` that does not resolve on Windows, and a `C:\C:\…` path-prefix bug. None is in a #272 file, and Linux CI passes them.

---

## The five priorities

| Priority | Result |
|---|---|
| 1 — Wonder Web + creation output pipeline | **PASS** (software) |
| 2 — Project Workspace / Project Avatar v1 | **PASS** |
| 3 — Multiplayer foundation | **PASS** |
| 4 — Account + persistent identity | **PASS** |
| 5 — Web Wallet v1 (sandbox only) | **PASS** |

**237 tests across 12 files, all passing. Typecheck clean on all four passes.**
Zero file deletions. 51 files added, 1 modified.

---

## Architecture

The repository's own boundary rules decided the shape: `src/relay/mission/` is
PURE (no Node, no clock — structurally tested), Node lives in `relay-bridge/`,
and the UI consumes a projection and decides nothing.

```
mission/wonder-web · project-workspace · multiplayer · wonderland-account · wallet   [pure domain]
relay-bridge/wonder-web                                              [disk, processes, sockets]
ui/wonder-web                                                        [renders a projection]
```

Wonder Web is implemented to the founder's supplied reference: yellow-on-black
chrome, `MY VIEW` plus per-user peer tabs with distinct presence dots, a
lock-prefixed `wonder.app/project` address, the Wonder face as the idle state,
and a `>_ TERMINAL` strip with the `wonder@project:~$` prompt. The tab strip
being PEOPLE is what makes Wonder Web the surface where multiplayer becomes
visible, and it is why the observe/control distinction is load-bearing here.

## The load-bearing guarantees

**READY cannot be faked.** `READY` has exactly one inbound edge and
`completeWonderWebBuild` is the only function that traverses it. It refuses a
non-zero exit, an UNOBSERVED exit (`null` is unknown, and unknown is not
success), a build that produced no entrypoint, and an entrypoint naming a file
the build never wrote. The legal edges are a table, so a test walks the full 7x7
product and proves every unlisted pair is refused.

**The sandbox is enforced, not described.** Each running creation gets its OWN
EPHEMERAL PORT — a port is an origin and an origin is a storage partition, so
one creation cannot read another's storage. `connect-src 'none'` plus
`form-action 'none'` closes egress including the form-POST path that
`connect-src` alone leaves open. Bytes are served inert with `nosniff`, and an
unknown extension becomes an opaque stream rather than script. Bound to
127.0.0.1. Builds receive `env: {}` — inheriting `process.env` would hand
generated code every credential the bridge holds. The browser half is the iframe
WITHHOLDING `allow-same-origin`, asserted explicitly, because adding it later
would make the whole boundary decorative while still looking like a sandbox.

`node_service` and `native_process` are NOT beta-eligible and say why: a host
process has no boundary short of a container or a VM, and this repository has
not built one. They stay in the vocabulary so the pipeline can REPRESENT a
creation it refuses to run, rather than pushing them somewhere unexamined.

**Replication is not authorization, structurally.** The peer view is built from
an ALLOWLIST (`SHARED_PARTICIPANT_FIELDS`), never by deleting private fields
from a full record — a spread-with-deletions leaks whatever the deleter forgot
and fails silently. A test contaminates a participant with an extra field and
proves it never reaches the wire. Moving another player is not merely refused
but inexpressible: the function takes the actor and moves the actor.

**The ledger is authoritative.** Money is integer minor units; nothing in the
wallet uses floating point. `syncBalances` is the only writer of the cached
balance and recomputes from entries, asserted equal after every step of a
purchase. Committing twice leaves one PURCHASE row and the same balance.

**`SUBMITTED` cannot be blind-retried.** `reconcileSubmittedPurchase` demands a
`MerchantOutcome` — a type that cannot express "I do not know" — so a
Continuation Loop cannot reach a retry path on a guess.

**Ownership belongs to a person, not a process.** The identity gap is closed:
`ghu-<id>` was minted into a 30-minute in-memory session while
`players.player_id` only ever held `'tenant'`, and the two never met. The durable
account is keyed by the same derivation the bridge already uses, pinned against
the bridge's own `PARTICIPANT_ID_PATTERN` by test. No credential of any kind is
stored; recovery and login are therefore the same path.

## Proofs

`relay-bridge/wonderland-private-beta-loop.test.ts` runs the whole loop on REAL
DISK with a REAL SOCKET: login → multiplayer → project → creation → Wonder Web →
save → wallet purchase → leave → return. Every store goes out of scope at the
"user leaves" step; the return leg builds fresh instances over the same
directory, so nothing is carried across in memory and only what actually reached
disk can be found. The live HTTP response is asserted to carry
`connect-src 'none'` — the boundary is checked on the wire, not only in a unit
test.

User B is adversarially isolated throughout: cannot open or mutate project A,
cannot run/stop/rebuild/read/save A's creation, cannot reach A's wallet, and
still cannot after a disconnect and reconnect, because ownership is derived on
every call rather than cached at join time.

Step 20 scans every file the run wrote for six secret shapes and asserts it
actually read something (8 files) — a scan that silently read nothing would pass
while proving nothing. That final assertion was verified to execute by
temporarily inverting it and watching it fail.

## Scope held exactly as directed

- **Real money stays disabled.** No provider, no credentials, no custody, no
  real financial side effects. `fundingSource: 'PROVIDER'` is never constructed
  anywhere in the tree. `CommerceProviderPort` remains only the future seam.
- **No `wonder-web.tsv` wiring.** No migration, no edit to
  `.github/julius-live-evidence-dump.sh`, no edit to
  `julius-first-live-mission.test.ts`. The exact required contract is documented
  in `docs/relay/WONDER_WEB.md` so the Julius harness lane can implement it
  without rediscovery.
- **No Unreal implementation.** `wonderland/Source`, `wonderland/Content` and
  `wonderland/Config` are untouched. The only file added under `wonderland/` is
  the generated `Wonderland.DogStages.json` contract, which exists so the Unreal
  session's beat-to-act table and this branch's stage table can be checked
  against one artifact instead of drifting.

## The beta gate moved NOT BUILT → FAIL, deliberately

The gate's own comment said `WONDER WEB OUTPUT` would remain "the constant the
ACCOUNT row used to be" unless a module existed that could make it PASS. One
does now, so the `anyOf` probe finds it and the row reports against evidence
instead of against absence.

**FAIL is the honest verdict, not a regression.** The surface is built, no
evidence bundle carries a `wonder-web.tsv`, and "we have the code" was never a
pass at this gate. It reaches PASS when a real live-mission bundle proves a
completed run's output was opened through Wonder Web. The gate has not been
faked to PASS.

## Remaining external blockers

1. `wonder-web.tsv` live-evidence wiring — Julius harness lane.
2. No Unreal surface consumes `WonderWebSurface` yet; no C++ struct or parity
   entry exists for it. The active Unreal session owns that integration.
3. The pre-existing Windows failures above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Vj7TKWqvdcoNL2Q7kNj8tY
