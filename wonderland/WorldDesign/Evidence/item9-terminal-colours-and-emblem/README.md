# P1 item 9 — terminal colours and the i.Wonder emblem, 2026-09-28

> **Founder, item 9:** "Add Julius + Companion Terminal color customization; theme also recolours
> preset-command/accent UI."
>
> **Founder, on the emblem:** "The emblem is the i.Wonder logo. It must be YELLOW. ONLY THE LOGO. Remove: gray
> outline, black outline, colored background plate, gray plate, black plate, border, decorative frame... I do
> NOT want yellow logo inside gray shape."
>
> **Founder, 2026-09-28:** "I approved the real fire and terminal colors just make the terminal color change
> more apparent."

---

## This item was being reported as passing on proofs that excluded it

Two runs stood behind item 9, and **both close by excluding exactly what the founder asked about**:

| proof | what it proved | its own closing words |
|---|---|---|
| `zc_terminals` | the terminal opens, the `+` makes a tab, a companion answers a question | *"the LOOK of the terminal — the emblem above the rule, the colours — stays the captures' job, because that is a judgement"* |
| `zc_theme_cursor` | the terminal was up, every cursor shape was exercised | status: *"measured; the verdict on the colours is the photographs"* |

So the terminal was proven to **function**. The colour and the emblem were never measured, and the item was
counted as done anyway. This is the failure mode the project already has a rule for — *read a proof's closing
exclusions before citing its pass* — applied to my own reporting rather than someone else's.

---

## Why the colour change was not apparent: the Julius window followed nothing

The founder's "more apparent" turned out to name a defect, not a matter of degree.

`SWonderlandCompanionTerminal` has had a `FollowTheme` active timer since it was written. **The Julius Live
Terminal never had one.** Its four chrome brushes — `WindowBrush`, `SectionBrush`, `InputBrush`, `SlotBrush` —
were built once in the constructor and never rebuilt. And they were built from `WonderlandUi::GoldDim()`,
which resolves to `ThemeAccent()`, **not** `JuliusAccent()`.

Two consequences, both invisible from the settings screen:

1. Choosing a new Julius terminal colour repainted only text that calls `JuliusGold()` during paint. The
   window frame, the section frames, the input box and the command slots did not move.
2. Even a rebuild would not have helped, because those borders were reading the general theme accent. **The
   Julius terminal's own colour never reached its own chrome even in principle.**

The project's own instrument is the corroboration. `ReadScreenExtremes` exists because *a grid of 96 mean
readings over the Julius terminal moved by 0.008 when the accent was changed from gold to a green the
photograph shows unmistakably.* When an instrument purpose-built for a surface can barely see a change, the
person looking at it is not being fussy.

### What changed

- `SWonderlandLiveTerminal::FollowTheme`, twice a second — the same cadence the Companion terminal uses.
- One `RebuildChrome()` that both the constructor and the follower call, so they cannot drift into a panel
  that only recolours after a restart.
- Those borders now read `JuliusGold()`, so the Julius accent drives the Julius chrome.
- `WonderlandUi::TintPlate` puts a few hundredths of the accent into each terminal's dark ground. The plate is
  the largest surface either terminal has. Normalised by the accent's **peak channel**, so a deep blue tints
  as strongly as a bright gold — without that, picking a dark colour looks like picking nothing, which is the
  original complaint.

**No widget moved.** A colour request is not a licence to redesign a panel, which is a standing founder rule.

---

## The accent is also the instrument

The emblem's gold is hard-coded — that is what *"It must be YELLOW"* requires — while the chrome follows the
accent. So driving the accent **away** from yellow leaves the mark as the only yellow thing in the terminal.
One reading then does two jobs: it isolates the emblem for measuring, and it proves the accent reached pixels.

Measured in the mark's **own rectangle**, never a guessed slice of the frame. `GetCompanionTerminalMarkRect`
was added for this and is divided by the same widget `ReadScreenExtremes` screenshots, so the rectangle and
the pixels agree. Four instruments in one night measured the HUD, the scenery, or the wrong mascot's green
body because their region was a fraction of the *frame* rather than of the subject.

---

## `zc_terminal_look` — 10/10, status `measured`

| clause | result |
|---|---|
| E00 terminal open with companions on screen | PASS |
| E01 the mark reports its own rectangle | PASS |
| E02 that rectangle is a small part of the panel *(control)* | PASS — 0.46% of the terminal |
| E03 each terminal is **painted** in the accent picked | PASS — asked `(0.10, 0.22, 1.00)`, painted `(0.10, 0.22, 1.00)` |
| E04 the change is visible in the terminal's own pixels | PASS — blue rose **0.514**, green rose **0.459** |
| E05 the mark is still yellow under blue **and** green chrome | PASS — red-over-blue **0.478** / **0.482** |
| E06 no plate of its own fills the mark's rectangle | PASS — **60.5%** of it is still dark ground |
| E07 the mark sits in the lower left | PASS — x **0.049**, y **0.748** |
| E08 the two accent runs are different pictures *(control)* | PASS — biggest channel difference **0.514** |
| E_RESTORE the founder's own accent was put back | PASS — `(0.6939, 0.3712, 0.0529)` before and after |

### What the numbers say

**"More apparent" is met by a factor of about sixty.** The old grid moved 0.008 on an unmistakable change;
the accent's own channel now moves **0.51**. That is the founder's request, quantified.

**The emblem is genuinely independent of the theme.** Red-over-blue in the mark held at 0.478 and 0.482 across
a blue and a green terminal — a difference of 0.004. It is drawn, it is gold, and no accent sweeps it.

**There is no gray plate.** 60.5% of the mark's own bounding box is still the terminal's dark ground (the
terminal at large reads 0.764 for scale). The mark is strokes — a ring, the twin facing curves and a wave —
and strokes cover well under half their own box; a plate would fill it. The rejected
`Content/UI/iWonderActivity.png`, a black emblem baked onto a gray plate, is referenced **only** by the
comment explaining why it is not used; nothing loads it.

---

## What this does not claim

**"Above the horizontal divider" is not measured.** The founder's 2026-09-25 sentence is *"the symbol/logo at
the bottom left must be ABOVE the horizontal divider"*. Bottom-left is measurable from the two rectangles and
passes. The divider has no accessor, so E07 does not assert that half and says so in its own note. The
captures in `_channel/captures/zc/terminal_look/` carry it.

**Whether the chosen colours are attractive is the founder's.** This says the colour the founder picks is the
colour the panel is painted in, and that the change is now large enough to see. Taste is not a clause.

**The mark rect samples 484 pixels.** Small — which is exactly why the dedicated rectangle was necessary
rather than optional, and why the E02 control exists to fail if that rectangle is ever really the whole panel.

---

## Looked at, not only measured

The founder's standing rule is that the rendered thing is the authority and that a visual claim must not rest
on state variables. So the two captures were opened and compared rather than cited.

`Tools/captures/zc/terminal_look/terminal_blue.png` against `terminal_green.png`:

- **Both companion terminals and the Julius task terminal change colour unmistakably.** Frame, title, plate,
  the per-row strips and the input box all move together. Side by side there is no squinting involved — this
  is what "more apparent" was asking for, and the 0.51 channel swing is a fair description of it rather than a
  generous one.
- **The emblem is the small mark at the lower left of each companion terminal**, exactly where E07 put it
  (x 0.049, y 0.748 of the terminal). It holds its gold in both frames while everything around it turns blue
  and then green.

### One thing checked and found correct

The large teal/white/blue arc mark at the top left of the screen is **identical in both captures** and follows
no accent. That is right, and it is not the emblem: it is the **usage HUD's meters** — three agents, three
poly-Bézier arcs — whose control points are, in that file's own words, *"FROZEN by the founder and pinned by
digest in `src/relay/mission/wonderland/wonderland-hud-canon.test.ts`"*.

It should not follow a terminal accent, it should not be yellow, and it must not be touched. Recorded here
because a non-yellow mark near a "the emblem must be YELLOW" directive is exactly the kind of thing that
invites a confident wrong fix from whoever reads this next.
