# Wonderland visual authority

**Current visual authority (founder ruling, 2026-09-13): the GPT Wonderland Bible reference boards.**
Every visual pass is judged as CURRENT WONDERLAND vs. THE BIBLE BOARDS. Do not tune the world toward
the Marble image, do not treat its composition as canon, do not use it as a grading target, and do not
reject an improvement because it moves away from Marble.

## The boards

Filed in the repository by commit `18ea1b37` (path `wonderland/v2/reference/boards/`; a working copy is in
the forge worktree at `C:/dev/iwonder/wonderland-blender-forge/wonderland/v2/reference/boards/`):

| board | title |
|---|---|
| `BOARD_1_golden-arrival-overall-world-reference.png` | Wonderland V2 - Golden Arrival District, Overall World Reference |
| `BOARD_2_visual-world-reference-mood-style-material-landmarks-scale.png` | Visual World Reference: mood, style, material language, landmarks, scale |
| `BOARD_3_visual-reference-bible.png` | Wonderland V2 Visual Reference Bible |
| `BOARD_4_world-building-reference-bible-2026-08-30.png` | World Building Reference Bible |
| `BOARD_5_visual-world-reference-complete-2026-08-30.png` | Visual World Reference, Complete Style & Asset Guide |
| `BOARD_6_complete-world-reference-2026-08-30.png` | Complete World Reference |

(`BOARD_7` and `BOARD_8` are Live Terminal references, not world references.)

That commit's message said "primary authority stays the panorama". **That is superseded.** Some boards still
carry the caption "canonical Marble royal-garden reference"; the caption records where the district's first
composition came from, not what the world is judged against.

## The Marble image, now

`wonderland/v2/reference/marble-royal-garden-*` and the in-map `V2_MarbleWorld_Scaffold` /
`HeroCam_V2_MarbleReference` stay as HISTORICAL SOURCE MATERIAL: provenance for the recovered layout, a
camera pose that is useful to reuse, and a record of earlier passes (GA01-GA05, LOOK01, MAT01-MAT02 were
judged against it). Inspect them when useful. Never optimise toward them.

## What the Bible shows (read off the six boards)

- **Hero composition.** A paved path straight ahead between dense flower beds (purple and pink dominant);
  an ornate gold gate on one side, a heart-shaped topiary arch on the other; giant mushrooms framing the
  path; urns on pedestals with gold spheres; a large gold pocket clock; the city rising behind the garden.
- **Skyline.** Enormous and dense: hundreds of slender ivory towers and turrets under tall pink, lavender
  and pale-blue cone roofs, domes and gold finials, layered through many depth planes to the horizon;
  mushroom-capped towers among them.
- **Sky.** Bright blue with white cumulus; floating islands carrying small castles; hot-air balloons;
  floating keys, teacups and clocks.
- **Architecture.** Ivory / pale stone with soft pink stone, arched windows, balconies, gold ornament,
  pink roof cones; storybook, layered, ornate.
- **Mushrooms.** Giant landmarks with pale stems and dusty-rose, pink or lavender caps with cream spots
  (a red-with-white-spots cap appears as one variant); mushroom houses with windows.
- **Gardens.** Intentional, full, formal: clipped topiary (spirals, cones, balls, hearts), hedges, flower
  beds with gold-edged planters, roses, lavender, blossom trees; never random scatter.
- **Wonderland objects.** Clocks and timepieces, keys, teapots and tea sets, top hats, books, signs.
- **Palette.** Pale stone, warm ivory, soft pink, muted rose, lavender, deep purple accents, sage and
  topiary green, gold, brass, aged bronze, sky blue, cloud white, mushroom red.
- **Light.** Bright fantasy daylight is primary (golden hour and lantern-lit night are variations).
- **Distance strategy.** 0-50 m authored hero detail; 50-200 m modular, controlled population; 200 m+
  distant skyline.
- **Rejected (BOARD_3 "Do not do this").** Gray box / blockout, overly gritty / realistic, cyber / neon /
  futuristic, dark / gothic / grim, low detail / mobile look, bland / empty / no life.

## The questions every pass answers against the boards

- Is it as dense as the Bible?
- Is the architecture as layered?
- Are the gardens as intentional and full?
- Is there enough pink / ivory / gold language?
- Are there clocks, mushrooms, gates and Wonderland landmarks?
- Is there strong foreground / midground / background depth?
- Does the skyline feel enormous?
- Does the world look authored rather than procedurally scattered?
- Does it feel magical, royal and alive?

## Practice

- Put the relevant board panel beside the capture in every before/after sheet
  (`wonderland/Tools/contact-sheet.ps1`), and name the board and panel in the pass's docstring.
- Existing camera poses (including `HeroCam_V2_MarbleReference`) remain useful viewpoints; the comparison
  target for any of them is the Bible.
