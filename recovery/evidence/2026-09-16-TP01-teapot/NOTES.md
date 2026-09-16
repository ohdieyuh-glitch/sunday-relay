# TP01 -- the Tea Terraces' teapot becomes porcelain (2026-09-16)

Gap: TeapotCam24's landmark, LMTeaTerraces_Teapot (SM_teapot_pavilion, 20 m, yaw -65, scale 0.42), read as white
plaster. TEA01 (glossy MI_V2_Ceramic) was rejected: gloss exposed its facets and tinted the hero clock's enamel.

Asset: forge WL_Object_TeapotPavilion (wonderland-blender-forge 5d668f30) -- smooth 64-segment enamel body and lid,
swept spout and handle, gold foot / belly band / rims / knob, 10 rose medallions with leaves (rose placement along the
body's own normal), six lit portholes. 11,522 tris, 18.4 m. Validate 0 failures; audit_glass 83%.
Forge previews: teapot_forge_0.png, teapot_forge_70.png (the first render showed half-sunk portholes and pinhead
roses; both fixed before import). Imported: import.json (5 parts, 0 failed).

Placement (tp01_teapot_pavilion.py): the generator teapot sunk 60 m below the datum by a recorded actor trim
(tp01_teapot_trim.json, trim_result.json: 1 changed, 0 refused; REVERT restores); the new teapot as five
StaticMeshActors at the same position, scale 0.88 (16.2 m) so the five rose cones 7.86 m out stay clear, yaw 24 so
the portholed front faces TeapotCam24 and spout and handle make the silhouette.

Judgement (tp01_ab.jpg, TeapotCam24 + front / side / far poses): clearly better at every camera -- a Bible teapot
instead of a plaster jug. Kept. Saved: umap 12:43:03 (saved.json: 5 TP01 actors).
