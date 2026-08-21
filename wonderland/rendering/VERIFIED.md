# UE 5.8 rendering: what was verified, what was rejected, what must be probed

Every row below was checked against Epic's **5.8** documentation on 2026-08-21.
Nothing here is from memory. Where a source could not be found the row says so
rather than guessing, because the consumer of this file writes these names into
an engine configuration and **Unreal ignores a console variable it does not
recognise without failing** — an unverified setting is not a risk, it is a
silent no-op that later gets quoted as a result.

The definitive check is not this document. It is `probe-cvars.sh`, which asks
the engine that will actually run Wonderland and writes `engine-cvars.5.8.json`.
`render-profile.py --strict` then refuses to emit anything that probe says the
engine lacks. **Until that file exists, treat every row as documentation only.**

---

## 1. Verified — exists in UE 5.8

### Anti-aliasing and upscaling

| Setting | Value used | Evidence |
| --- | --- | --- |
| `r.AntiAliasingMethod` | `4` (TSR) | 0 off, 1 FXAA, 2 TAA, 3 MSAA (desktop forward only), **4 TSR — the UE5 default**. [Anti-Aliasing and Upscaling](https://dev.epicgames.com/documentation/unreal-engine/anti-aliasing-and-upscaling-in-unreal-engine) |
| `r.ScreenPercentage` | 67 / 100 / 150 by tier | Below 100 TSR upscales; above 100 it supersamples. Epic: "extreme upscaling with any screen percentage lower than 50% should only be considered when targeting displays greater than 4K". |
| `r.TSR.History.ScreenPercentage` | 100 / 200 | "Only values between 100 and 200 are supported"; higher "reduce reprojection blur but increase GPU cost". Default 200 at Epic/Cinematic. [TSR](https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-in-unreal-engine) |
| `r.TSR.History.SampleCount` | 8 / 16 / 32 | Default 16, documented range 8–32. |
| `r.TSR.ShadingRejection.SampleCount` | 2.0 | "Lower = clearer but less stable; higher = more stable but blurrier." |
| `r.TSR.Velocity.WeightClampingSampleCount` | **2.0** | Default 4.0 gives "higher stability on movement but at the expense of additional blur". 2.0 is Epic's own sharper setting. **This is the documented answer to "minimal temporal blur in motion".** |
| `r.TSR.ShadingRejection.Flickering` | 1 | Detects luminance oscillation, "prevents moire patterns and detail instability". On at High/Epic/Cinematic. Wonderland's checkered flagstone is exactly the content that moires. |
| `r.TSR.RejectionAntiAliasingQuality` | 2 | Spatial AA where temporal history is rejected. Enabled except on Low. |
| `r.TSR.Resurrection` | 1 | Recovers detail from older frames. On at Medium and above. |
| `r.TSR.History.R11G11B10` | 0 in CINEMATIC | Default 1 on High+; reduces history bit depth to save bandwidth. Full precision keeps gradients clean when the GPU can afford it. |

### Pixel Streaming — command-line switches ([5.8 reference](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-pixel-streaming-reference), [Stream Tuning Guide](https://dev.epicgames.com/documentation/unreal-engine/stream-tuning-guide))

| Switch | Engine default | Used | Why |
| --- | --- | --- | --- |
| `-PixelStreamingEncoderMinQuality` | **-1 (no floor)** | **60** | 0–100, "higher values result in better quality". Epic: "MinQuality of 60 is acceptable for most users that want to put an upper bound on how much compression they are willing to accept." With the default there is no floor at all — when bandwidth estimation dips the encoder is free to go as soft as it likes. |
| `-PixelStreamingEncoderMaxQuality` | -1 | 100 | Lets the encoder use headroom when it exists. |
| `-PixelStreamingH264Profile` | **`BASELINE`** | **`HIGH`** | Supported: AUTO, BASELINE, MAIN, HIGH. Baseline is the weakest H.264 profile — no CABAC, no 8×8 transform — so it spends more bits for the same picture. The stream has been running on it. |
| `-PixelStreamingWebRTCDegradationPreference` | `MAINTAIN_FRAMERATE` | `MAINTAIN_RESOLUTION` | The default sacrifices *quality and resolution* to hold framerate. For a world the founder is judging on ornament and material detail, that is the wrong trade. |
| `-PixelStreamingWebRTCStartBitrate` / `MaxBitrate` | 10 Mb/s / 100 Mb/s | 10 / 20 Mb/s | Epic's quality-focused 1080p example uses a 10 Mb/s ceiling; 720p needs less. |
| `-PixelStreamingWebRTCMaxFps` | 60 | 60 | Matches the 60 FPS preference. |
| `-PixelStreamingEncoderCodec` | `H264` | `H264` | Already set. AV1/VP9 compress better but the founder's Chrome must decode it, and H264 is what the capture path is proven against. |

**Codec QP ranges** (for reading the Quality number): H264 0–51, AV1 0–255, VP8/VP9 0–63. Quality 60 ≈ QP 20 on H264. The Quality↔bitrate relationship is logarithmic.

### Instancing — the engine is probably already doing it

| Setting | Default | Evidence |
| --- | --- | --- |
| `r.MeshDrawCommands.DynamicInstancing` | **1** | UE5 combines compatible visible mesh draw commands into one instanced draw automatically. Compatible means the same static mesh (index/vertex buffers) and the same material bindings — which is exactly what Wonderland is built from. [Mesh Drawing Pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/mesh-drawing-pipeline-in-unreal-engine) |
| `r.MeshDrawCommands.LogDynamicInstancingStats 1` | — | Logs how efficiently the level is actually instancing. One command, one line of log, settles it. |

This matters because `audit-draw-cost.py` measures 33,028 components resolving
to only **116** distinct (mesh, material) pairs, none of which appears just
once. Read naively that says "285× draw-call reduction available" and implies a
geometry rewrite. It almost certainly says nothing of the kind: the engine
collapses those by default, and 116 is a **ceiling to compare the engine
against**, not a task. Run the log command and compare. If the numbers are
close the draw calls are already solved and the remaining cost is per-primitive
visibility and GPU Scene work — which is what HISM reduces, and a different job
from draw-call batching.

---

## 2. Rejected

| Suggested | Verdict | Why |
| --- | --- | --- |
| `r.TemporalAACurrentFrameWeight` | **Rejected** | Legacy TAA/TAAU only. Epic's 5.8 anti-aliasing page documents the `r.TemporalAA.*` family as applying to TAAU, and states TSR is a *separate* upscaler with its own `r.TSR.*` variables. Wonderland renders with TSR (`r.AntiAliasingMethod=4`, the UE5 default), so this would change nothing while appearing to be a knob that was tried. |
| `r.TemporalAASamples` | **Rejected** | Same. Under TSR the equivalent levers are `r.TSR.History.SampleCount` and `r.TSR.ShadingRejection.SampleCount`, both of which are in the profiles. |
| `r.PostProcessAAQuality` | Rejected | Legacy AA quality tiers. Under TSR the scalability group is `sg.AntiAliasingQuality`, which drives the TSR shader permutations. |
| PostProcessVolume / camera sharpening and grade | **Rejected — proven inert here** | In this project's packaged `-RenderOffscreen` Pixel Streaming build both the PostProcessVolume grade and the camera-component PostProcessSettings are silently ignored: a 40% `ColorGain` change was invisible with zero override errors. Only launch console variables reach this render. |
| Native 4K for the current tests | Rejected — per the founder's own instruction | The stream stays 1280×720 while quality is tuned. `CINEMATIC` supersamples *internally* instead, which raises image quality at the same output size. |

---

## 3. Uncertain — must be probed before use

These are named in `profiles.json` under `candidates` and are **not** in any
profile. Each is plausible and none is confirmed against 5.8 documentation:

`r.Tonemapper.Sharpen` (the founder's 0.2–0.3 sharpening target — the 5.8
anti-aliasing page documents **no** sharpening variable at all, so whether this
still exists and whether TSR has its own is a probe question) ·
`r.MotionBlurQuality`, `r.DefaultFeature.MotionBlur` · `r.Streaming.PoolSize` ·
`r.ViewDistanceScale` · `r.Shadow.Virtual.*` · `r.DynamicGlobalIlluminationMethod`,
`r.ReflectionMethod`, Lumen variables · `r.MegaLights.Enable` · `r.Nanite*` ·
`r.DynamicRes.*` · the `sg.*` scalability groups · and the **PixelStreaming2 CVar
prefix**: the 5.8 reference documents `PixelStreaming.Encoder.*`, while this
project loads the `PixelStreaming2` plugin. The profiles therefore use the
documented **command-line switches**, which are stable, and the probe will settle
which CVar prefix this build registers.

---

## 4. The single biggest lever on perceived sharpness here

**The encoder, not the renderer.** Wonderland is delivered as a 1280×720 H.264
video. Three of its encoder defaults are working against the founder's ask at
once:

1. `MinQuality = -1` — no quality floor, so compression is unbounded.
2. `H264Profile = BASELINE` — the weakest profile, more bits for the same image.
3. `DegradationPreference = MAINTAIN_FRAMERATE` — under pressure the stream
   gives up *picture* first.

No amount of TSR tuning survives that path. This is also consistent with the
measurement already on record for the previous host, where video was throttled
to roughly 1.1 Mb/s by network distance while the GPU sat at 82% with headroom
to spare: the bottleneck was never the renderer.

TSR settings are still worth having — they are what makes the *source* image
crisp, and a sharper source compresses better. The order of operations is
encoder first, renderer second, and both are in `BALANCED`.

---

## 5. What must be measured before any of this is believed

Run on the L4, in this order:

```bash
bash wonderland/rendering/probe-cvars.sh                     # which CVars exist
bash wonderland/rendering/bench.sh --label before --profile BALANCED
# apply, rebuild if needed, then:
bash wonderland/rendering/bench.sh --label after  --profile BALANCED
bash wonderland/rendering/bench.sh --label cinematic --profile CINEMATIC
```

`bench.sh` refuses to run against an unprobed engine, pins each shot to a
deterministic hero camera, and records FPS, frame delivery, bitrate, resolution,
freezes, GPU utilisation and VRAM per camera per profile.

Two questions the bench must answer before `CINEMATIC` is recommended for
anything: does `r.ScreenPercentage 150` actually look better at 720p output, and
what does it cost in frames. Supersampling is the most likely large visual win
and also the most likely way to fall under 30 FPS. **Higher is not automatically
better and this is not a rhetorical caution — it is the measurement.**
