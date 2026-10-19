# Wonder Web — the creation output pipeline

**Status: BUILT. Domain, Node runtime and browser surface all exist and are
tested. The live-evidence dump that flips the beta gate to PASS is the one
remaining step, and it belongs to the Julius live-mission harness lane.**

Wonder Web is Wonderland's in-world browser: the surface that opens, runs and
uses software an AI execution system produced, without the user leaving
Wonderland.

---

## The three layers, and why they are three

| Layer | Path | What it may touch |
|---|---|---|
| Domain | `src/relay/mission/wonder-web/` | Nothing. Pure: no Node, no clock, no network. |
| Runtime | `relay-bridge/wonder-web/` | Disk, processes, sockets. |
| Surface | `src/relay/ui/wonder-web/` | React. Renders a projection; decides nothing. |

The domain is pure because the browser, the CLI and the bridge must all reach
the same conclusion about the same creation. The runtime is where Node lives so
that the honesty rules cannot be bypassed by a convenient local variable. The
surface renders `WonderWebSurface` and computes no authority of its own.

Provider independence is structural: nothing in any layer names a coding
provider. A creation records WHO produced it (`WonderWebProducer.systemId`) and
WHETHER it really happened (`provenance`).

---

## The rule the whole module exists for

**A creation says READY only when a build actually succeeded.**

`READY` has exactly one inbound edge — from `BUILDING` — and
`completeWonderWebBuild` is the only function that traverses it. It refuses:

- a non-zero exit code;
- an **unobserved** exit code (`null`), because a killed or disconnected build
  is unknown, and unknown is not success;
- a build that produced no entrypoint;
- an entrypoint naming a file the build did not write.

The legal edges are a table, not a switch, so the test walks the full 7×7
product and proves every unlisted pair is refused.

---

## The execution boundary

Two questions are kept apart because collapsing them is how a sandbox comes to
be described rather than enforced:

- **Is it permitted?** A capability grant. Fail closed, no wildcard, no
  "grant everything" value.
- **Is it enforced?** An isolation profile, claimed honestly. A profile carrying
  `unenforcedDenials` must carry a `limitation` sentence, and a test asserts the
  pairing.

`static_bundle` is the only beta-eligible runtime, and each clause of its claim
is implemented in `creation-sandbox-server.ts`:

| Claim | Mechanism |
|---|---|
| its own origin | every running creation gets its **own ephemeral port**; a port is an origin and an origin is a storage partition |
| no egress | `connect-src 'none'` plus `form-action 'none'`, which closes the form-POST path `connect-src` alone leaves open |
| inert bytes | explicit content type + `nosniff`; an unknown extension is served as an opaque stream, never guessed into script |
| no credentials | never sets or reads a cookie, and is not the Relay origin |
| loopback only | bound to `127.0.0.1` |

The browser half is the `sandbox` attribute **withholding `allow-same-origin`**.
Both halves are required; a test asserts the omission explicitly, because adding
it later would make the whole boundary decorative while still looking like a
sandbox.

`node_service` and `native_process` are **not beta-eligible** and say why: a host
process has no boundary short of a container or a VM, and this repository has not
built one. They remain in the vocabulary because the pipeline must be able to
REPRESENT a creation it refuses to run — refusing to model them would push them
somewhere unexamined.

A build receives `env: {}`. Inheriting `process.env` would hand generated code
every credential the bridge holds.

---

## Replication is not authorization

`wonderWebAccessFor` returns `control` (the owner), `observe` (a co-present
player), or `none`. Every control action requires `control`; there is no action
an observer may take.

In the surface this is why a peer's tab can appear in the tab strip without
their creation becoming something a stranger can restart. An observer gets no
frame, no terminal cursor, no live controls, and does not see the owner's build
log.

---

## The remaining step: `wonder-web.tsv`

`scripts/wonderland-beta-gate.mjs` already names the contract:

```js
anyOf: ['src/relay/mission/wonder-web/index.ts',
        'src/relay/ui/wonder-web/index.ts',
        'relay-bridge/wonder-web/index.ts'],
```

All three now exist, so the row has moved from `NOT BUILT` to a real probe. It
reaches `PASS` when an evidence bundle carries `wonder-web.tsv` with one row per
mission output actually opened.

**That wiring belongs to the Julius live-mission harness lane, not here**, and is
deliberately left to it. It needs three things, in the harness's own style:

1. A migration creating the table the openings are recorded in — next free
   number at time of writing is `024`.
2. One `dump` line in `.github/julius-live-evidence-dump.sh`, matching the
   existing convention (the filename regex is `/" ([a-z-]+\.tsv)$/gmu`, and
   `wonder-web.tsv` satisfies it).
3. Adding `wonder-web.tsv` to **both** lists in
   `scripts/julius-first-live-mission.test.ts` — the filename list and the
   column-checked query list. A plain `SELECT cols FROM relay_wonderland.<table>`
   is column-checked against the migration SQL; a joined query is not.

Until then the row reports `FAIL` with the basis "a completed run exists, but
this bundle carries no readable wonder-web dump", which is the true statement:
the surface is built and nothing has yet proven it opened a real mission's
output.

---

## What is NOT built

- No live Julius integration. Creations arrive through a deterministic fixture,
  which is what let the pipeline be proven without a paid provider.
- No Unreal surface. The projection is serializable and substrate-neutral so an
  in-world renderer can consume the same `WonderWebSurface`, but no C++ struct or
  parity entry exists for it yet.
- Rebuild-on-source-change, creation deletion, and multi-creation tabs within one
  user's view are not implemented.
