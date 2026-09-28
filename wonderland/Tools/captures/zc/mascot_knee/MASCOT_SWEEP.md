# MASCOT GLOW SWEEP -- measured on the mascots, not inherited from the Companion

The Companion's sweep selected a knee of 220 at a clipped fraction of 1.79%. That was measured on the
Companion. This is the mascot evidence, taken on the mascot skins with the mascot materials, and
nothing in it is copied from that run -- including the 220.

## Did the runs actually run

Every number below is worth exactly as much as this section. A sweep that measured a torn-down PIE
published nine gates of the luma of a black viewport earlier today, two of them PASSING, so this
comes before the data and not after it.

The run column is the file this report actually read, chosen as the NEWEST match for each axis and
hour rather than by a name written into the generator. Pre-fix runs stay on disk on purpose; an age of
hours on a row means that axis has not been re-run and its numbers are not about the current build.

| run (newest match) | age | hour | status | died_at | gates green | note |
|---|---|---|---|---|---|---|
| zzM5_eye_day | 7m | DAY | measured | none | 6/13 |  |
| zzM6_eye_dusk | 2m | DUSK | measured | none | 4/13 |  |
| zzM3_eye_night | 89m | NIGHT | measured | none | 5/13 |  |
| zzM4_knee | 12m | KNEE | measured | none | 3/3 |  |

## Was the eye found, and did it respond

A patch that is not on the eye measures a cheek, and a peak that does not beat its own noise floor is
the largest of 49 noisy cells rather than a response. Both are reported per skin because both were
silently wrong in earlier runs of this job.

An anchor that reads the same to one decimal on figures of two different heights is one component
found many times, not eight eyes located. That is what zzM1 did: `mesh`, 24.7, on all eight, from a
component pivot. The candidate column is here so that cannot pass again unexamined.

| skin | anchor found by | anchor z | peak delta | noise floor | beats noise | candidates |
|---|---|---|---|---|---|---|
| relay_og | fallback:no-eye-component | 62.0000 | 0.0000 | 0.0004 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |
| celestial_light | fallback:no-eye-component | 21.0000 | 0.0000 | 0.0011 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |
| apollo | fallback:no-eye-component | 21.0000 | 0.0000 | 0.0012 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |
| arden_infernal | fallback:no-eye-component | 21.0000 | 0.0000 | 0.0001 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |
| skeleton_flame | fallback:no-eye-component | 21.0000 | 0.0000 | 0.0022 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |
| apollo_v1 | fallback:no-eye-component | 21.0000 | 0.0000 | 0.0020 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |
| arden_infernal_v1 | fallback:no-eye-component | 21.0000 | 0.0028 | 0.0026 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |
| skeleton_flame_v1 | fallback:no-eye-component | 21.0000 | 0.0000 | 0.0085 | **NO -- unresolved, not absent** | Mesh_head_eye static pivot=24.7 bounds=None |

## The shipped configuration, per skin, per hour

Taken with EyeGlowDay and EyeGlowNight left at the values the build ships (24.0000 by day, 8.0000 at night) and
the day cycle allowed to interpolate between them. This is the row that answers what the founder sees.
The swept rungs isolate the level from the hour by pinning both cvars equal, which is the right way to
measure a response and is NOT the shipped state.

Two readings need their units stated or they will be misread:

* **clipped %** is the fraction of the head shot above **luma 0.72** -- about 183/255, NOT 250. It
  cannot tell a saturated eye core from a blown white one on its own.
* **eye whiteness** is what separates those: 0.0 is fully saturated colour, 1.0 is neutral white. A
  high bright fraction with LOW whiteness is the bright coloured core the handoff asked for; a high
  bright fraction with whiteness near 1.0 is the white clipping it forbade.

### DAY

| skin | face luminance | eye luminance | eye-vs-face contrast | clipped pixel % | crushed-black % | eye colour separation | eye hue retention | emissive level (EyeGlow) | eye bright fraction | eye whiteness |
|---|---|---|---|---|---|---|---|---|---|---|
| **relay_og** | 0.5452 | 0.5481 | 0.0029 | 0.0226 | 0.1336 | 1.0000 | 0.9737 | 24.0000/8.0000 day/night | 0.0000 | 0.5863 |
| **celestial_light** | 0.7320 | 0.4873 | -0.2447 | 0.0166 | 0.1990 | 0.4522 | 0.9990 | 24.0000/8.0000 day/night | 0.1667 | 0.9738 |
| **apollo** | 0.7639 | 0.5918 | -0.1721 | 0.0220 | 0.2083 | 0.5896 | 0.9945 | 24.0000/8.0000 day/night | 0.7421 | 0.4104 |
| **arden_infernal** | 0.4530 | 0.6781 | 0.2251 | 0.0074 | 0.2604 | 0.9846 | 0.9846 | 24.0000/8.0000 day/night | 0.0000 | 0.0260 |
| **skeleton_flame** | 0.2367 | 0.0124 | -0.2243 | 0.0123 | 0.2821 | 0.0000 | **no light added** | 24.0000/8.0000 day/night | 0.0000 | 0.6013 |
| apollo_v1 _(twin)_ | 0.6195 | 0.8051 | 0.1856 | 0.0300 | 0.1571 | 0.5343 | 0.9901 | 24.0000/8.0000 day/night | 1.0000 | 0.4659 |
| arden_infernal_v1 _(twin)_ | 0.2609 | 0.3353 | 0.0744 | 0.0041 | 0.2360 | 1.0000 | 0.0862 | 24.0000/8.0000 day/night | 0.0000 | 0.0520 |
| skeleton_flame_v1 _(twin)_ | 0.2234 | 0.0597 | -0.1637 | 0.0158 | 0.2157 | 0.0000 | **no light added** | 24.0000/8.0000 day/night | 0.0476 | 0.7858 |

### DUSK

| skin | face luminance | eye luminance | eye-vs-face contrast | clipped pixel % | crushed-black % | eye colour separation | eye hue retention | emissive level (EyeGlow) | eye bright fraction | eye whiteness |
|---|---|---|---|---|---|---|---|---|---|---|
| **relay_og** | 0.3706 | 0.0168 | -0.3538 | 0.0229 | 0.9424 | 0.0000 | **no light added** | 24.0000/8.0000 day/night | 0.0000 | 0.3762 |
| **celestial_light** | 0.0009 | 0.5107 | 0.5098 | 0.0151 | 0.4545 | 0.1867 | 0.9947 | 24.0000/8.0000 day/night | 0.1892 | 0.9768 |
| **apollo** | 0.0194 | 0.5438 | 0.5244 | 0.0159 | 0.9035 | 0.0000 | **no light added** | 24.0000/8.0000 day/night | 0.6190 | 0.5575 |
| **arden_infernal** | 0.1157 | 0.7909 | 0.6752 | 0.0570 | 0.4181 | 0.9439 | 0.9800 | 24.0000/8.0000 day/night | 1.0000 | 0.0653 |
| **skeleton_flame** | 0.0185 | 0.1110 | 0.0925 | 0.0271 | 0.8251 | 0.2048 | 0.9647 | 24.0000/8.0000 day/night | 0.1190 | 0.7300 |
| apollo_v1 _(twin)_ | 0.0254 | 0.8897 | 0.8643 | 0.0377 | 0.8815 | 0.3686 | 0.9720 | 24.0000/8.0000 day/night | 1.0000 | 0.6262 |
| arden_infernal_v1 _(twin)_ | 0.1112 | 0.2768 | 0.1656 | 0.0548 | 0.5342 | 0.9184 | 0.9812 | 24.0000/8.0000 day/night | 0.3095 | 0.0793 |
| skeleton_flame_v1 _(twin)_ | 0.0702 | 0.0295 | -0.0407 | 0.0735 | 0.5899 | 0.2944 | 0.9751 | 24.0000/8.0000 day/night | 0.0238 | 0.5468 |

### NIGHT

| skin | face luminance | eye luminance | eye-vs-face contrast | clipped pixel % | crushed-black % | eye colour separation | eye hue retention | emissive level (EyeGlow) | eye bright fraction | eye whiteness |
|---|---|---|---|---|---|---|---|---|---|---|
| **relay_og** | 0.1003 | 0.1002 | -0.0002 | 0.0039 | 0.2900 | 0.0000 | **no light added** | 18.0000/8.0000 day/night | 0.0000 |   --   |
| **celestial_light** | 0.5170 | 0.4450 | -0.0720 | 0.0037 | 0.0703 | 0.0000 | **no light added** | 18.0000/8.0000 day/night | 0.0000 |   --   |
| **apollo** | 0.2935 | 0.2957 | 0.0022 | 0.0026 | 0.4772 | 0.0000 | **no light added** | 18.0000/8.0000 day/night | 0.0000 |   --   |
| **arden_infernal** | 0.2410 | 0.5461 | 0.3051 | 0.0040 | 0.1140 | 0.5693 | 0.8082 | 18.0000/8.0000 day/night | 0.0000 |   --   |
| **skeleton_flame** | 0.2983 | 0.5254 | 0.2271 | 0.0029 | 0.2262 | 0.7994 | 0.6017 | 18.0000/8.0000 day/night | 0.0000 |   --   |
| apollo_v1 _(twin)_ | 0.3590 | 0.3037 | -0.0553 | 0.0031 | 0.3418 | 1.0000 | 0.9726 | 18.0000/8.0000 day/night | 0.0000 |   --   |
| arden_infernal_v1 _(twin)_ | 0.2598 | 0.4254 | 0.1656 | 0.0034 | 0.1667 | 0.5735 | 0.8590 | 18.0000/8.0000 day/night | 0.0000 |   --   |
| skeleton_flame_v1 _(twin)_ | 0.2759 | 0.4021 | 0.1262 | 0.0034 | 0.2008 | 0.6576 | 0.7142 | 18.0000/8.0000 day/night | 0.0000 |   --   |

## The knee

Knees swept: [700.000, 64.000, 32.000, 16.000, 8.000, 4.000, 2.000], with the shipped 700 as the control.

A knee counts as engaged only where it DARKENS the frame past three times that skin's own largest
upward step, and does not reverse below. A compression knee cannot brighten a frame, so every rise
as the knee falls is noise the run measured on itself -- which is where the floor comes from rather
than from a number anyone picked.

| skin | spread | own noise | engaged at | frame luma by knee [700.000, 64.000, 32.000, 16.000, 8.000, 4.000, 2.000] |
|---|---|---|---|---|
| relay_og | 0.0144 | 0.0132 | inert | 0.2731 0.2587 0.2719 0.2700 0.2669 0.2650 0.2654 |
| celestial_light | 0.1514 | 0.0102 | **4.0** | 0.3264 0.3366 0.3215 0.3196 0.3116 0.2424 0.1852 |
| apollo | 0.0149 | 0.0120 | inert | 0.2839 0.2892 0.2858 0.2836 0.2865 0.2985 0.2844 |
| arden_infernal | 0.0529 | 0.0472 | inert | 0.2711 0.3183 0.3168 0.2896 0.3048 0.2955 0.3240 |
| skeleton_flame | 0.0414 | 0.0206 | inert | 0.2358 0.2564 0.2751 0.2607 0.2472 0.2337 0.2503 |
| apollo_v1 | 0.0288 | 0.0106 | inert | 0.3064 0.2963 0.2936 0.2957 0.2928 0.3035 0.2776 |
| arden_infernal_v1 | 0.0624 | 0.0612 | inert | 0.2998 0.3610 0.3222 0.3385 0.3025 0.3622 0.3143 |
| skeleton_flame_v1 | 0.0452 | 0.0309 | inert | 0.3001 0.3008 0.2687 0.2681 0.2608 0.2751 0.3059 |


WonderlandTameGlow compresses only ABOVE the knee. After the GLOW_SCALE 4000 -> 6 re-baseline the
brightest body glow on any skin is 13.2, so a knee anywhere near the Companion's 220 -- or the
shipped 700 -- sits above every mascot value and compresses nothing. That is the specific reason
220 could not simply be carried across, and it is the answer to the handoff's first question.

## Celestial Light, and Skeleton Flame

### Celestial Light

The handoff flagged a NEGATIVE eye-vs-face contrast on unclipped samples and said, correctly, that if
its eye emission is not reaching the rendered eye then a knee will not fix it. The discriminator is the
isolation column: eye gain minus face gain as the level rises. If isolation stays near zero while the
level climbs, the level is not arriving at the rendered eye and no knee, curve or halo count will
change that.

| hour | over_face | isolation | hue retention | eye whiteness |
|---|---|---|---|---|
| DAY | -0.2447 | -0.6846 | 0.9990 | 0.9738 |
| DUSK | 0.5098 | 0.0805 | 0.9947 | 0.9768 |
| NIGHT | -0.0720 | -0.0041 |   --   |   --   |

### Skeleton Flame

The ask is to dim the flames while keeping the ghostfire identity: spectral colour, flame motion,
glowing eyes, chest skull, skull-eye glow, the side and back spectral element, and the LOW -> MID ->
HIGH pulse. THIS SWEEP DOES NOT MEASURE ANY OF THOSE except the eyes. FlameDim is restored, not swept,
and nothing here reads flame motion, the pulse, or the chest skull. Treat the flame requirement as
UNMEASURED rather than as passing quietly on the strength of an eye reading taken on the same skin.

## What this artefact does not establish

* **Nothing about the Companion.** 220 is not tested here and is not endorsed or contradicted.
* **The flame requirements above**, which no gate in this job reads.
* **Bloom as such.** Bloom intensity and threshold are read from the post-process volume and reported,
  but bloom is not swept, so "controlled bloom" is described rather than demonstrated.
* **Anything on a skin whose row reads UNRESOLVED.** An unlocated eye is an unknown, not a zero, and
  averaging it in as a zero is how a dark reading becomes a confident wrong conclusion.


