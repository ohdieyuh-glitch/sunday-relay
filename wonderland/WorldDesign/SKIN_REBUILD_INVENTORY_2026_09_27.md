# ARDEN INFERNAL & APOLLO — COMPONENT INVENTORY FROM THE FOUNDER'S SHEETS

Founder, 2026-09-27: "Before building each skin, decompose the reference into actual components. Create a
component inventory. Then build against that inventory. Do not declare the skin finished while major reference
components remain absent." This is that inventory, read off `RelaySkins/_reference/ArdenInfernal_founder_sheet.png`
and `Apollo_founder_sheet.png` (FRONT / SIDE / REAR / 3/4 and the insets). Proportions are in heads (the head is
9.2 wide, 8.0 tall). Every row becomes geometry in `Tools/relay_dog_skins.py`; the OK column is filled from
the offline turnaround and then the wardrobe six-view sheet, never from the code.

## ARDEN INFERNAL

| # | class | component | what the sheet shows | built |
|---|---|---|---|---|
| 1 | BODY | canonical Relay Dog | cream/ivory, black visor, two ORANGE glowing eyes | base_dog |
| 2 | HALO | ring | enormous, 2.4 heads across, thick dimensional gold band, seen slightly from inside | two gold rings + deep inner rule |
| 3 | HALO | rune band | lighter engraved pattern running round the band | alternating studs on a third ring |
| 4 | HALO | crown ornament | gold diamond frame at the top with a red gem and a point above | diamond bars + ruby + spike |
| 5 | HALO | side gems | red gems in gold settings at 9 and 3 o'clock, small drops | settings + rubies |
| 6 | VFX | halo fire | flames along the top half of the ring, tallest at the crown, faint all round | flame() on the arc |
| 7 | CLOTHING | tunic | cream layered cloth over the torso, red showing at the V and the hem | front/back/side shells + crimson inner |
| 8 | CLOTHING | collar + waist band | gold band at the collar, gold band at the waist with studs | slabs + studs |
| 9 | CLOTHING | shoulder mantle (cream side) | cream cape panel over the cream shoulder falling down the outer arm, crimson underlayer | panel slabs + drape |
| 10 | JEWELRY | chains | six gold chains at three depths looped across the chest | chain_run ×6 |
| 11 | JEWELRY | pendants | red gem drops from the chains, a gem drop at the collar | pendant ×4 |
| 12 | ORNAMENT | wheel medallion | dharma wheel with a ruby hub at the sternum, a smaller sun pendant below | spoked_wheel ×2 |
| 13 | ARM FEATURE | demonic arm | black/dark-red SEGMENTED arm on the figure's right, spiked shoulder, reaching the floor, claws fanned | segments + ember seams + claw_hand |
| 14 | EMISSIVE | arm seams | glowing red/orange seams between the segments | ember boxes between segments |
| 15 | ORNAMENT | infernal sigil | large glowing red wheel beside the hand, dimensional (rim + spokes + hub, two layers) | spoked_wheel + rings + hub |
| 16 | VFX | arm fire | flames off the pauldron and the outside of the limb | flame() ×3 |
| 17 | JEWELRY | cuff | gold bracelet with a red gem on the cream wrist | slab + ruby |
| 18 | CAPE/DRAPERY | robe | layered panels waist to floor: cream centre with red stripes, crimson sides, black outer, 2.6 heads at the hem, gold trim at the top | cloak ×2 + drape ×5 + trim |
| 19 | CAPE/DRAPERY | rear | the robe covers the whole back with gold trim; halo and tail read from behind | back cloak layers |
| 20 | TAIL | infernal tail | long black/red segmented tail curling up behind the left hip | 22 segments, char/demon, ember seams |
| 21 | VFX | tail fire | fire at the tip and along the upper curve | flame() ×3 |
| 22 | BODY | feet | cream feet showing under the robe's front | base_dog |

## APOLLO

| # | class | component | what the sheet shows | built |
|---|---|---|---|---|
| 1 | BODY | canonical Relay Dog | ivory, black visor, two GOLD/YELLOW glowing eyes | base_dog |
| 2 | VFX | solar crown | a block of fire the head's width, 1.3 heads tall, yellow-orange, straight up | flame() ×3 passes |
| 3 | HALO | ring | one plain flat gold band 2.7 heads across, visibly thick, enclosing the fire, behind the head | two gold rings + deep back ring |
| 4 | ARMOR | pauldron cap | a sculptural gold cap outside the head's width on each shoulder | slab cap + deep undercap |
| 5 | ORNAMENT | cherub | a winged cherub face on the front of each cap, a second below | cherub_face ×2 |
| 6 | ARMOR | wing scrolls | three baroque volutes curling up and out, rising to ear height | baroque_scroll ×3 |
| 7 | ARMOR | feather fan | rows of gold feathers fanning outward and up from the cap | 6 feather rows |
| 8 | ARMOR | arm cascade | gold plates stepping down the upper arm under the cap | 3 slabs + seams |
| 9 | ARMOR | gorget | gold collar across the shoulders | slab |
| 10 | CLOTHING | sash | white stole crossing the chest from each shoulder to the opposite hip | diagonal linen runs |
| 11 | ORNAMENT | sun emblem | large layered gold sun with twelve rays on the sternum | plates + star_burst + ring + boss |
| 12 | JEWELRY | chains | gold chains below the emblem with pendants | chain_run ×3 + pendants |
| 13 | ARMOR | belt + tassets | gold waist band; eight hanging gold plates each with a gem, white between | slabs + gems |
| 14 | ARMOR | vambraces + hands | gold forearm plates and gold hands, a bracelet ring | slabs ×3 per arm |
| 15 | ORNAMENT | lamp-orbs | a glowing orb on a gold rod at each hip beside the hands | orb_on_rod ×2 |
| 16 | CAPE/DRAPERY | drapery | white cloth waist to floor, layered panels, gold borders, 2.2 heads at the hem | cloak ×2 + drape ×5 + border |
| 17 | CAPE/DRAPERY | rear train | substantial white cape from the shoulders to the floor | back cloak layers |
| 18 | ARMOR | greaves + boots | gold shin plates, gold boots, knee gems | slabs + gems |
| 19 | EMISSIVE | eyes, orbs, gems | eyes gold; orbs and gems solar-pale | glow materials |
