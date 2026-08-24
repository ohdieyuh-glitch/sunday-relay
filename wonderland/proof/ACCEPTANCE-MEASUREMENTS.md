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
