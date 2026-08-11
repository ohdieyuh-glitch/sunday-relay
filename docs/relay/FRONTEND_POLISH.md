# Relay frontend — premium polish pass

Status: implemented on `relay/frontend-premium-polish`.
Tests: `src/relay/ui/premium-polish.test.tsx` (15 assertions, 15 mutations proven).

This was a **polish pass, not a redesign**. Every layout concept, every surface
structure, the Relay Dog, the Relay Stage, the Project Brain, the Mission
surfaces and all three selectable colorways are the ones that were already
there. What changed is material, light, sharpness, typography, micro-interaction
and measured legibility — applied through the token sheet Relay already had.
Each surface still owns its own palette, as it always did; what is now shared,
and enforced as shared, is the material and motion vocabulary.

---

## 1. The one thing to read first: contrast

The pass began by measuring the existing palettes rather than by choosing
colours. Three colorways were carrying **text below the WCAG AA floor**:

| Colorway / surface | Tier | Was | Measured | Now | Measured |
|---|---|---|---|---|---|
| obsidian (`.reh`, `.rpw`, `.rps`, chrome, Mission Control) | tertiary | `#5d584e` | **2.83:1** on the field, **2.67:1** on `panel-2` | `#837c6e` | 4.84 / 4.56 |
| obsidian | secondary | `#8b8578` | 5.46 | `#a09a8c` | 7.15 |
| midnight | tertiary | `#737898` | **3.08:1** on `panel-2` | `#8e95bc` | 4.53 |
| midnight | secondary | `#a0a4bd` | 5.39 | `#b0b6d4` | 6.62 |
| RELAY MANUAL, **ivory surfaces only** | tertiary | `--relay-manual-cream-text-muted` | **2.06:1** on cream | `--relay-manual-graphite` | 5.44 |
| RELAY MANUAL, ivory surfaces only | secondary | `--relay-manual-graphite` | 5.44 | `--relay-manual-graphite-deep` (new) | 7.82 |
| root `--text-faint` | tertiary | `#7a7360` | 3.93 on `--surface-solid` | `#847d68` | 4.52 |

Notes on the judgement calls:

- **The tertiary tier is normal text, not large text.** It carries 8–11px
  metadata — timestamps, operating keys, the phase rail, verification notes,
  brief hints. So the floor applied is 4.5:1, not 3:1.
- **Both tiers had to move together.** Lifting the tertiary tier alone put it
  within 3 L\* of the secondary and destroyed the hierarchy, trading an
  accessibility failure for a legibility one. `premium-polish.test.tsx` now
  enforces both: AA on every ground, *and* each step at least 1.2× the ratio of
  the step below.
- **The hues did not change.** Only the values were lifted, so the warm-gray
  obsidian ladder and the slate-indigo midnight ladder are the same colours.
- **RELAY MANUAL's black system areas were already fine** (7.79:1) and are
  untouched. Only the ivory technical-manual areas moved, and they moved
  *downward* in lightness rather than up, because on a cream ground there is no
  room for a tier lighter than graphite that still clears AA. That is a visible
  change to a founder-provided reference and is called out here deliberately:
  the alternative was leaving 9px text at 2.06:1.
- **Borders were left alone** and are explicitly out of the test's scope. A
  panel divider is not a UI-component boundary a reader has to find; the
  controls that do need 3:1 (inputs) already carried a graphite border in every
  colorway.

## 2. Token foundation — `src/relay/relay-tokens.css`

Extended, not duplicated. The sheet already carried `--hairline`,
`--edge-light` and `--elev-1`; that is the material vocabulary, so the new
tokens continue it:

| Group | Tokens |
|---|---|
| depth | `--edge-light-strong`, `--elev-2`, `--elev-3` |
| material | `--sheen` |
| glass | `--glass-blur`, `--glass-blur-strong`, `--glass-saturate` |
| motion | `--ease-emphasis`, `--dur-fast`, `--dur-base` |

Three properties of this group are held by tests:

1. **No dead token.** Every custom property in `:root` must be consumed by a
   Relay stylesheet. The header of that file used to claim "exactly the 21
   tokens Relay consumes"; a count in prose goes stale the first time anyone
   adds a line, so the claim is now enforced instead of asserted.
2. **No fork.** No surface stylesheet may redeclare a shared material or motion
   token. A surface still owns its own palette (`--rpw-*`, `--reh-*`) — that is
   the established shape — but two sheets may not disagree about `--elev-2`.
3. **One shape per elevation.** Each `--elev-*` is an inset edge light plus at
   least one cast shadow, so the three read as one system rather than as three
   drop shadows.

**Why `--sheen` is a background layer and not a box-shadow.** `clip-path` clips
the element's painted output, and an outer box-shadow is part of that output —
so a chamfered panel (`.rpw-console`, `.reh-starter`, `.reh-guide-chat`,
`.reh-brief`) cannot carry an outer shadow at all. Light that lives *inside* the
clip can. It is stacked in the same `background` shorthand as the panel colour,
never as a later separate rule, because a colorway override written as a
shorthand would silently reset `background-image` to `none`. Two such overrides
(`[data-relay-colorway='midnight'] .rpw-tmpanel` and the manual equivalent) were
updated to re-state it.

## 3. Per surface

### Entry / home (`ui/entry-home/relay-entry-home.css`)

- **Lighting:** the fixed technical grid now also carries a warm wash above the
  fold and a floor shadow below it, so the field is a lit space rather than a
  flat tile. One fixed element; composites once, never repaints on scroll.
- **Sharpness:** a `min-resolution: 2dppx` pass halves the grid and scanline
  gradient stops. A 1px stop is two device pixels on a retina display, so the
  grain and grid were coarsest exactly where they should be finest.
- **Glass:** the header was already `rgba(7,8,11,0.9)` over the grid; it now
  blurs what is behind it and drops to 0.72, inside `@supports`.
- **Material:** `--sheen` on the starter, guide chat, brief draft, route rows,
  recent rows and the right-hand column; `--elev-1` on the square panels (the
  chamfered ones cannot take it, see above).
- **Typography:** display heading gets optical tracking (`-0.022em`), tighter
  leading and `text-wrap: balance`; support copy gets `text-wrap: pretty`;
  `tabular-nums` on the status readout, message timestamps and recent-project
  metadata.
- **Micro-interaction:** every control answers the pointer in `--dur-fast` and
  answers a press by deepening the plate. Route rows lift by **light**
  (`--elev-1` → `--elev-2` on the longer `--dur-base` band), never by position:
  a list that jumps under the pointer is harder to aim at.

### Project workspace (`ui/project-workspace/relay-project-workspace.css`)

- Same grid lighting, same retina pass, same control language as the entry home
  — deliberately identical tokens so the two surfaces read as one product.
- **The console is the most-glass surface in Relay**, because it is the one
  dominant plate and it was already translucent over the grid: it now blurs to
  frosted at 0.58 with the sheen over it. The conversation dock, which shares
  its frame, matches.
- Header and workforce strip: glass. The strip's `@supports` block sits *after*
  the rule it refines — an `@supports` block adds no specificity, so a glass
  background declared above `.rpw-strip` would have been overridden by the flat
  one below it and only the blur would have survived.
- Status rail, coding-agent terminal, terminal role panels: sheen + `--elev-1`.
- **Drawers and scrims:** the Live Terminal, the harness catalog sheet, the
  bridge pairing sheet and the usage drawer take `--elev-3`; their scrims now
  *defocus* rather than only darken, which also let them become lighter — less
  of the page is thrown away to show a drawer. The focused-panel backdrop went
  from 0.92 flat to 0.70 + blur; the focused panel itself is opaque and fills
  the viewport, so nothing behind it becomes readable or clickable either way.
- **The framed terminal window** (`.rpw-tm-window`) gets `--elev-2` and the
  sheen — it is drawn as a window, so it should sit above the surface like one —
  and its three traffic lights get a specular highlight and a seat shadow so a
  12px disc reads as a lens instead of a flat dot. Static; nothing to stop.
- The role-selector popover's one-off `0 22px 48px` shadow became `--elev-3`.
- `tabular-nums` on every timestamp column and on the mission-economics figures,
  where decimal points that do not line up make a number look like an estimate.
- Themed thin scrollbars from the surface root: `scrollbar-color` inherits, so
  one declaration reaches the console feed, the terminal, the captured output
  and the sheets. The thumb measures 4.84:1 — a scrollbar is a UI component and
  needs 3:1.

### Project Brain (`RelayProjectBrainOrb.tsx` + `.rpb-*`)

One addition: a **specular pass**, one soft highlight per lobe from the same
direction the existing surface gradient already implies. Without it the masses
were flat discs with a vertical fade. It is white light at very low opacity,
never the accent — a progression tier must not be able to change where the light
comes from. Its gradient id is per-instance, like the other three.

Nothing else about the Brain changed: same silhouette, same pathways and nodes,
same slow rotation, same `--rpb-accent` contract shared with the Dog, same
reduced-motion gate.

### Live Terminal

Covered above (window frame, role panels, drawer elevation, scrim, tabular
timestamps, scrollbars). The coding-agent terminal's toggle gained the shared
hover language and its **own** reduced-motion rule, named rather than relying on
the `.rpw *` blanket, because that terminal is also rendered on its own outside
the workspace root.

### Relay Stage (`ui/relay-stage/`)

The stage is **frameless by contract** and stays that way — no border, no
background, no radius, no fixed height on `.rst`, and the test re-asserts it.

One addition, on the *backdrop* element: a shared lens vignette. Both scenes are
drawn edge to edge in flat gradients, so the frame corners were as bright as the
subject. The vignette darkens corners only, changes no scene structure and no
layout, and — because it lives in `.rst-layer--backdrop` at z-index 0 while
actors are at z-index 3 — it is *structurally* incapable of darkening the Relay
Dog. The test asserts that ordering rather than trusting the comment.

The backdrop picker took the shared sheen and `--elev-1`.

### Mission Control (`relay.css`, `ui/mission-control.css`)

- Cards, the sticky ledger, the primary plate, the consent panel and the
  disclosure sections take the shared sheen and elevation, so this surface reads
  as the same product as the workspace instead of a flatter cousin.
- Its Live Terminal scrim gets the same blur treatment as the workspace one, and
  the drawer gets `--elev-3`.
- Buttons gained hover and press states; the event filters and the terminal
  button gained transitions **and** a reduced-motion block. `relay.css` already
  declared a `.relay-btn` transition with nothing switching it off; it now has
  one.
- The stylesheet header claimed its tokens came from `src/styles/global.css`, an
  Alcatraz path. Relay separated repositories and owns `relay-tokens.css`; that
  sentence had outlived the file it named and was rewritten.

### Secondary surfaces (consistency pass)

Project Settings (grid lighting, plate material, button language, scrollbars),
mobile chrome menu items, notification toasts (`--elev-2`; background kept
**opaque** on purpose — a translucent toast takes its contrast from whatever
happens to be under it, and that stack carries warnings), usage drawer, loop
panels, MCP connections, PSP import, mission recovery, the demo-mission summary,
and the dev preview shell (whose floating DEV panel and handle became glass, so
the tool hides less of the surface under review).

## 4. What is held by a test

`src/relay/ui/premium-polish.test.tsx`:

1. Every text tier on every ground in every colorway clears 4.5:1 (74 measured
   pairs), and the three-step ladder stays a ladder.
2. The manual colorway's ivory blocks actually *assign* the tokens the contrast
   table measures — measuring a token no surface uses proves nothing.
3. Every themed scrollbar thumb clears 3:1, and the declarations exist.
4. The material/motion vocabulary exists, has the right shape, has no dead
   token, and is not forked by any surface sheet.
5. No stylesheet contains a `url(` — every mark, scene and texture is drawn from
   primitives.
6. Every `backdrop-filter` is inside an `@supports` test for it.
7. No blur, filter, radius or shadow reaches `.rpd-art`, `.rpd-part`,
   `.rpd-markwrap` or `.rst-actor`, and the sprite keeps
   `image-rendering: pixelated`.
8. The stage stays frameless and the vignette cannot reach an actor.
9. Every transition is named or blanketed in a reduced-motion block **in its own
   stylesheet**.
10. No `:active` rule anywhere declares a `transform` — press feedback that
    moves the control is motion under a finger and cannot survive reduced
    motion.
11. The Dog renders 18×14 at one uniform scale at every unit the surfaces pass,
    with square pixels and `crispEdges`, and the anatomy rows are unchanged:
    three leg rows out of fourteen is what "short block-shaped legs" means
    numerically.

Each of those was mutated and watched to fail; the mutations are listed in the
work report for this branch.

## 5. Deliberately NOT changed

- **Layout.** No grid, column count, breakpoint, order or spacing scale moved.
  Nothing was re-laid-out.
- **The Relay Dog's artwork, poses, palette, states and motion system.** Only
  the *caption's* secondary colour moved, with the global tier lift. Adding a
  second dog, a per-state mascot or a tier that repaints the body was never on
  the table.
- **The Relay Stage's frame.** It is frameless by contract; the vignette is on
  the backdrop, not on the stage.
- **The three colorways' identities.** No new palette, no fourth colorway, no
  hue changes. `--relay-manual-graphite-deep` is one derived neutral inside the
  existing family, not a new colour direction.
- **Ligatures and `text-rendering`.** Fira Code's coding ligatures are on by
  default, and `optimizeLegibility` would have changed which glyphs render in
  labels. Nothing about the polish justified changing the letters themselves.
- **Status colours** (`--*-green`, `--*-amber`, `--*-red`, gold). They carry
  meaning that tests pin, and every status already carries a word or a glyph
  beside the colour.
- **Timeline row hover.** A background wash on `.rpw-tev` / `.rcat-line` would
  help scanning, but those rows contain no control, and a hover highlight on a
  non-interactive row promises a click that does not exist.
- **`filter: drop-shadow` on the animated sprite.** It looks identical to the
  layer behind it and re-rasterizes the whole sprite every frame of the
  breathing and the gait. The existing note in `pixel-dog.css` was right.
- **Animation gating.** Already held by `workspace-motion-quality.test.tsx` and
  the per-module suites; this pass added no keyframes.
- **The stylesheet collision allow-list.** No entry was added or reworded. The
  polish deliberately avoided declaring anything new on the six pre-existing
  cross-sheet class collisions (`relay-btn`, `relay-dim`, `relay-tagline`,
  `relay-wordmark`, `primary.relay-btn`, `ghost.relay-btn`) from the *second*
  sheet, so every recorded reason is still true of the code.

## 6. What was not verified

**No browser rendered any of this.** There is none in this environment, so every
claim above is either a measured number computed from the stylesheet values, a
structural property of the CSS, or a rendered-DOM assertion in jsdom. Nobody has
looked at a frosted console, a lifted route row or a vignetted stage. The
following in particular are unverified by observation and should be checked on a
real display before release:

- how heavy `backdrop-filter` feels on the workspace at the sizes the console
  and the scrims actually cover, on a low-end machine;
- whether the 0.58 console glass reads as intended over the grid, and whether the
  scrims at 0.46–0.70 still hide enough;
- whether the retina gradient-stop halving lands on one device pixel in each
  browser's rounding, rather than on a half-lit pair;
- whether the lifted muted tiers read as "crisper" or as "lighter" in the
  founder's judgement — the numbers are right, the taste is theirs;
- the RELAY MANUAL ivory change against the founder's reference photograph.
