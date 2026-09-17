# GD01 -- gold that reads as gold (2026-09-17)

Material-realism phase. In the roof survey the gold balustrade bands and balusters read as flat yellow-olive plastic.
MI_V2_Gold (BaseColor 1.28/0.97/0.50 -- above 1 and lemon-leaning, Roughness 0.55, RoughVary 0.3, Metallic 0.9) and
MI_V2_GoldAged (0.83/0.64/0.26, Roughness 0.66) were tuned rough in MQ06 because polished gold mirrored the shade as
brown-black; the result lost its metal read.

Variants in one session at 8 identical cameras (gd01_ab.jpg: baluster close-up, clock plaza finials, the hero pocket
clock, a city balustrade band, the hero camera; before gd0), reverted after capture:
| gd1 | Gold 1.00/0.74/0.32, rough 0.38, vary 0.5, metallic 0.95; Aged 0.86/0.63/0.28, rough 0.48 | KEPT: warm true gold with highlights on the curves; the pocket clock case reads as gold, balusters as metal |
| gd2 | Gold 1.05/0.76/0.34, rough 0.30, vary 0.45, metallic 1.0; Aged 0.90/0.66/0.30, rough 0.40 | darker and muddier in shade (the MQ06 problem returns) |

Applied gd1 and saved (applied_g1.json). Reversible: tune_material_instances.py REVERT=True with record.json.
Performance: parameters only.
