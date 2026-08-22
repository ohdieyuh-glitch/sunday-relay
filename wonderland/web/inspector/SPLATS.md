# Gaussian splats in the browser — investigation, not a dependency

**Verdict: do not adopt yet. The blocker is a release, not a capability.**

Wonderland does not depend on any of this and must not until the proof below
passes. Nothing in the inspector loads a splat today.

## What was measured, not read

`spz_probe.py` reads an SPZ header out of the first few KB of the file. Run
against all three of this world's splat exports on 2026-08-22:

| Asset | Container | SPZ version | Points | SH degree |
|---|---|---|---|---|
| `dust_100k.spz` | GZIP | **2** | 98,304 | 0 |
| `ceramic_500k.spz` | GZIP | **2** | 500,000 | 0 |
| `ceramic.spz` (full) | GZIP | **2** | 1,920,000 | 0 |

Two things follow, and both matter more than any renderer benchmark:

* **World Labs writes SPZ v2, in the single-stream GZIP container.** Niantic's
  SPZ v4 (May 2026) replaced that with six parallel ZSTD streams, and their own
  release notes say v2/v3 readers report v4 files as an unrecognised format. We
  are on the *old* side of that break, which is the compatible side for a loader
  written against the earlier format. Had these come back ZSTD, the question
  would already be closed.
* **SH degree 0.** No view-dependent colour. three.js's SH1–SH3 follow-up work
  (PR #34215, August 2026) is irrelevant to these files, and any comparison
  quoting view-dependent quality is measuring something we do not have.

## What three.js actually offers, as of today

* PR [#33950](https://github.com/mrdoob/three.js/pull/33950) merged to `dev` on
  2026-08-08, milestone **r186**. It adds `SPZLoader` and `GaussianSplatMesh`,
  with loaders for `.ply`, `.splat`, `.ksplat` and `.spz`.
* Written in TSL, so it runs on both the WebGPU and WebGL backends — **of
  `WebGPURenderer`**. That is the catch worth stating plainly: it is not an
  addon for the classic `WebGLRenderer`, which is what this inspector uses.
  Adopting it means changing renderer, not adding a loader.
* **It is not published.** `npm view three version` returns `0.185.1`, the
  installed copy has no splat or SPZ file in it, and r186 is not out. Nothing
  here can be tried from npm today.

Third-party options exist — `sparkjsdev/spark` and `mkkellogg/GaussianSplats3D`
— and were not evaluated. Taking on a third-party splat renderer to preview a
backdrop, when the engine renders a MESH and the mesh is what ships, would be
adding a dependency to answer a question nobody has yet asked.

## The isolated proof, when r186 ships

Cheap, and in this order. Stop at the first failure.

1. `npm install three@^0.186` in a scratch checkout — **not** in Wonderland's
   package.json.
2. `SPZLoader` against `dust_100k.spz`, the 98k file. If a v2 GZIP container
   does not parse, everything below is moot and the answer is no.
3. Render it under `WebGPURenderer` in a standalone page, with nothing else on
   screen. Record frames per second on this laptop's integrated GPU, not on an
   L4 — the whole point of the inspector is that it runs where there is no L4.
4. Only then compare against the HQ mesh on the questions the inspector exists
   to answer: does a splat make a flip, a scale error or a framing error EASIER
   to see than the mesh does? If it does not, it is prettier and not more
   useful, and prettier is not a reason to take a dependency.
5. Memory. 1.92M splats at SH0 is roughly 1.92M × (position + scale + rotation +
   colour). Measure it; do not estimate it in a document.

## What would make this worth doing

One thing, and it is not fidelity: a splat is a faithful record of what Marble
actually reconstructed, including the parts the mesh export smooths away. If a
splat view makes the shell's degenerate near-ground visible — the region the
authored plaza has to cover — it would catch a class of fault the mesh hides.
That is a hypothesis. It has not been tested, and this document is not evidence
for it.

## What this must never become

Authoritative. Unreal 5.8 has no splat renderer in this project and nothing here
proposes one; the goal's own rule stands, that importing splats into the engine
would mean shipping a dependency nobody has measured. Browser-side splats would
be an inspection aid on a laptop and nothing more.
