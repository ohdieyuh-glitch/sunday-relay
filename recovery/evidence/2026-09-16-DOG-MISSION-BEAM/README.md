# The verification beam: five wrong diagnoses and the two faults (2026-09-16)

The Dog's VERIFYING beam was geometrically perfect from the first build -- 18 of 18 samples lit, maximum endpoint
miss 0.0 uu -- and could not be seen. It took five wrong explanations to find two real faults.

| diagnosed as | actually |
|---|---|
| too thin | widening it changed nothing |
| wrong camera | four re-aims changed nothing |
| the Jhinn occluding the sight-line | real, but never why it was invisible |
| a rendering artifact (a black slab in frame) | **that slab WAS the beam** |
| below the exposure threshold only at low weight | true, and still not the whole of it |

## Fault one: magnitude

`LevelColorationUnlitMaterial` emits exactly the colour set on it, and Wonderland runs physically-based daylight
exposure, so a colour near 1.0 renders BLACK -- not dim, black. Readable starts near x3000 (measured on the
companions, 2026-09-15). The first fix multiplied by x4000 but put the weight INSIDE the multiplier, so the
effective figure ran x1400-x3600 and the beam only crossed into readable above three-quarters weight. Weight must
modulate a beam that is always emitting, not decide whether it emits.

## Fault two: an opaque sheath hides what is inside it

The design was a bright core inside a wider dim halo. Both are opaque, so the core was never once on screen and
every adjustment to it changed nothing at all. Layering reads only with translucency, and there is none here.

The beam is now ONE cylinder -- 17 uu over a 420 uu run, set hard past the threshold so it tonemaps toward white.
`beam3.jpg` is the result: a slim near-white shaft from the Dog's chest landing on the crystal.

## A third thing the sweep found

The first sweep caught the beam in one frame of five, which looked like an intermittent beam. It was an
intermittent BEAT: the fixture kept stepping underneath a 1.2 s gap between `wl.Mission.Beat verifying` and the
shutter. `beam_sweep.py` now stops the fixture before holding the beat. An instrument that does not hold its
subject still measures something else.

`beam1.jpg` the cube slab, `beam2.jpg` core-inside-halo (still a plank), `beam3.jpg` the single cylinder.
