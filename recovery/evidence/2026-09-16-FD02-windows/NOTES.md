# FD02 -- arched windows on the blank street walls (2026-09-16)

Gap, measured offline from building_census + street_census + pane_census: of 748 street-facing, street-level wall
faces with no other building in front, 430 had no window at all (57%) -- SM_castle_hall 382, median 8 m x 9.2 m, in
every district (South 65, FillNE 57, FillEMC 44, SW 42 ...). At EE54 / EL55 a whole frame was one blank ashlar wall.

Asset: forge WL_Detail_Window_Arched (wonderland-blender-forge bdd2e947): flat-backed clip-on -- surround panel, jambs,
sill, round voussoirs, label moulding with stops, gold keystone, glass in the recess. 376 tris. Validate 118/0,
audit_glass 47%. Imported (window_import.json: 3 parts, 0 failed).

Pass: facade_windows.py -> fd02_<prefix>.json, 20 districts. Castle-hall faces only, no pane on the face, bottom at
street level; a ground row (opening at 0.9 m) and storey rows every 3.7 m while a window fits; columns at 2.9 m.
Skips: 240 over a shop (ground row), 465 raised prop overlapping, 52 another building in front.
Result: 1,028 windows on 403 faces (778 dark glass, 250 warm GlassAmber by position hash); 3,084 instances, culled at
90 m. Cost not measured (376-tri module).

Glass: the first preview (fd02a) used WIN01's MI_V2_WindowDark, whose stretched normals (TexScale 0.0002) read as
blotches across a 1 x 2 m light. FD02 now uses its own MI_V2_WindowArch (a copy), tuned (glass_record.json):
| g0 copy of WindowDark | blotchy |
| g1 rough 0.06, RoughVary 0, TexScale 0.006 | clean slate-blue glass -- chosen |
| g2 rough 0.30, TexScale 0.0002 | blotchy |
| g3 as g2 + faint violet emission | blotchy |

Saved: MI 11:55:16, umap 11:55:23 (saved.json: 78 FD02 batches, 66 FD01).
