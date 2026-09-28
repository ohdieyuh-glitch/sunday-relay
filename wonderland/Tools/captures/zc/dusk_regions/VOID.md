# VOID: do not use these images as evidence

Produced by `zc_dusk_regions` (results `_channel/done/zzAA1`, `zzAC1`, `zzAD1`, `zzAE1` and
`zzAG2_dusk_regions.json`).

**golden_arrival:** the camera sat 900 uu above SPOT (-64, -5042), inside foliage. It was obstructed at
all 8 yaws on the visibility channel. The clear-view gate (V_CLEAR) traced on the pawn channel, which
foliage does not block, so it passed. These frames show the inside of a plant.

**noctis_nc02, tartarus_tq04:** these cameras were never shown to be obstructed. They passed the same
foliage-blind gate at the same 900 uu, though, so none of their frames can be shown to be of the ground
either. Treat them as unproven, not as a baseline.

Every per-region dusk step taken from these runs is void. The "0.0126 dusk hole" is not from this job.
It was read by `zc_dusk_hole` and `zc_dusk_closed` at a different, open camera (EYE (-320, -1900, 200),
looking at the monument plinth), before the Nightfall change.

For valid dusk evidence, use `../dusk_truth/` (plaza_e, plaza_se) and `../dusk_handover/`. Both were taken
from the open plaza vantage (-64, -5700), yaw 90, at eye height, proven with a visibility-channel trace.

Quarantined 2026-09-28 by the world lane. The job itself now refuses to run.
