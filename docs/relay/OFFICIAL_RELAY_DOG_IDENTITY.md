# OFFICIAL RELAY DOG — IDENTITY SPECIFICATION

Sunday Relay has **one** official Relay Dog. The website/application and the
CLI/terminal are two interfaces to the same product, and they draw the same
dog — same silhouette, same face, same colors, same state meanings.

This document is the specification both surfaces are held to.

---

## 1. The canonical dog

The official Relay Dog is a compact **front-facing voxel companion**:

- three-dimensional, block-built construction
- compact body proportions
- front-facing / slight three-quarter perspective
- upright rectangular ears
- block-shaped head
- cream / bone-white / warm off-white body
- a dark charcoal horizontal facial **visor** band
- two square **amber/gold eyes inside the visor region**
- short squared muzzle
- compact chest
- short block-shaped legs
- visibly dimensional front and side surfaces
- hard pixel edges, no antialiasing that blurs the voxel edges
- no rounded vector illustration, no smooth cartoon outlines

### The retired dog (deprecated)

The CLI previously drew a different dog: **large, flat, two-dimensional,
side-facing, horizontally stretched, mostly white, with yellow rectangular
facial/collar accents, a long rectangular body, a raised rectangular tail and
four long rectangular legs.**

That dog is **retired**. It is gone from the header, the footer, the demo, the
mission console, the interactive session and every reduced-capability
fallback. `official-relay-dog-parity.ts` records its markers
(`LARGE_DOG`, `SMALL_DOG`, `ASCII_DOG`) and a test asserts none of them can
come back.

---

## 2. Canonical asset

| | |
|---|---|
| **Canonical renderer of record** | `src/relay/ui/pixel-dog/RelayPixelDog.tsx` (website) |
| **Canonical asset** | `official-relay-dog-sprite.ts` (pure data, no framework) |
| **Canonical semantics** | `official-relay-dog-states.ts` (pure data, no framework) |
| **Parity manifest** | `official-relay-dog-parity.ts` |
| **Website location** | `src/relay/ui/official-relay-dog/` |
| **CLI location** | `src/relay/cli/product/` |
| **Grid** | 18 × 14 pixels |
| **Poses** | `standing`, `trotting`, `running`, `sitting`, `lying`, `carrying`, `reaching` |

### Palette

| Legend | Meaning | Hex | xterm-256 |
|---|---|---|---|
| `w` | bone / cream white body | `#ece9e2` | 254 |
| `s` | shadow tone (dimensional surfaces) | `#b9b5ab` | 249 |
| `d` | dark charcoal visor band | `#23262e` | 235 |
| `y` | amber / gold eye | `#f2c14e` | 221 |
| `c` | gold collar | `#d9a441` | 179 |
| `.` | empty — **transparent, never painted** | — | — |

The xterm-256 mapping is part of the shared identity (each index is the
nearest RGB match to the canonical hex), so a terminal renders the same dog
rather than inventing its own palette.

### Checksums

The two repositories cannot import each other, so the shared modules are
carried as **byte-identical copies** and proven by checksum. The live digests
live in `official-relay-dog-parity.ts` (`OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS`),
and each repository has a test that hashes its own copies and asserts them.

Because the manifest is itself byte-identical on both sides, a change made on
one surface and not mirrored on the other fails that surface's test
immediately. There is no silent drift.

**Changing the dog is a deliberate two-repository action:**

1. change the art or the semantics,
2. copy the changed file verbatim into the other repository,
3. recompute both digests and update the manifest in **both** repositories,
4. bump `OFFICIAL_RELAY_DOG_IDENTITY_VERSION` when the identity itself moved.

### The sprite is what the website actually draws

`official-relay-dog.test.tsx` renders `RelayPixelDog` for **every pose**, reads
the drawn `<rect>` elements back out of the SVG, and asserts the pixels equal
the shared sprite. The shared asset therefore cannot drift from the website
artwork — if the component changes, the test fails.

---

## 3. Accepted scaling and prohibited distortion

- **ONE uniform scale factor drives both axes.** Independent width and height
  values are prohibited — they distort the body.
- Website: `unit` px per pixel; the SVG is `18 × unit` by `14 × unit`, with
  `shapeRendering="crispEdges"`.
- CLI: half-block rendering (`▀`) pairs two sprite rows into one text cell, so
  one sprite pixel is one column wide and half a cell tall — square on a normal
  1:2 terminal cell. Rendered size: **18 columns × 7 rows**, at every width.
- Empty pixels are **never painted**: transparency is preserved and the sprite
  never carries a background plate.
- No shading or gradient glyphs (`░ ▒ ▓`) — they blur the voxel edges.
- The dog must not overflow its area, overlap status text, or obscure agent
  labels, at desktop or mobile widths.

---

## 4. Renderers

### Website

| Surface | Renderer |
|---|---|
| Workspace state indicator | `RelayWorkspaceDog` → `RelayPixelDog` |
| Home / pre-mission | `RelayHomeDog` → `RelayPixelDog` |
| Motion controller | `relay-dog-motion/` (Milestone 4.5) — the single animation loop |

### CLI

| Surface | Renderer |
|---|---|
| Header logo (all screens) | `headerLogo()` in `cli/product/dog.ts` |
| Footer state + motion track | `footerDog()` in `cli/product/dog.ts` |
| Prompt-5 render surface | `mascot()` in `cli/render.ts` |
| Interactive session dog view | `cli/interactive.ts` |
| Mission Control presentation | `cli/mission-control.ts` |

All CLI surfaces draw from `officialDogRows()`, which reads the shared sprite.
No CLI file draws dog art of its own.

**Known remaining legacy surface:** `src/relay/mission/dog.ts` still contains
the Prompt-8.2 `DOG_FRAME` constant (a two-line `(o.o)` ASCII indicator). It is
part of the Mission Control **domain**, which this milestone was instructed not
to modify, and **no CLI surface renders it any more** — every CLI presentation
site now draws the official dog. The website prototype component
`src/relay/ui/RelayDog.tsx` is the only remaining consumer. Retiring that
constant needs a founder decision because it touches a completed domain.

---

## 5. State parity

The website's Milestone 4.5 motion system is **authoritative**. The shared
`official-relay-dog-states.ts` mirrors it exactly, and a website test asserts
the mirror still equals `projectWorkspaceDogBehavior`, `projectHomeDogBehavior`
and `DOG_PRESENTATION` field for field.

| State | Activity | Meaning | Pose | Website | CLI |
|---|---|---|---|---|---|
| `wandering` | `idle` | walks autonomously left/right, pauses, turns at boundaries, preserves position | `standing` | patrol animation | walks the track, turning at the boundaries |
| `trotting` | `thinking` | **stops walking**; existing thinking behavior | `trotting` | in-place | static track, in-place frame |
| `waiting_for_user` | `waiting_for_user` | stops walking, **jumps for attention** | `sitting` | attention animation | mark hops every other tick + `!` |
| `researching` | `researching` | existing researching behavior | `sitting` | scan marker | sweeping frames |
| `implementing` / `running` / `sprinting` | `implementing` | **tippy toes, stretched upward, front paws raised, repeatedly pawing at an implied vertical work surface** | `reaching` | reaching pose | raised mark + alternating scratch glyph |
| `reviewing` | `reviewing` | existing reviewing behavior | `sitting` | question marker | static |
| `carrying_handoff` | `handoff` | carries the handoff | `carrying` | moving | travels the track |
| `verifying` | `verifying` | verification | `standing` | question marker | static |
| `repairing` | `repairing` | repair cycle | `trotting` | alert marker | static |
| `stopped_safely` | `complete` | finished, non-error rest | `lying` | still | static |
| `complete` | `complete` | verified complete | `sitting` | check marker | static |
| — | `error` | stopped, not working | `lying` | attention | static (no mapped state today) |

**Patrol belongs to `idle` alone.** Every other activity owns the dog.

### Motion meanings

`patrol` · `still` · `attention_jump` · `work_scratch` · `scan` · `carry` ·
`halt`. A graphical surface plays each as animation; a text terminal plays the
same meaning with terminal-native frames. The meaning and the urgency are
identical.

---

## 6. Reduced motion and fallback

- **Website:** the motion controller reads `prefers-reduced-motion` and a
  caller-supplied override; under reduced motion the loop is replaced (not
  swapped for a different activity), and `reducedMotionFallback` text is shown.
- **CLI:** `--reduced-motion`, non-TTY, `--plain` and `--json` all render the
  static frame. `WAITING FOR USER` always carries `!` and its text label, so
  its urgency survives reduced motion, no color, and no Unicode.
- **No color / no Unicode:** the CLI folds the **same** 18×14 sprite to ASCII at
  the same proportions (`#`, `"`, `.`, `=` for the visor, `o` for the eyes,
  `+` for the collar). The retired side-profile ASCII dog is **not** a fallback
  and no longer exists.
- The state **label** is always present as text — no state is ever conveyed by
  color or glyph alone.

---

## 7. Future PSP colorway customization

A PSP may eventually dress the official Relay Dog in its own colorway. The
extension point is the **palette**, never the geometry:

- `OFFICIAL_RELAY_DOG_PALETTE` may be overridden per PSP;
- `OFFICIAL_RELAY_DOG_POSES` — the silhouette, ears, visor, eyes, proportions —
  **may not**;
- the import preview already surfaces `relayDogColorway` so a user can see which
  colorway a PSP brings.

**PSP dog customization is NOT implemented.** Today every PSP fixture declares
`official-cream`, and nothing consumes a per-PSP palette. The field exists so
the future feature extends the identity instead of replacing it.

---

## 8. Tests

| Repository | Suite |
|---|---|
| Website | `src/relay/ui/official-relay-dog/official-relay-dog.test.tsx` |
| CLI | `src/relay/cli/product/official-relay-dog.test.ts` |
| CLI | `src/relay/cli/product/product-hardening.test.ts` (header/footer) |

Between them they assert: checksum parity, that the sprite equals what the
website renders for every pose, the front-facing voxel features, the retired
dog's absence from every capability path, no duplicate dog in a header, uniform
scaling, transparency, sharp edges, header containment at desktop and mobile
widths, and the full state → activity → pose → motion mapping.
