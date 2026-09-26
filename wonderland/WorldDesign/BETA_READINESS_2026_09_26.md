# WONDERLAND — BETA READINESS, 2026-09-26

Branch `local/wonderland-task3` · HEAD `4753573b` · 5 commits added this run (from `650e5954`)
Editor target **Succeeded** · Game target **Succeeded** (both rebuilt at HEAD, editor closed for the link)

---

## 1. WHAT THE FOUNDER SAID WAS NOT COMPLETE, AND WHERE IT STANDS NOW

The founder named four things as **not complete** and asked for those first.

### WARDROBE — was showing the Project Brain scene. Fixed, and verified by pixels.

**The cause.** The wardrobe had two doors into one feature.
`UWonderlandUiSubsystem::SetBrainSkinsOpen` stood the brain sculpture down and framed the Dog into the
window. The panel's own **SWITCH SKIN button** called `SetSkinsOpen` on the *widget* and did neither. Every
proof ever written went through the subsystem. The founder goes through the button. The preview window is a
**hole** in the panel, so with the brain still staged, what showed through it was the brain chamber — white
walls, black snow. Exactly the photograph.

There was a second half: closing the Project Brain while the wardrobe stood open left `bSkinsOpen` true on the
widget, so the *next* open drew the wardrobe over a freshly staged sculpture, with no click on SWITCH SKIN
involved at all.

**Both fixed**, and staging now hangs off the panel's own state change, so it runs on every route in and out.

`zc_wardrobe_pixels` and `zc_wardrobe_upgrade` drive the **button**, not the subsystem, and judge by reading
the screen. 19 of 19 clauses pass, including:

| clause | measured |
|---|---|
| every corner of the preview is the black backdrop, not the chamber | brightest corner 0.004–0.28 luma (the chamber reads 0.97) |
| the mascot fills 80–90% of the square, every skin | 0.87 / 0.92 / 0.89 / 0.89 / 0.87 on the binding axis |
| nothing runs past the frame | no skin over 1.0 on either axis |
| centred | within 0.08 of a window width, every skin |
| static until 360° is pressed | not rotating before; yaws sweep 106→196→286→17 after |
| eases home when stopped | 0.0° |
| primary colour live on the preview | crimson pushes red above blue in the square |
| the skin's own fire survives the recolour | bright fraction 0.202 → 0.197 |
| colours survive close and reopen | yes |

### SUB-AGENT CUB / COMPANION GROUNDING — fixed, and walked.

**The cause.** Every Sub-Agent Cub carries a body of the **same class** as an AI Companion, and the
companions' keep-apart steering iterated every embodiment in the world. Each new cub counted as a peer to be
pushed away from — up to **345 uu of shove per cub** — and cubs spawn *above* the Dog's feet, so the push had
a downward component and drove a companion whose entire hover is 34 uu through the ground.

Peers are now told apart by `IsIndependentCompanion`, the push is planar, and a floor trace holds every
companion above the ground whatever else decides.

`zc_cub_grounding` walks the founder's exact sequence — 0 cubs → summon → move → stop → turn → uneven ground →
idle → dismiss → resummon — measuring each companion's **feet** against the ground traced beneath them:

- worst clearance across the whole run: **+36.05 uu** (never negative)
- clearance change on summoning five cubs: **0.00 uu**
- companions and cubs remain separate actors: 5 cub bodies, 2 companions, neither owning the other

### FULL NIGHT READABILITY — night now has a moon.

**The cause.** The only directional light after dark was the **sun**, held at 0.4% of noon while standing up to
72° *below* the horizon — so the one light in Wonderland was shining upward through the ground. Raising it was
never the answer.

Wonderland now has a moon: a second directional light opposite the sun, high when the sun is low, two shadow
cascades, faded in on the same curve the sun fades out on. The sky light's gain rises at night, the fills keep
a cool floor, exposure opens a quarter stop, and the Relay Dog carries a small cool lamp that only exists
after dark — because measured at 04:00 the mascot read *darker* than the paving it stood on, and the mascot is
the first thing the founder listed.

`zc_night_readable` photographs 21 hours of one cycle and reads world-only pixels:

| clause | measured |
|---|---|
| night is still night | 0.132 against 0.443 at the brightest hour — **0.30 of day** |
| the world is not crushed to black | 77% below 0.14 at 04:00, with the ground at 0.163 and the skyline at 0.062 |
| the mascot is visible | yes (with the night lamp) |
| no jarring exposure step | worst step 1.79× across 21 samples including dusk and dawn at half-hours |

**Two instrument faults found and recorded**, because both produced confident wrong numbers: the first camera
was *inside a building* and reported midnight as 0.031 ("the world is gone"), and the first read included the
HUD, which is lit by Slate and does not care what hour it is.

### MENU CUSTOMIZATION — a **Colors** tab, and the colours reach the screen.

- The Menu has tabs; the second is titled **Colors**, as asked.
- Mascot PRIMARY / SECONDARY, AI Companion PRIMARY / SECONDARY, **Julius terminal** and **AI Companion
  terminals** separately, and a **Menu theme** — seven rows plus one reset.
- The Wardrobe carries the same PRIMARY/SECONDARY swatches under its preview. Both write
  `UWonderlandMascotStyleSettings` through **one** apply path, which the console commands now also use, so
  there is no third writer.

**A real gap was found and closed here.** A Slate panel builds its brushes *once*, in its constructor. Choosing
a colour changed the value every one of them reads and **nothing on screen at all** — the Julius terminal moved
by −0.001 in green after being set to a green nobody could mistake. The subsystem now rebuilds the chrome on
every colour change. Measured after: green-over-red **0.341 → 0.518** in the Julius terminal; blue-over-red
**0.153 → 0.373** in the Menu's heading region; and the Menu's body region drifts **0.005**, so the accents
moved and the words did not.

---

## 2. THE OTHER CORRECTIONS

**Skeleton Flame — the glow language is complete.** The colour is the eyes' own, written once and read
everywhere. The chest skull's bone is a dim soul-veil and its sockets, nasal notch and teeth are the bright
soul light; the sockets are repeated a step proud so they read as eyes at a distance; the seam between every
vertebra and the dark band under each pauldron carry the same light. All are *unlit*, so between beats they are
as black as the void they replaced.

The runtime learns which materials beat from the **figure file** — a material whose name contains `pulse`
beats deeply, and every other glow on the same body rides the *same* clock at a third of the depth, so the
eyes and the ghostfire pulse with the skull and the flame never looks like it is going out. No other skin moves.

`zc_skeleton_pulse` photographs front, both sides, back, standing and walking, and measures **cyan excess**
rather than brightness (a bone dog is bright whatever its skull is doing — the first run read 1.00 at every
angle for exactly that reason):

- chest swing, brightest minus dimmest: **0.024 / 0.031 / 0.066 / 0.196** at front / right / back / left
- head swing: 0.021 / 0.092 / 0.032 / 0.177
- one period explains all four sides; measured beat 4.7 s of wall clock
- the pulse survives the Dog walking: 0.026

> **Stated plainly:** phase *equality* across the four sides was **not** established by measurement. The four
> passes are minutes apart on a clock that advances at the body's activity rate, and the phase fit over one and
> a half cycles scattered. Synchrony is structural instead — `DeepBeat` and `ShallowBeat` are two expressions
> of one `Swell`, computed once per body per frame — and that is the strength of the claim, not more.

**The Project Brain yellow layer is gone.** It was `StatusBrush`: a pale-yellow (255,244,214) rounded plate
with a gold border behind the SAMPLE DATA line, and the only yellow surface on the page. The plate is removed;
the sentence stays, in the page's own ink. Visible in the captures.

**Preserved, as instructed.** Flame quality in the world (only the wardrobe *mannequin* burns lower, and it is
a different actor from the Dog); companion lighting; Project Avatar lighting decisions; Relay OG animation
authority; planted idle; navigation; water; the day cycle; HUD agent labels; cursor infrastructure; the
avatar additive-material correction; Julius Connect online/offline.

---

## 3. TERRITORY DISCOVERY + CHECKPOINTS

**Nothing was invented.** `Tools/territory_registry.py` reads `WorldDesign/CANON/nations.json` and
`NATIONS.md` and copies their words into `Config/DefaultGame.ini`. Every row carries the `CanonSource` it came
from. The audit found all three nations already defined and locked 2026-09-17:

| territory | specialisation | source |
|---|---|---|
| GOLDEN ARRIVAL | *neutral ground* — the canon gives it a role, explicitly not a discipline | `nations.json neutral.role` |
| ICARUS | Video game development | `NATIONS.md:7`, `nations.json:32` |
| NOCTIS | Content creation | `NATIONS.md:8`, `nations.json:105` |
| TARTARUS | Software and application creation | `NATIONS.md:9`, `nations.json:179` |
| **DUBEL FOREST** | **NEEDS FOUNDER DEFINITION** | canon gives an existence and an exception rule and states no discipline |

Five checkpoints stand in the world: a stone plinth, an ivory pylon and a ring of the territory's canon colour,
**six metres tall, on the ground** — instanced cubes on the engine cube, three draw calls a marker, no new
asset. The ring, core and ground medallion are **unlit**, which is the whole answer to "readable at every
hour". Undiscovered, they burn at an eighth.

Walking into one finds it, once, and a banner says: **territory name / specialisation / CHECKPOINT
DISCOVERED** — seven seconds, never hit-testable, never full-screen.

It lives **in the world map**, not beside it. The map grew a TERRITORIES strip; the chip you are standing in
says HERE, the rest say how far, and selecting one fills the same detail column a destination uses with name,
specialisation, discovered state, purpose, important locations, available activities and one line saying which
way it lies and how far.

`zc_territories` — **15 of 15 clauses pass**, including a clause that re-reads `nations.json` in the proof and
fails if any specialisation in the game differs from the canon's word, or if the canon's silence has been
quietly filled in.

---

## 4. PROOF MATRIX FOR THIS RUN

| proof | clauses | result |
|---|---|---|
| `zc_wardrobe_pixels` | 12 | all pass |
| `zc_wardrobe_upgrade` | 19 | all pass |
| `zc_skeleton_pulse` | 6 | all pass |
| `zc_night_readable` | 8 | all pass |
| `zc_cub_grounding` | 5 | all pass |
| `zc_menu_colours` | 6 | all pass |
| `zc_territories` | 15 | all pass |
| `zc_beta_perf` | 3 | all pass |
| **total** | **74** | **74 pass, 0 fail** |

**Instruments built for this run**, because the existing ones could not see what the founder sees:
`ReadScreenRect` (mean colour and dark/bright fractions of any screen rectangle) and `ReadScreenExtremes`
(one screenshot, every pixel, per-channel extremes — an accent is a hairline and a mean cannot find it).

**Vacuous passes caught and fixed, not shipped:**
- `zc_beta_perf` first reported **0.00 ms at every stand and passed**. `FStatUnitData` only advances while the
  `stat unit` overlay draws. The overlay is now issued at every stand and `F00` asserts the clock was running.
- `zc_night_readable` first measured a camera inside a building and the HUD as if it were the world.
- `zc_skeleton_pulse` first measured luma on a bone dog and read 1.00 at every angle.
- `zc_wardrobe_upgrade` first measured a strip sampler that cut Relay OG's legs and called a figure filling
  87% of the window 0.56.

---

## 5. PERFORMANCE

One session, four stands, median frame cost, `stat unit` drawing.

| stand | noon frame ms | midnight frame ms |
|---|---|---|
| arrival plaza | 27.85 | 26.09 |
| Icarus checkpoint | 26.96 | 27.68 |
| Tartarus march | 26.69 | 27.28 |
| Dubel belt | 26.54 | 26.49 |

Game-thread bound throughout (game ≈ frame); render 11.9–14.6 ms; GPU 14.7–18.7 ms.
**Night costs between −1.8 and +0.7 ms** against noon at the same stand — the moon's second shadow-casting
light, the Dog's night lamp and five checkpoints are inside the noise.

This is an editor PIE window on a laptop that throttles under sustained play. **A packaged build has never
been measured.** That gap is a blocker below, not an estimate.

---

## 6. WEIGHTED BETA READINESS

Status key: **V** verified by measurement this run · **P** PIE-verified earlier · **I** implemented, not
visually verified · **B** blocked.

| # | system | weight | done | status | what remains |
|---|---|---|---|---|---|
| 1 | World / environment | 8 | 72% | P | 800–900 m density trough in all three nations; architecture crispness and wayfinding |
| 2 | Traversal / navigation | 6 | 80% | P | 7 of 24 destinations still InDevelopment; no destination inside any nation |
| 3 | Day–night / lighting / water | 7 | 88% | **V** | dawn dip is the darkest hour of the cycle; local architectural lighting (windows, lanterns) not built |
| 4 | Relay Dog + mascot skins | 8 | 85% | **V** | Arden Infernal's fire dominates its own silhouette; a founder call on trimming it |
| 5 | Project Brain | 5 | 82% | **V** | an "UNOBSERVED" overlay artefact is visible over the page in captures |
| 6 | Wardrobe | 5 | 92% | **V** | — |
| 7 | HUD / Menu / customization | 6 | 85% | **V** | cursor still ships defaulted to System |
| 8 | AI Companions | 5 | 80% | **V** | no provider connected; behaviour is simulated |
| 9 | Sub-Agent Cubs | 3 | 85% | **V** | — |
| 10 | Project Avatars / Server Avatar scalability | 5 | 55% | B | `zc_avatar_scale` X01 failing; TenTails sculpt awaits art direction |
| 11 | Julius Live Terminal | 5 | 65% | P | execution is simulated |
| 12 | Mission Contract | 4 | 70% | P | simulated; no real Julius work |
| 13 | Wonder Web | 3 | 55% | I | engine CEF dead on this machine; headless route designed, not wired |
| 14 | Wonderland ↔ Julius integration | 7 | 35% | I | Connect dev service only; nothing Julius does reaches the world |
| 15 | Multiplayer / beta-critical runtime | 5 | 15% | — | not built |
| 16 | Performance | 5 | 70% | **V** | 26–28 ms in PIE here; packaged never measured |
| 17 | Packaged-build readiness | 4 | 45% | I | game target compiles; never cooked or packaged this run |
| 18 | Persistence / config | 2 | 80% | **V** | skins, colours and territory discoveries persist |
| 19 | Territory / orientation / checkpoints | 4 | 88% | **V** | Dubel Forest needs a founder definition |
| 20 | Remaining visual polish | 2 | 60% | I | Arden preview, the UNOBSERVED artefact, TSR smear on small in-world text |
| 21 | Beta-blocking bugs | 1 | 70% | B | see below |

**Calculation** — Σ(weight × completion) ÷ 100:

```
 8×72  6×80  7×88  8×85  5×82  5×92  6×85  5×80  3×85  5×55  5×65
 4×70  3×55  7×35  5×15  5×70  4×45  2×80  4×88  2×60  1×70   =  6984
 6984 ÷ 100
```

# WONDERLAND BETA READINESS: **70%**

- **WONDERLAND WORLD / ENVIRONMENT: 79%** — items 1, 2, 3, 19, 20 (weights 27, weighted 2144)
- **JULIUS, as Wonderland presents it: 64%** — items 11, 12, 13 (weights 12, weighted 770)
- **WONDERLAND ↔ JULIUS INTEGRATION: 35%** — item 14

> I can only audit the Wonderland side. The Julius product lives in another repository and nothing here
> measures it; "JULIUS 64%" is the readiness of Julius's **surfaces inside Wonderland**, not of Julius.

---

## 7. BETA BLOCKERS, UNRESOLVED

1. **Multiplayer runtime is not built.** The single largest gap between this and a beta anyone else can enter.
2. **No packaged build has been produced or measured this run.** The game target compiles, which is necessary
   and not sufficient. Cook, package, launch, walk.
3. **`GameDefaultMap` still points at the old default** — the edit to `Config/DefaultEngine.ini` was
   permission-denied. A packaged build will open the wrong map until a founder or an approved change lands it.
4. **Julius execution does not reach Wonderland.** Every Julius surface in the world is a development preview
   and says so.
5. **Project Avatar scalability is unproven** — `zc_avatar_scale` X01 still fails; the earlier "avatars scale"
   claim was retracted as an extrapolation from four points.
6. **`zc_streaming` S01 still fails**: the shipping map is fully resident and does not stream. The partitioned
   twin does, and adopting it is a founder decision, not a fix.
7. **DUBEL FOREST has no canonical specialisation.** Marked in the game as NEEDS FOUNDER DEFINITION rather
   than invented. It needs a sentence from the founder.
8. **Arden Infernal's preview** shows a dog inside a plume that is twice its height. Framed correctly and
   unclipped; the proportion is the skin's own, and trimming it is art direction.
9. **Five commits on this branch are unpushed**, and the branch has never been proposed. Merging is founder
   authority.

---

## NOT READY FOR FOUNDER BETA REVIEW

Everything the founder named as broken on 2026-09-25 is fixed and verified by pixels rather than by state.
What stops the gate is not those corrections — it is items 1, 2 and 4 above: no multiplayer runtime, no
packaged build measured, and no Julius execution in the world.
