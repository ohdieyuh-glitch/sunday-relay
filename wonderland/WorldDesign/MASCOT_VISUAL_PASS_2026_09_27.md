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

## 2. Eyes

Every skin's `start()` now lays an additive **`eyehalo`** pane just behind and 1.45× wider than each eye, in the
eye's colour; `ApplyColourway` drives any eye material whose name contains "halo" at 0.35 of the eye's level.
Core + rim + colour + contrast. The core's level itself is under the World session's sweep (`zzX10_mascot_knee`),
which also found that `wl.Look.EyeGlowDay = 18` has been clamped to 12 since it was written.

## 3. V1 and V2

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
| `zc_eyes_glow` | eye over cheek, day/dusk/night, eight skins | pending the build |
| `zc_spectral` | Skeleton beat / cyan / not-a-white-shape per angle | pending |
| `zc_flame_dim` | gentlest flame dim satisfying the founder's list | pending (old assets: no setting could pass; the head was pinned) |
| `zc_cub_family` | eight flocks, dressed, changing coat in place | pending |
| `zc_skin_parity_all` | every skin wears the canonical pose and performs the act | pending |
| comparison sheets | REFERENCE / V1 / V2, six views | `Tools/skin-comparison-sheet.ps1`, after `zc_skin_sheet` |

**Open:** Arden's wardrobe height (63–70% against a 76–94 band) — the demonic arm is body and widens the fit;
the stage's manual exposure bias is a dead lever (swept 0 to −4.5 EV, no change) and the stage's white point sits
near 2, which is why the glow scale rather than the exposure was tuned.
