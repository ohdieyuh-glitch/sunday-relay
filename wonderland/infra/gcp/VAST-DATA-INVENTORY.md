# What exists only on the Vast machine

Instance **48078961 / wonderland-ca2**, 350 GB disk, currently `exited` (stopped
at its rental `end_date`, disk preserved). Nothing here has been deleted and
nothing should be until every row below is either reproducible or copied.

**How this was compiled, and its limits.** I could not enumerate the disk to
write this: the instance is stopped, and this laptop's outbound ports are
restricted to 80/443/8080/53 so no SSH path exists. Every row marked *observed*
was seen directly during the 2026-08-19 session, when the box was up and I was
working on it. Rows marked *inferred* follow from that but were not listed. **Run
the enumerate command at the bottom before acting on this.**

## Cannot be regenerated from the repository

| what | path | observed? | cost to lose |
|---|---|---|---|
| Built UE 5.8.1 engine | `/home/ue4/UnrealEngine` | observed | **hours.** The container ships a prebuilt engine, but this one has been through a first-build fixup cycle. Rebuilding needs the GHCR pull and a long compile. |
| Wonderland source tree | `/home/ue4/wonderland-src` | observed | **this is the one that matters.** Its `.uproject` is UE **5.8** with PixelStreaming2, Niagara and PythonScriptPlugin enabled. The copy on branch `relay/wonderland-ca-fixes` is UE **5.4** with none of them. The 5.8 uproject, `Config/*.ini` and most of the C++ live *staged but uncommitted* in the `relay/wonderland-foundation` worktree — on no branch, not on `main`. **So the working configuration exists in exactly two places, both of them one accident from gone.** |
| Runtime stack scripts | `/opt/wonderland/ca/{sig,tunnel,app-run,relight,herocap,cycle}.sh` | observed | hours of trial and error. These encode findings that cost real time: launch Wilbur with the BUNDLED node, advertise coturn TURN in the signalling `--peer_options`, run the app as `ue4` not root, force the auto-exposure bias because it does not converge headless. **Not in the repository.** |
| Capture harness | `/opt/wonderland/proof/{shot,prove-stream,input}.cjs` + `node_modules` | observed | the WebRTC proof rig. Encodes that Playwright's bundled Chromium has **no H264** and must run `channel:"chrome"`. **Not in the repository.** |
| Build launcher | `/root/run-build3.sh`, `/root/gen-only.sh` | observed | encodes why the build must start with `env -C "$SRC"` — `find` under `pipefail` cannot restore a mode-700 CWD and kills the build one line after a correct version check. **Not in the repository.** |
| coturn config + secret | `/etc/turnserver.conf` | inferred | contains a generated TURN secret. **Do not copy the secret into the repo**; regenerate it on the new host. |
| Streamed captures p5-p23 | `/opt/wonderland/proof/*.png` | observed | the only rendered evidence of the world's real appearance. `p18` and `p23` are pulled to this laptop; the rest are not. `p18` is also the calibration reference for the offline tracer. |

## Reproducible — no need to copy

| what | path | how |
|---|---|---|
| Generated PBR textures | `/opt/wonderland/textures` | `gen-textures.py`, ~22 s, deterministic from seed `0x57ABEE`. In the repo. |
| Generated audio | `/opt/wonderland/audio` | `gen-audio.py`, deterministic. In the repo. |
| Packaged Wonderland | `/opt/wonderland/packaged` | `build-wonderland.sh`; ~2 min incremental once the engine exists, much longer from cold. |
| The level itself | `Content/Wonderland/**` | `generate-hub-level.py`, ~30 s headless. In the repo. |

## Before decommissioning

1. **Start the instance** and run the enumerate command below.
2. **Rescue the four unrepoed script sets** — the runtime stack, the capture
   harness, the build launcher, and the 5.8 project configuration. They are the
   irreplaceable part; everything else is either regenerable or a rebuild.
3. **Commit them.** The `relay/wonderland-foundation` worktree holding the 5.8
   uproject and C++ is uncommitted, which is the single largest data risk in
   this migration and has nothing to do with Vast or GCP.
4. Copy the p5-p23 captures — they are the only visual record of the built world.
5. Regenerate the TURN secret on GCP rather than moving it.
6. Only then stop or destroy, and run `gcp-migration-verify.sh 12` afterwards to
   confirm no orphaned disk or address is still billing on either side.

```bash
# From a machine with SSH to the instance, after starting it:
vastai start instance 48078961
ssh -p <port> root@<host> 'for d in /opt/wonderland /root /home/ue4/wonderland-src /etc/turnserver.conf; do
    echo "== $d"; ls -la "$d" 2>/dev/null | head -40; done
  echo "== disk"; df -h /; du -sh /home/ue4/UnrealEngine /opt/wonderland/* 2>/dev/null'
```
