# Reference analysis — the Marble panorama as a reconstruction target

Measured on the original 4608 × 2304 equirectangular file (viewed at 1600 × 800;
pixel positions scaled, precision ±1° azimuth, ±0.5° elevation). Azimuth is
clockwise from straight ahead (+Y); positive azimuth is the viewer's RIGHT,
which in the Unreal frame (camera looking +Y) is **−X**. Elevation is from the
horizon (v = 0.5). Ground distance of a feature whose ground contact is
visible = eye height / tan(depression), with eye height **2.62 m**.

## The seam finding

The gold gate at the far-left edge and the gold gate at the far-right edge
are the **same gate**: an equirectangular image wraps at u = 0 / u = 1, which
is the direction directly BEHIND the viewer. Measured: left-edge pillar at
u = 0.034 (az −168°), right-edge pillar at u = 0.963 (az +167°); both bases at
v = 0.588 (depression 15.8°) → 9.3 m. Total span across the seam ≈ 115 px of
1600 = 26° at 9.3 m = **one gate 4.2 m wide, 9.3 m behind the viewpoint**,
with a pillar each side (~0.6 m wide, ~9 m tall) and a leaf each side.
The viewer stands inside the plaza having entered through it.

Consequence for the hero camera: a forward-looking perspective camera at the
viewpoint cannot contain the gate. Two cameras are therefore built (below).

## Measured features (from the viewpoint V = origin)

| feature | u | az | contact v | depression | dist | world (x, y) cm | notes |
|---|---|---|---|---|---|---|---|
| gate (one, behind) | 0.034 / 0.963 | ±168° | 0.588 | 15.8° | 9.3 m | (0, −910) | pillars at x ≈ ±210; leaves ~1.4 m each; pillar top v 0.306 → 6.5 m above eye → ~9 m tall |
| urn planters at gate feet | 0.081 / 0.900 | −151° / +144° | 0.588 | 15.8° | 9.3 m | (±330, −880) | pale ceramic, ~0.8 m |
| LEFT rose-topiary cone | 0.241 | −93° | 0.594 | 16.9° | 8.6 m | (+860, −45) | 3.8 m wide, 5.7 m tall (top v 0.388, +20°); on a raised bed behind a 0.85 m wall |
| RIGHT rose-topiary cone | 0.763 | +72° | 0.600 | 18.0° | 8.1 m | (−770, 250) | 5.9 m tall; same bed/wall language |
| side retaining walls | — | ±80…−121° | 0.561 (top) | 10.8° | 9.3 m | x ≈ ±800 | wall top 0.85 m above ground; raised beds with hedges/roses behind |
| central path (dark stone) | 0.500 | 0° | 0.588 (near edge) | 15.8° | from 9 m | (0, 900 →) | width 120 px = 27° at 9.3 m → **4.4 m**, narrowing with distance |
| steps across the path | 0.500 | 0° | 0.556 | 10.1° | 14.7 m | (0, 1470) | 3 low steps; the garden rises beyond (features' bases sit above the horizon) |
| GIANT mushroom | 0.325 (cap 0.25–0.40) | −63° (cap −90…−36°) | base hidden (v 0.49) | — | ~22 m (from cap geometry) | (+1960, 1000) | cap 54° wide → **~20 m across**; underside el +22° → ~11 m up; top el +51°; clock on the stem at el +21°; ivy on the cap |
| clock tree (right) | 0.669 (flat) / **+45° in the cam0 reprojection** | +47° (corrected) | 0.525 | 4.5° | ~28 m | (−2050, 1900) | ~16 m tall, foliage fills the top-right of the 100° view; clock on the trunk at el +9°. The flat-panorama reading (+61°) was wrong by 14° — measure landmarks on the REPROJECTED view for the camera being built |
| heart topiary | 0.563 | +22° | base above horizon (v 0.469) | — | ~35 m, on a terrace ~3 m up | (−1300, 3250) | ~5 m wide |
| white tower, dark-blue cap (left) | 0.225 | −99° | hidden | — | ~55–65 m | (+5000, 3300) | ~14 m; windows; dark navy conical cap |
| white towers, blue caps (right) | 0.765 / 0.787 | +72° / +80° | hidden | — | ~55–70 m | (−4200, 4200), (−5200, 5400) | two, different heights |
| path's far gateway / arch | 0.500 | 0° | 0.525 | 4.5° | ~33–45 m | (0, 4500) | stone arch at the end of the garden corridor |
| castle city | 0.30–0.80 | −70…+110° | horizon band v 0.375–0.50 | el 0…22° | 90–170 m (Marble p90 118 m, max 169 m) | y 9,000–17,000 | cream masonry, muted pink + some dark caps, gold finials; recedes into haze |
| sun | 0.720 | +79° | v 0.175 | el **+58°** | — | — | high, right-front; warm-white late-morning daylight |
| horizon | — | — | v 0.500 | 0° | — | — | camera is LEVEL |

## Second-pass reading of the cam0 reprojection (the founder's guide view)

* The central path is PALE grey-blue stone, a step cooler than the plaza — not a dark road.
* The plaza is SUNKEN: three low steps rise to the side terraces along both edges; the
  beds, walls and rose cones stand on those terraces (+0.6 m).
* Cream stone pedestals with GOLD ball finials stand at the path's mouth (±2.9 m, +7 m).
* A second ornate GOLD GATE stands at the left garden entrance (az −25°, ~18 m).
* The giant mushroom's stem rises from a round two-tier STONE BASE; a small red mushroom
  stands on a pedestal at the left terrace edge.
* Floating: two gold keys, a teapot AND a teacup, high over the garden.

## What the image says about restraint

Foreground: large pale slabs in a loose cream/grey checker, wide seams,
a few petals — **no props on the plaza**. Density lives in ORGANISED bands
(walls → beds → hedges → topiary → trees) either side of an open corridor.
The sky is bright blue with large soft clouds; the light is warm white, not
golden-hour; shadows are soft and readable; nothing glows.

## The two V2 cameras

- **HeroCam_V2_MarbleReference** (HeroCam0, the capture default): AT the
  viewpoint (0, 0, 262), level (pitch 0), **100° horizontal FOV** — the
  widest field a hero shot can carry without fisheye — so the rose cones at
  ±47° from a point 1.5 m behind V, the giant mushroom at −49°, the clock
  tree at +45°, the heart at +22°, steps, path, towers and city all sit
  where the panorama puts them. The gate is behind this camera, as it is
  behind the panorama's viewpoint.
- **HeroCam_V2_GateView** (HeroCam1): 5.5 m behind the gate, looking through
  its open leaves at the plaza and garden — the shot that reproduces the
  flattened panorama's "gate at both edges" framing with a physically
  coherent world.

The founder picks. Neither bends the world to match panorama distortion.
