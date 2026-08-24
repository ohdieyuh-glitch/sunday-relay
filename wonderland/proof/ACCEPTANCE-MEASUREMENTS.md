# Wonderland acceptance measurements

Base `a203547` → head `b135de3`. Every number here was measured, and the ones
that did NOT improve are recorded beside the ones that did.

## The defect that made all earlier visual judgements unreliable

`bUsedWithInstancedStaticMeshes` was never declared on the master material.
Unreal substitutes the DEFAULT GREY at draw time for a material used on
instanced static meshes without it, while every binding check still reports
success. Wonderland draws 137,816 of its pieces as instances, so 38 materials —
the whole visible world — were replaced by engine grey in every packaged build.

    engine "missing usage flag" warnings    38  ->  0

It is invisible in the editor, which adds missing usage flags on demand. It is
real only in a cooked build. Every visual decision taken before this fix was
taken through a renderer that was not drawing the palette.

## Colour

    delivered / authored saturation      ~18%   ->  103%   (twelve-panel test strip)
    frame chroma per luma                0.093  ->  0.710  (floor 0.26)
    colourless area, saturation < 0.10   43.1%  ->  18.3%

## Black and dead area

    dark pixels,  luma < 0.14             2.8%  ->   1.0%
    black pixels, luma < 0.05             0.0%  ->   0.0%

## Density

Counted by walking each generator against the offline stub, so this is the
world as PLACED and needs no GPU:

    visible pieces placed            34,595  ->  136,149      (3.9x)
    batches                                      150
    instanced pieces at runtime                  137,816

## Sharpness — NOT IMPROVED, and stated as such

    acutance (mean |luma gradient|)      14.279 ->  13.627
    detail density (share on an edge)     22.9% ->   22.3%

Unchanged within noise. The colour fix did not sharpen anything, and nothing
else in this goal did either. The streamed-vs-native comparison was not run.

## Performance

Measured through the real Pixel Streaming path at 1080p H264, three samples
per configuration:

    SM5, no Nanite      15, 13, 12 fps    VRAM 1,600 MiB    GPU 94-99%
    SM6, Nanite ON       5,  7,  8 fps    VRAM 2,673 MiB    GPU 42%
    SM6, Nanite OFF      7,  8,  7 fps    VRAM 2,794 MiB    GPU 64%

SM5 is shipped. SM6 costs half the frame rate on this Vulkan/L4 target whether
or not Nanite uses it, which the VRAM says as clearly as the frame rate.

### What the frame is actually bound by

Each subsystem isolated through the real stream:

    baseline                 15, 16, 11
    Lumen off                15, 13
    virtual shadow maps off  15, 14
    r.ScreenPercentage 70    13, 14      <- HALF the pixels, no change

Halving the pixel work changing nothing is decisive: GEOMETRY-bound, not
pixel-bound. ~50,285 Sphere instances at roughly 1,900 triangles each is on the
order of 95 million triangles a frame at LOD0, because the engine primitives
ship with a single LOD.

Nanite was the obvious lever and was MEASURED AND REJECTED: it is built for
high-poly meshes, and this world is 137,816 instances of 12-to-1,900-triangle
primitives. Unexplored levers: fewer and larger pieces, or authored LODs on
project-owned meshes.

### The 20.5 fps baseline is not comparable

It was measured while 38 materials drew the engine's default — a trivial
shader. The world now draws its real master material. There is no honest
before/after for frame rate in this goal, and 15 fps should not be read as a
regression from 20.5 or as a win over it.

## Two attributions I got wrong, and how they were caught

1. "The palette was authored too pale to survive being lit." Refuted by its own
   rebuild: MI_stone's runtime saturation was raised 0.54 -> 0.71 and the frame
   moved 1.4%.
2. "Nanite halves the frame rate." Wrong — SM6 does. Caught only by a third run
   with Nanite off and SM6 still on, which nearly was not taken because by then
   the answer felt known.

Both changes had been made together and separated only afterwards. One
measurement across two changes attributes to the more interesting one.


---

# Addendum — the two criteria that were open at the first report

## Sharpness: MET, and it costs nothing

Five levers swept on the real build, acutance measured on the delivered frame:

    r.Tonemapper.Sharpen 0      13.665   (base)
    r.Tonemapper.Sharpen 0.5    14.064   +2.9%
    r.Tonemapper.Sharpen 1.0    14.515   +6.2%
    r.ScreenPercentage 125      14.127   +3.4%
    r.MipMapLODBias -1          13.682   +0.1%

Sharpen 1.0 taken; ScreenPercentage refused (56% more pixels for half the gain,
in a world already short of its frame target). MipMapLODBias doing nothing says
the softness is NOT mip selection, so the reflexive "sharpen the textures"
would have been wasted work.

Delivered, whole frame:

    goal-start grey   3c61625    acutance 14.279   detail 22.9%
    colour fixed      b135de3    acutance 13.627   detail 22.3%
    SHARPENED         0ec5098    acutance 14.626   detail 23.6%

Above the goal-start baseline on both metrics. And ISOLATED on the stream, it
is free:

    Sharpen 1.0    11, 10, 10, 8 fps
    Sharpen 0      11, 11,  9, 8 fps

## Frame rate: NOT MET, with the cause narrowed to one thing

Every lever measured. None of them is the answer:

    screen percentage 70 and 125   no change   -> NOT pixel-bound
    Lumen / shadows / SSR / AO     no change
    per-pixel material noise       no change
    Nanite on the primitives       -50%        rejected
    SM6                            -50%        reverted
    reduction LODs + HISM          no change
    r.ForceLOD 2 and 3             no change   -> NOT triangle-bound
    Marble mesh LODs               no change   -> it is a SHELL: screen size
                                                  is always ~1.0, so LOD0 is
                                                  always selected
    Marble texture capped to 4096  VRAM -44 MiB, no FPS change
    MARBLE REMOVED ENTIRELY        +40%        13.3 -> 18.7 fps

So the backdrop costs ~40% of the frame and it is not its geometry, not its
triangle count, and not its texture resolution. What is left is what it IS: a
592,580-triangle shell wrapped around the camera, so every pixel of sky and
every gap between spires draws it. That is OVERDRAW, and no LOD or mip setting
reaches it.

THE FIX, NOT TAKEN HERE: render the panorama as a skybox instead of a mesh
shell. It is a design change to an asset the founder paid 6,660 credits for,
and it belongs to them rather than to a late-night guess.

The ~20.5 fps baseline in the goal remains incomparable: it was measured while
38 materials drew the engine default.
