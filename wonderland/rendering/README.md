# wonderland/rendering

Rendering quality for Wonderland, built so a setting cannot *appear* to be
applied when it is not.

| File | What it is |
| --- | --- |
| `VERIFIED.md` | what UE 5.8 actually has, what was rejected and why, what must be probed |
| `profiles.json` | PERFORMANCE / BALANCED / CINEMATIC — every entry carries its source |
| `render-profile.py` | resolves a profile into launch arguments, and **refuses** unverified ones |
| `probe-cvars.sh` | asks the real engine which console variables it has |
| `collect-cvar-names.py` | the one list the probe and the gate both read |
| `parse-cvar-probe.py` | turns a probe log into present / absent / **silent** |
| `bench.sh` | before/after evidence per deterministic hero camera |
| `measure.cjs` | measures the stream the founder receives, from a real Chrome |
| `bench-row.py` | folds one camera's measurements into the report |
| `compare.py` | before/after side by side — no image-match score, ever |
| `audit-draw-cost.py` | what the world costs to draw, measured with no GPU |
| `rendering.test.sh` | 41 offline gates; no GPU, seconds |

## Order of operations on the box

```bash
bash wonderland/rendering/probe-cvars.sh
bash wonderland/rendering/bench.sh --label before --profile BALANCED
bash wonderland/rendering/bench.sh --label after  --profile CINEMATIC
python3 wonderland/rendering/compare.py before after
```

And once, to see whether the engine is already batching the world's draws:

```
r.MeshDrawCommands.LogDynamicInstancingStats 1
```

`WL_RENDER_PROFILE=CINEMATIC bash wonderland/infra/lightning/run-stream.sh`
launches the stream under a profile by hand. `WL_EXEC_CMDS=...` bypasses the
profile for a one-off experiment; `WL_HERO_CAM=N` pins the deterministic camera.

## Why the gate exists

Unreal does not fail on an unknown console variable, and it does not fail on an
unknown command-line switch. This project has already lost a session to the
second: the packaged build was launched with `-PixelStreamingURL` and contained
no Pixel Streaming runtime, and nothing said so.

A rendering profile is the easiest possible version of that mistake — the
stream comes up, the settings do nothing, and the note written afterwards says
"TSR did not help". So `render-profile.py --strict` refuses to emit a name the
engine has been asked about and does not have, and `bench.sh` runs the probe
before it will measure anything.

Found while wiring this up: the Lightning launcher carried a comment saying the
AutoExposure bias is the only exposure control that reaches the packaged render
and is read from the LOOK table — and passed no `-ExecCmds` at all. Every frame
streamed from Lightning has been rendered at the engine's default exposure.
`rendering.test.sh` now greps the launcher for it, because the class of bug is
"a comment claims a setting is applied and the command line does not carry it".
