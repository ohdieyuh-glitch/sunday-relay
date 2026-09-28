# Internal product experience lane — items 1–9, status at 2026-09-28 03:0x

Branch `local/wonderland-task3`. Editor and game targets both build green. The running editor's
`UnrealEditor-Wonderland.dll` is 03:00:40, corresponding to HEAD `0cfd8722`.

This lane is mascots, HUD, Brain/Wardrobe, Mission Contract UI and terminals. Items 10–13 (water, shadows,
continuous time of day, finishing the beta world) are the world lane's and are not covered here.

---

## The matrix

| # | item | proof | result | measured on |
|---|---|---|---|---|
| 1 | Project Brain / Wardrobe | `zzRG7_wardrobe_pixels` | **12/12** | HEAD binary |
| 1 | …framing stability | `zzRG1_wardrobe` | **3/3** | 02:07 binary |
| 2 | Brain + Python snake | `zzRG2_snake` | **5/5** | 02:07 binary |
| 3 | Relay OG animation authority | `zzCG1_pose_states` | **4/4** | 01:05 binary |
| 4 | Real fire, **shipped** | `zc_fire_shipped` | **6/6** | 01:54 binary |
| 5 | Project Avatar lag | `zzBX1_avatar_shipped` | **5/5** | 00:23 binary |
| 6 | Mascot colours | `zzRG3_colours` | **9/9** | 02:07 binary |
| 7 | HUD agent rows | `zzRG6_hudfull` | **19/20** | 02:47 binary |
| 8 | Cursor customization | `zzRG8_cursor` | **4/4** | HEAD binary |
| 9 | Terminal colours + i.Wonder emblem | `zc_terminal_look` | **10/10** | 01:44 binary |

**Not every row was measured on HEAD, and that is stated rather than implied.** Items 3, 4, 5 and 9 were
measured earlier tonight on the binaries named. The code each of them exercises was not touched afterwards —
the later commits are the mission-contract lookup, the H_POINTER diagnosis and documentation. Items 1, 6, 7
and 8 were re-run after the terminal chrome change and the fire ship precisely because those changes could
reach them.

---

## The one red, and why it stays

**`H_POINTER` — a synthetic pointer click does not complete on a nav tile.** Red by design, and now with a
proven cause rather than a shrug.

`SButton::OnMouseButtonUp` (UE 5.8, `SButton.cpp:424`) runs the click only if `IsHovered()`, and the
`IsUnderLocation` fallback beside it is guarded by `MouseEvent.IsTouchEvent()` — so for a mouse event, hover
is the only test. Hover is not carried on the event: `FSlateUser` recomputes it from the real pointer's
position, so a click routed down a widget path leaves the button un-hovered however correct the path is.
`ExecuteOnClick` is skipped while the up still returns **handled**, which is what made `up 1` read as success.

Everything the diagnostics reported — under the point, down handled, up handled, captor is the target's own
`SButton`, click point inside its geometry, `bIsPressed` **YES** between the two events — is what a *working*
button looks like. That was the signal and it took five sessions to read it.

Both ways out were tried and are recorded in the code so nobody spends the builds again: a routed
`RoutePointerMoveEvent` (which this function has **always** done — I added a duplicate, measured no change,
and corrected the commit that claimed it as a fix), and `SWidget::SetHover`, which is **protected** and does
not compile from a caller.

**The HUD is not implicated.** The same button's `SimulateClick` runs its handler and opens the real surface
every time — that is how this proof's panel clauses pass — and a hand's click takes the ordinary path with
hover set. Every founder-facing content clause of item 7 is green.

---

## Two items I had been reporting wrongly, found by auditing my own claims

**Item 4 was "implemented", not shipped.** The material existed, was measured, and sat behind
`wl.Look.FireMaterial` defaulting to **0**. A founder booting the game saw the plume it was meant to replace.
The proof that convinced me set the knob to 1 *itself*, so it could only ever pass. It now defaults to 1 and
`zc_fire_shipped` reads the knob **before** writing anything, with a control that forces it off and requires
the fire material to disappear.

**Item 9's look was never measured.** Both proofs behind it close by excluding exactly what the founder asked
about — `zc_terminals`: *"the LOOK of the terminal … stays the captures' job"*; `zc_theme_cursor`: *"the
verdict on the colours is the photographs"*. The terminal was proven to **function** and I reported the item
as done.

A third, smaller one: **item 1's regression was thinner than the item.** `zzRG1_wardrobe` is three clauses
about framing stability, not the twelve about the wardrobe opening, the preview's pixels and clicking a skin
changing what is shown. Since the fire ship changes what two skins render *in that preview*, re-running the
full `zc_wardrobe_pixels` was necessary rather than tidy. It came back 12/12.

---

## What changed in the product tonight

- **`wl.Look.FireMaterial` defaults to 1.** Founder-approved. Shipped unretuned, with the prominence tension
  recorded rather than tuned away: shaping a flame is what takes prominence out of it, and the gain is
  `wl.Look.FlameDim` if the founder wants it brighter.
- **The Julius Live Terminal now follows its own accent.** It had no `FollowTheme` at all, and its four chrome
  brushes were built once in the constructor from `GoldDim()` — the *general theme* accent, not
  `JuliusAccent()`. Its own colour never reached its own chrome even in principle.
- **Both terminal plates carry a trace of the accent**, normalised by the accent's peak channel. The accent
  channel now moves **0.51** where the project's own grid once moved 0.008. No widget moved.
- **`FindFollowedJuliusTask` follows the mission that was adopted**, not the first in the array — the
  acceptance-#5 A06i defect, where a created mission worked in every data clause while every visible surface
  named the mission it replaced. A put-away followed contract now reads as *no mission* rather than naming
  another one.
- **Cub ghost eye halos** stopped bridging the visor centreline (directive A's third site).

---

## Beta blockers from this lane

**None.** Every founder-facing clause of items 1–9 is green. The single red is an engine precondition a
synthetic pointer cannot satisfy, affecting the test harness and not the product.

Gates B (Julius beta-ready), C (Wonderland + Julius end-to-end) and D (world beta-complete) are other lanes'
and are not claimed here. Acceptance #5's rerun passed all clauses on `9fc15a32`, including A06i and A06o,
after the mission-contract fix above.
