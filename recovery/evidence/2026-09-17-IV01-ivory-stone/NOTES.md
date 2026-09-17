# IV01 -- carved ivory stone: a stone's grain, and no more crumpled clay (2026-09-17)

Founder material-realism phase, building stone after ground.

Offline audit of the HD texture sets (shaded previews): cobble, roof scales and coursed ashlar already carry real
definition; the 'ivory' set worn by the world's towers, columns, arches, balustrades, pedestals and kit stone is a soft
cloudy mottle only -- the plain-beige-cube look.

Texture: 'ivory2' in hd_textures.py -- very fine crystal speckle, fine grain, rare thin veins, faint pores, bedding only
as a patchy hint. Four previews (ivory2_previews_early.jpg, ivory2_texture_previews.jpg): 1 pores read as black pepper;
2 bedding read as broad grey smudges; 3 bedding read as woven linen; 4 kept -- bright, clean, fine carved-stone grain.

In the world (reversible swap tool swap_mi_textures.py, found by what each instance samples: 11 instances on the ivory
family -- MI_V2_IvoryStone, MarblePale/Blush/Cool, TowerCream/Blush/Lavender and their HD twins; swap_record.json):
- texture ONLY (iv01_texture_only_ab*.jpg, 8 cameras + 3 close-ups): nearly invisible. Not the defect.
- the visible defect at close range is the ivory family's MQ01 normal tuning (NormalStrength 3.0, DetailStrength 1.2):
  carved pieces read as lumpy crumpled clay. Tuned NormalStrength 1.0 / DetailStrength 0.3 on the 7 world instances
  (tune_material_instances.py, normal_record.json).
- texture + calmer normal (iv01_texture_and_normal_ab.jpg; before re-captured from the original state after reverting
  the swap): the Clock Plaza pedestals and the bridge newel read as clean carved stone instead of clay; brightness
  unchanged; no regressions at the wide cameras. Kept and saved (saved.json).
Remaining: the generator balusters (Lantern Lane, Cloister) stay lumpy -- their mesh itself is noisy. A Blender
candidate (a clean turned baluster), not a material fix.
Performance: textures of the same size on the same master, two scalars changed: no shader or geometry change.
Revert: swap_mi_textures.py REVERT=True with swap_record.json; tune_material_instances.py REVERT=True with normal_record.json.
