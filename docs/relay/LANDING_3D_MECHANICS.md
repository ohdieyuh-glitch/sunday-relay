# Relay Landing — reference mechanic inventory and mapping

Two supplied `design.md` references were studied. Neither brand identity is
adopted. What is adopted is the MECHANICS: how each site handles depth,
transparency, motion, density and restraint.

Reference A = Active Theory ("cosmic void with a single luminous portal").
Reference B = Max Yinger ("midnight engineer's terminal with floating chrome
artifacts").

Relay is neither. Relay is Aquala Technologies' Compound AI Agent platform, and
the landing must read as a new computing category — not as an agency portfolio
and not as a personal site.

---

## REFERENCE A — Active Theory

| # | Mechanic observed | Evidence in design.md | Relay implementation |
|---|---|---|---|
| A1 | **The rendered scene IS the design; chrome recedes** | "Why So Minimal": UI exists only to navigate and consent | The landing is one persistent WebGL canvas. All DOM chrome is ghost-weight and sits over it. No section owns a background. |
| A2 | **Absolute void canvas, single accent** | `#000000` only canvas; one violet accent rationed | Relay canvas is near-black `#05060a`. Exactly two accents: Aquala baby-blue and Relay gold. Nothing else is chromatic. |
| A3 | **Centerpiece emblem as the brand** | "Iconic Brand Emblem … it IS the hero" — circular wireframe portal, rim glow, particle field | The **Aquala mark** is the centerpiece: extruded 3D circle + two C-arcs + wave, translucent, rim-lit, internally glowing. Replaces A's portal entirely. |
| A4 | **Particle/light field emanating from the emblem** | "particle fields of green, gold, cyan specks burst downward" | Replaced by the **Aquala signal tracer** — a directed spline, not a burst. Signal must read as computation, not decoration. |
| A5 | **Elevation by translucency stacking, never shadow** | "the void cannot cast them"; `backdrop-filter: blur(4px)` | Glass system: `backdrop-filter`, hairline borders, zero `box-shadow` anywhere on the landing. Depth is occlusion + parallax. |
| A6 | **Hairline borders define edges** | 1px `#4d4d4d`, no fill | Landing panels use 1px `--rl3-hairline` at low alpha. No filled cards. |
| A7 | **Opacity is the primary transition property** | "UI elements fade in/out rather than sliding" | DOM chrome enters by opacity + tiny z-translate only. All *spatial* motion happens in WebGL, where it belongs. |
| A8 | **Gravitational, unhurried timing; `ease`, not trendy cubic-beziers** | ease dominant (61 uses); micro 0.2–0.4s, scene 0.8–9s | Two motion tiers: chrome 240–400ms `ease`; scene/camera 900ms–8s critically-damped springs. No bouncy overshoot. |
| A9 | **Type split: geometric sans chrome vs editorial serif prose** | nbarchitekt vs Times, deliberate counterpoint | Relay keeps its own split: technical mono (Fira Code, already in the stack) for telemetry/system labels; editorial serif for cinematic headlines. |
| A10 | **Full-bleed, no max-width, near-zero content density** | "single viewport of rendered 3D space, not a scrolling document" | Landing is full-bleed. Copy is headline + one supporting line per scene. Nothing paragraph-shaped. |
| A11 | **Pill controls at 500px radius, ghost buttons at 5px** | never an intermediate radius | Landing CTAs are full pills; secondary controls are 6px ghost rectangles. No intermediate radii. |

## REFERENCE B — Max Yinger

| # | Mechanic observed | Evidence in design.md | Relay implementation |
|---|---|---|---|
| B1 | **Corner-anchored z-pattern, content pushed to viewport edges** | "top-left wordmark, bottom-left time, bottom-right socials, center 3D" | The landing's per-scene chrome is corner-anchored: brand top-left, scene telemetry bottom-left, scene index bottom-right, 3D dead centre. |
| B2 | **Single hero artifact floating in negative space, no container** | "no container, no border, no shadow — the geometry is the component" | Both the Aquala mark and the Relay Dog float uncontained. No frame, ever. |
| B3 | **Live telemetry as identity** | LOCAL TIME readout, `1440 x 900`, `~1210 FPS` | Relay ships a **live system readout**: real viewport, real measured FPS, real DPR, real active scene. Truthful — it reports what is actually measured, per repo rule. |
| B4 | **Brutal compactness; 4px gaps, 12px labels, 80px display** | base unit 4px, density compact | Landing chrome uses a 4px rhythm, 11–12px mono labels, and one oversized display per scene. |
| B5 | **Single warm off-white does all the work** | `#e4dfda` at every size, weight 400 only | Relay's cream `#f4efe3` carries all text. Gold is for the Dog's eyes and accents, never body copy. |
| B6 | **Accent exists only as 3D lighting bleed, never on chrome** | Rose Quartz "never used on UI chrome" | **Baby-blue is Aquala's light**, and gold is the Dog's — both live in the render. Chrome stays achromatic. This is the single strongest borrowed rule. |
| B7 | **Flat by design — depth comes only from the artifact** | no shadows, no blur, elevation zero | Reinforces A5 from the other direction: the landing never fakes depth in CSS. |
| B8 | **Compressed vertical metrics as signature** | line-height 0.70 on display type | Landing display headlines run at 0.82–0.88 leading — compressed, but readable at Relay's serif. |
| B9 | **No visual dividers; spacing alone separates** | "sections flow with 64px padding, no dividers" | No `<hr>`, no section borders. Scene changes are announced by camera and light, not by rules. |

---

## Where the two references disagree, and what Relay does

- **A wants pure `#000000`; B forbids pure black** (warm carbon `#12130f`).
  Relay takes B's side: `#05060a`, a cool near-black that is *not* absolute, so
  translucent glass has something to be translucent against.
- **A is centred; B is corner-anchored.** Relay uses both by role: the 3D
  subject is centred (A), the chrome is corner-anchored (B).
- **A uses one violet accent; B uses one pink bleed.** Relay uses two accents
  with strictly separated ownership — baby-blue belongs to Aquala, gold belongs
  to Relay/the Dog — and neither is ever allowed onto UI chrome.

## Explicitly NOT adopted

- Active Theory's violet `#343755`, its Times body copy, its cookie-banner
  pattern, and its particle burst.
- Yinger's `#e4dfda`/`#12130f` pair, its clock readout, its social pill stack,
  and its Inline VF masthead.
- Either site's typography identity. Relay keeps its own editorial/mono split.
