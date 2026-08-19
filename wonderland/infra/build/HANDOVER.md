# Wonderland art sprint — state at handover

**Branch** `relay/wonderland-ca-fixes`, pushed to `origin`. Not merged, no PR
opened. Nothing here has been merged or deployed.

## The one thing that is not done

There is **no rendered frame of the last fifteen passes.** The last real
streamed capture is `p23`, taken before the California host stopped. Everything
after it is verified by execution, by projection and by a CPU trace — never by
Unreal.

Two independent blockers, both outside this checkout:

1. **The host is stopped.** Vast.ai instance `48078961` reached its scheduled
   `end_date` at 2026-08-19 17:19:40 UTC after 12.7 h. Not a crash; the 350 GB
   disk is intact — UE 5.8.1, the packaged build, the generated textures and
   audio, and everything under `/opt/wonderland`. Its `onstart` is
   `touch /root/.booted; export DEBIAN_FRONTEND=noninteractive`, so a restart
   brings up the SSH daemon and **nothing else** — no TURN, no signalling, no
   streamer, no tunnel. Presetting a better `onstart` is not safe: the only API
   routes are `update`/`recycle`, which recreate the instance and would destroy
   that disk.

2. **The authoring machine cannot reach it.** Measured against a host that
   listens on every port, the outbound allowlist is exactly **80, 443, 8080,
   53**. Vast's proxy port (38960) and the instance's direct SSH (1743) are both
   blocked, and vast's SSH host answers on none of the allowed ports.
   `vastai execute` is refused on running instances; `vastai copy` is SSH
   transport. There is no route, running or stopped.

Diagnose these in the right order — for two hours the box was up and serving
while every SSH attempt failed, and that reads exactly like a dead host. Check
`ssh -p 22 git@github.com` first.

## To finish it

```
vastai start instance 48078961
wonderland/infra/build/resume-california.sh
```

from any machine with an SSH route. The script restarts the stack in the order
the media path needs (TURN, signalling, streamer, tunnel), syncs the three
generators, clears the cached texture PNGs and their imported uassets so new
maps are not silently reused, forces the rebuild past an input hash that does
not cover `infra/build`, captures the hero frame and prints the new URL. **The
Cloudflare quick-tunnel URL is regenerated on every restart**, so any previously
shared link is dead.

The first build logs a `WORLD REPORT` at warning level saying whether the
texture inputs wired, whether the masked foliage master built, how many
materials exist and where the frame opens onto the ground. Read that before
reading the capture — `LogPython` *Display* is filtered out of the packaged
build log, which is why everything this pipeline logs at Display has been
invisible after the fact.

## Verifying without a GPU

Three harnesses, all path-independent, all runnable from this directory:

| | |
|---|---|
| `verify-generator-dryrun.py` | runs the whole generator against a stubbed `unreal`; counts actors, surfaces every warning. Catches NameErrors and deleted code before a build does. |
| `verify-hero-composition.py` | projects every actor's oriented bounding box through `cam_arrival_hero`, ray-casts the ground planes, rasterises a PNG. `--find=<label>` reports a landmark's on-screen box as a percentage of frame. `--budget` tallies actors by group. |
| `verify-hero-lighting.py` | CPU ray trace with soft shadows, ambient occlusion, the world's own textures and the rim term. Bounds the value structure. |

None is a render: no Lumen, no VSM, no specular, no PBR, no TSR, no post grade.
They answer composition and value structure. **The streamed California frame is
the only thing that answers how it looks**, and no substitute here should be
shown to anyone as if it were one.

## Two things that will bite the next person

- **`cam_arrival_hero` has `auto_activate_for_player = PLAYER0`.** It hijacks
  the pawn view, so every C++ spring-arm change is correct and invisible while
  it exists.
- **The frame does not open onto the ground until `eye_z / tan(half_fov_v +
  pitch)` away** — currently ~1,067 uu. Anything staged nearer is not small, it
  is off the bottom edge. This silently deleted foreground work twice in one
  sprint before `_hero_ground_band()` started deriving it.

## Three regressions the audit caught, and the shape they share

None of these was caught by a test, because the generator runs, the actor
count is right, and neither offline harness models bloom:

| rebuilt | count went | radiance left at |
|---|---|---|
| clouds | 28 -> 44 clusters | raised 2.6 -> 3.6 as well |
| arcane spill | 0 -> 78 crack strips | the circle's own 11.0 |
| Project Brain | 5 -> 72 lobes | 2.2 on every one |

The exposure is histogram auto-exposure: it meters against the brightest large
area and darkens everything else to compensate. So the symptom is never "the
sky is too bright", it is **"the foreground went to mud"** — which sends you
into materials and lighting while the cause is overhead. That hunt already
cost this sprint a full pass once.

If you rebuild something emissive with more pieces, divide the per-piece
radiance or give it a falloff. Audit with: list every entry in
`MATERIAL_SPEC` by `max(emissive) * strength`, flag anything over ~2, and grep
where those are used.

## Not resolved here

The UE 5.8 `.uproject`, `Config/` and most of the C++ are **staged but
uncommitted** in a different worktree on `relay/wonderland-foundation`. Both
halves are needed to build. That is another session's working tree and this
sprint did not commit it.
