# LT01 -- lighting that reveals the materials: the unshadowed fills halved (LOOK03, 2026-09-17)

Material-realism phase, lighting response. At a medium facade (City_FillEE54) the wall met the plaza on a hard line
with no contact depth, and carved pieces were evenly lit. The renderer is not the cause (postprocess.json, DefaultEngine.ini:
Lumen GI + Lumen reflections with hardware ray tracing, virtual shadow maps). The cause is LOOK02's fill
(lights_before.json): sun 70,000 lux plus ~21,000 lux of UNSHADOWED directional fill -- V2_GroundBounce 3,000 and two
low canopy fills V2_CanopyFill / V2_CanopyFill2 at 9,000 each -- lighting every recess and wall base evenly.

Variants at 8 identical cameras in one session, restored after capture (lt01_ab1.jpg, lt01_ab2.jpg):
| lt0 | current | flat form |
| lt1 | ground bounce 2,000, canopy fills 4,500 each, sky light 2.25 | KEPT: pedestals, facades and window recesses gain light-to-shade form; still bright |
| lt2 | ground bounce 1,500, canopy fills 2,500 each, sky light 2.6 | the hero pocket clock's shaded dial near-black; street shade gloomy blue |

Applied as WorldDesign/Look/look03_form_revealing_fill.json (apply_light_tune.py; REVERT restores) and saved (saved.json).
Performance: fewer lux on unshadowed lights -- no cost change.
