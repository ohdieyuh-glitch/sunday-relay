# GL01 -- the windows become smooth glass instead of pebbled plates (2026-09-17)

Material-realism phase, glass. The city's dark window glass -- MI_V2_WindowDark (12,187 generator panes, WIN01) and
MI_V2_WindowArch (FD02's 1,028 arched windows) -- sat on M_V2_Surface, which has no NormalStrength: the fine noise
normal glittered like a starry sky under low roughness, and close up the arched glass read as a pebbled rock plate.

Tool: reparent_mi.py -- moves an instance to a parent that exposes the needed parameter (M_V2_SurfaceHD), keeping every
value and map it had, with a FULL before snapshot (record.json: parent, scalars, vectors, textures) for REVERT.

Variants in one session at 7 identical cameras (gl01_ab.jpg: arched window close-up, pane close-up, clock plaza,
FillNE48, FillEE54), reverted after capture:
| gl0 | before | pebbled, glittering |
| gl1 | HD master, NormalStrength 0, roughness 0.08, per-pane tone/roughness variation | smooth, but pale slate-blue flat rectangles |
| gl2 | as gl1, roughness 0.14, darker base 0.07/0.10/0.15, faint warm interior emissive 25, more per-pane variation | KEPT: dark glass with depth that catches light, set in its surround |

Applied gl2 and saved (applied_gl2.json). Performance: the HD master adds per-instance/macro sampling on these instances.
