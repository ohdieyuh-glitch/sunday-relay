# SC03 -- generator castle-tower stone warmed (2026-09-16)

Gap: after SC02 tinted the kit skyline towers, the 1,228 generator castle-tower pieces (tower_census.py) still read
grey-white against BOARD_2's cream / blush / lavender towers. Their bodies share three material instances.

Tune (reversible; `record.json` holds the prior values for `tune_material_instances.py REVERT=True`):

| MI | before | after |
|---|---|---|
| MI_V2_AshlarMarblePale | see record | BaseColor (1.00, 0.90, 0.72) |
| MI_V2_AshlarIvoryStone | see record | BaseColor (1.00, 0.80, 0.80) |
| MI_V2_AshlarCeramic | see record | BaseColor (0.98, 0.90, 1.08), Roughness 0.50 (was 0.22: glossy white) |

SM_tower_capped on the shared MI_V2_IvoryStone was left alone.

Judgement (same editor session, sc03B vs sc03A, 12 cameras): a modest warm shift on the tower bodies and on the
halls/facade panels that share the stone (cream on FillNE48 / FillW52, blush in the narrow SW street); no regression at
the hero, clock plaza or street cameras. Kept and saved (saved.json).
