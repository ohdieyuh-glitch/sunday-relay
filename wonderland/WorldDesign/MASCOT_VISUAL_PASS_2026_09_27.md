# MASCOT VISUAL PASS — 2026-09-27

Founder directives this session, in order: dim the flames (twice); glowing coloured eyes on every skin at
day/dusk/night; a matching Sub-Agent Cub per skin; three skins rebuilt from the founder's reference sheets;
then **"completely redo them, save the previous ones"** and **"call the previous one V1 and keep them in the
Wonderland world and make the new ones called V2"**; and: the cub ghosts look good.

Branch `local/wonderland-task3`. Status line at the bottom is updated as evidence lands; nothing here is
green from a parameter dump.

---

## 1. The one number under the whole cluster

`Tools/relay_dog_skins.py` multiplied every glow strength by **4000** on the way into the `.wlvox`. An ember
authored at 0.6 shipped at 2,400; Celestial Light's edge at 5.2 shipped at 20,800. In the world a material
strength of 1.0 renders at luma 0.039 and white pins near 25, so every premium skin was **40–800× past
clipping**. The runtime knee (`wl.Look.GlowKnee` 700, curve 0.15) then folded that whole range into 840–1,240 —
one white. What the founder was looking at:

`Tools/captures/zc/before_rebuild_2026-09-27/h12.0_arden_infernal.png` — Arden at noon, a screen-filling
yellow-white blow-out with no mascot in it.

Every reported symptom is that one number: eyes that could never out-read a face pinned at 1.0; a chest skull
that could not read as cyan; flames that swallowed the silhouette; bloom eating the C.A.R.D.; a flame-dim knob
that could not reach below white from either end of its range (the sweep of 14:28 found no passing setting —
the *head* was pinned whatever the flames did). `GLOW_SCALE` is now **6.0**: the same authored numbers land at
3–13, below white, with the eyes — driven to an absolute 12 — the brightest thing on every head. Celestial
Light's own head glow (edge/starlight/ink) came down under its eyes in the same change.

Everything downstream had been calibrated around the old scale and is being re-measured: the wardrobe stage's
glow scale (0.0015 → 0.10, from `zc_stage_tune`), the flame proofs' plume band (+175 → +100 uu; at +175 they
were reading sky), the eye gate's reference patch (it was the **chest**, figure z 13.6, the skull plate on
Skeleton Flame — now a cheek beside the eye).

### 1c. The white point is 25,000, not 25

Pinning the strength did not bring the glow back, and the reason corrects every number above. The post-process
volume holds noon at EV100 14.2; at that exposure a sunlit ivory wall is ~20,000 scene units, so the world's white
is near **25,000**. The "25" had been measured on a rim material that carries a ×1000 internally. So an engine
unlit pane at Color 18 is black in this world; `M_WL_VoxelGlow` needs Color × EmissiveStrength ≈ 15,000–25,000 for
an eye (level 18 × 1000); `M_WL_VoxelAdditive`'s emissive is its Color and must carry the thousand itself. One
constant, `WonderlandSceneUnits = 1000`, written once (embodiment, Dog eye panes, fallback flame path ×12). The
blow-out at the old scale was real (Color 842 × strength 842 = 28× white); the arithmetic that described it was
off by the material's thousand. Also found in the same hour: two editor instances had been running on one map
and one channel from 09:05 to 09:24 (a killed relaunch chain plus its replacement); every artifact in that
window is void, and the launcher now refuses a second instance.

### 1b. The second factor: the glow material was quadratic

The re-baseline alone turned every glow in gameplay **black** (`zc_eyes_look` after `d92ed651`: Celestial's
halo ring and brow star, Skeleton's ghostfire, every costume eye — black blocks). `M_WL_VoxelGlow`'s emissive is
Color × EmissiveStrength × ~0.001, and the embodiment set BOTH from the authored strength: 1,200 × 1,200 was one
white; 4 × 4 is 0.02. The eyes had only ever read at level 12 because their strength (32,000 → 1,242) supplied the
other factor. `EmissiveStrength` is now pinned at 1000 on every glow and flame instance, so the material's output
IS `Color` — the one number the tame curve, the day cycle and the eye drive set. The calibration "1.0 → luma
0.039, white near 25" was measured on RIM materials, which have no such term.

## 2. Eyes — the gameplay Dog's eyes had never emitted

Founder P0, afternoon: "THE MASCOT EYES ARE STILL NOT GLOWING." Read off the live actor (`zc_eyes_look`): the
default Dog in gameplay is `BP_RelayDog`'s own meshes. Its eyes are one component, `Mesh_head_eye`, material
`MI_RelayDog_Eye` (constant instance of `M_V2_Portal`): BaseColor gold, **EmissiveColor (0,0,0)**,
EmissiveStrength 540. Black × 540 is nothing — two flat orange squares, which is the founder's screenshot
(`captures/zc/eyes_look`, BEFORE). And the eye-level drive only ever iterated companion embodiments: costumes,
cubs, the wardrobe figure. Every eye number in the corpus before commit `d92ed651` was measured on an object
the founder does not look at.

Fix (`d92ed651`): `ARelayDogCharacter::SetEyeGlow` puts the glow material on the eye panes and two additive
halo panes behind each; the day cycle drives the Dog beside the figures; colourway SECONDARY re-drives core
and halo together; the 12 clamp that had silently held `EyeGlowDay 18` at 12 is 30; `EyeGlowNight` 8.
Verified by looking: the AFTER close-ups from `zc_eyes_look` (below), not by a number.

### 2b. Every skin's eye halo

Every skin's `start()` now lays an additive **`eyehalo`** pane just behind and 1.45× wider than each eye, in the
eye's colour; `ApplyColourway` drives any eye material whose name contains "halo" at 0.35 of the eye's level.
Core + rim + colour + contrast. The core's level itself is under the World session's sweep (`zzX10_mascot_knee`),
which also found that `wl.Look.EyeGlowDay = 18` has been clamped to 12 since it was written.

## 3. V1 and V2 — and V2 written from zero

Founder, afternoon: the first V2s were "NOT acceptable approximations of the references ... START BOTH SKINS
FROM SCRATCH ... missing the most important part of both designs: THE CLOTHING / ARMOR / ORNAMENTATION." So
each sheet was decomposed into a component inventory first (`SKIN_REBUILD_INVENTORY_2026_09_27.md`, 22 rows
Arden, 19 Apollo) and the builders rewritten row by row against it (`d1aabf33`): tunic, mantle, chains at
three depths, studded rune halo with a diamond crown ornament, segmented demonic arm with glowing seams,
two-layer sigil, nine-panel robe with gold trim, 22-segment tail for Arden; winged pauldrons (cap, cherubs,
scrolls, feather rows, arm cascade), gorget, crossing stole, layered sun, chains, gemmed tassets, vambraces,
lamp-orbs, five-panel drapery with gold borders, greaves for Apollo. Skeleton Flame V2 stands as built.

| skin | V1 (previous, kept) | V2 (redone from the sheet) |
|---|---|---|
| Arden Infernal | `ArdenInfernalV1.wlvox` — flaming halo, chains, demonic arm, tail, no robe | `ArdenInfernalV2.wlvox` — gem-set flaming halo 2.3 heads across; six chains over a bare chest with the wheel medallion; the robe of cream, crimson and black to the floor; the demonic arm on the figure's **right** (the viewer's left, as on the sheet — V1 had it mirrored); gold cuff on the cream arm; the tail behind the left hip |
| Apollo | `ApolloV1.wlvox` — sunburst rays, baroque wings, gold armour, no drapery | `ApolloV2.wlvox` — a plain flat gold ring enclosing the crown of fire; winged cherub pauldrons at the sheet's size; a sun of twelve rays on the chest; gold vambraces and hands; lamp-orbs at the hips; white drapery to the floor under gold tassets; gold boots |
| Skeleton Flame | `SkeletonFlameV1.wlvox` — ribcage cut into the chest, tall ghostfire, jointed limbs | `SkeletonFlameV2.wlvox` — a broad figure in stepped bone plates with dark seams; skulls at brow, temples and sternum; the sternum skull burning over the gold chain; ghostfire a head tall from each ear, off the elbows and up the spine; feet as blocks of pale blue light in a pool of fire |

Registry: the ids the project already uses (`arden_infernal`, `apollo`, `skeleton_flame`) now mean V2 and are
labelled "… V2" in the wardrobe; `arden_infernal_v1`, `apollo_v1`, `skeleton_flame_v1` are the V1s. Eight active
skins. The V1 builders run verbatim from the pre-redo generator (kept at
`RelaySkins/_previous/2026-09-27-pre-redo/`, sha256 in `recovery/_map_checkpoints/2026-09-27-relayskins-prerebuild`);
they gain only the glow re-baseline and the eye halo. The three reference sheets are in `RelaySkins/_reference/`
and are the authority the V2s were written from.

Decisions taken under "the sheet decides", each overriding an earlier note and each isolated in the generator:
Arden's robe and Apollo's drapery **return** (09-23 had removed both); Apollo's rays and Skeleton's ribcage
**go** (neither is on any view of its sheet). The founder can overrule any one of these without touching the others.

## 4. Cubs

Approved by the founder as they are. One cub per skin per expression on the plate's own cub morphology —
head, ball hands, ghost tail — wearing the parent's identity at the cub's scale: Arden's flaming ring, chain and
ember claw; Apollo's ring, crown fire and gorget; Skeleton's brow skull, ear fire and cyan hands; Celestial's
radiant edge, brow star and ring; Relay OG's cub unchanged. `RelayCubs/CubGhost_<Skin>_<Eyes>.wlvox`, measured
before dressing so a halo cannot shrink the cub. `UWonderlandSubAgentCubSubsystem` picks the family for the
skin the Dog wears (V1 and V2 share a family) and re-dresses a living flock in place on a skin change; the cub
stays a SubAgent body with its own transform and grounding.

## 5. Evidence (updated as it lands)

| gate | what it proves | state |
|---|---|---|
| `zc_skin_sheet` | six wardrobe views per skin; band; not a white shape | intermediate assets 07:53: pinned 0.0 on Relay OG/Celestial/Skeleton (was 68–80% over 140), Apollo 56–64% pinned by *rim* surfaces (stage exposure, §1) — re-run after the V1/V2 build |
| `zc_eyes_look` | the founder's own test: a close-up of every skin's face, day and night, looked at | scene-units build (`57adca4b`, single editor PID 40672): Relay OG eyes RENDER day and night as two bright yellow panes on a glowing plate; Skeleton ghostfire controlled cyan; Apollo crown orange; Arden costume eyes bright. Short of the bar on two counts — halo is one plate not a rim per eye; Celestial body glow at a quarter of white — both in round 2 (scale 15, per-eye halos, paused frames) |
| `zc_eyes_glow` | eye over cheek, day/dusk/night, eight skins | its +62 patch is the brow on costumes (they are 1.55 m against the Dog's 1.74); re-anchor per figure before it is quoted |
| `zc_spectral` | Skeleton beat / cyan / not-a-white-shape per angle | pending |
| `zc_flame_dim` | gentlest flame dim satisfying the founder's list | pending (old assets: no setting could pass; the head was pinned) |
| `zc_cub_family` | eight flocks, dressed, changing coat in place | pending |
| `zc_skin_parity_all` | every skin wears the canonical pose and performs the act | pending |
| comparison sheets | REFERENCE / V1 / V2, six views | `Tools/skin-comparison-sheet.ps1`, after `zc_skin_sheet` |

**Open:** Arden's wardrobe height (63–70% against a 76–94 band) — the demonic arm is body and widens the fit;
the stage's manual exposure bias is a dead lever (swept 0 to −4.5 EV, no change) and the stage's white point sits
near 2, which is why the glow scale rather than the exposure was tuned.
