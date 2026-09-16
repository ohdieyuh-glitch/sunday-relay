# AP01 -- atmospheric depth: tried, REJECTED (2026-09-16)

Gap: the overviews run crisp to a hard green edge and a sea horizon; the Bible's distant skyline fades to lavender.

Chain in one session, in memory only, restored to a0 (the ap01_*.json specs record every transition):

| state | aerial_pespective_view_distance_scale | fog density | fog inscatter | fog start |
|---|---|---|---|---|
| a0 (unchanged) | 1 | 0.009 | (0.74, 0.80, 0.92) | 4000 |
| a1 | 6 | 0.009 | same | 4000 |
| a2 | 12 | 0.015 | (0.82, 0.80, 0.98) | 5000 |
| a3 | 20 | 0.022 | (0.86, 0.82, 1.00) | 6000 |

Judgement: even a3 barely moves the frames. The sea horizon stays hard (the camera height thins the height fog), and
the change that does show is the overviews going paler, which are already low in saturation next to BOARD_2.
Not an improvement; nothing saved. Atmosphere alone will not give the Bible's depth: the distance also needs
colour and hierarchy in the skyline itself. The tool change stays: apply_light_tune.py can now take any component
class (SkyAtmosphereComponent, ExponentialHeightFogComponent) with the same before/after discipline.
