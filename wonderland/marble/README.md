# Marble in Wonderland

World Labs' Marble generates the *scenery*. It does not generate Wonderland.

## The boundary, stated once so code can be checked against it

Relay's Compound AI Agent core — LLMs, coding tools and agent harnesses, tools,
persistent memory and project state, permissions, verification, C.A.R.D. and
Relay orchestration — is untouched by anything in this directory. Wonderland is
the multiplayer spatial environment those Agents inhabit; Marble improves that
environment's *appearance*. No file here imports Relay, calls the Bridge, or
learns anything about an Agent.

| Layer | Owner | Contains |
| --- | --- | --- |
| Visual | **Marble** | architecture, scenery, foliage, distant city, decorative detail |
| Gameplay | **Unreal** | collision, navigation, Relay Dogs, Compound Agent state, multiplayer, interactions, quests, GVE |

Marble geometry imports **NoCollision**. `collision_source.authority` in every
manifest is `"unreal"`, and `manifest.validate()` refuses a manifest that says
otherwise — the rule is enforced by a test, not by remembering it.

Gaussian splats are downloaded and kept, and are **not** the collision or
navigation authority. There is no evidence they are suitable for it, and
"no evidence" is the reason, not a placeholder for one.

## The money rules, and where each one lives

Marble costs real credits (~13,250 held). Three rules, each enforced in code:

1. **Fail closed.** No `WORLDLABS_API_KEY` is a refusal, never anonymous mode —
   `marble_api.load_api_key`.
2. **A price is typed by a person.** `submit` and the paid export refuse without
   `--confirm-credits N` covering the published upper estimate, and check the
   live balance first — `marble_pipeline.submit`, `marble_pipeline.export`.
3. **No paid call is ever automatic.** A 429 is retried (rate-limited requests
   were never accepted). A 5xx on `:generate` is **not** — the server may
   already be generating. `intent.json` is written *before* the socket opens, so
   a crash mid-request still leaves the guard armed.

Published prices (docs.worldlabs.ai/api/pricing.md, 2026-08-21): non-pano image
or text generation **1,580** credits on `marble-1.1`; `marble-1.1-plus` 1,580–3,080;
**HQ textured mesh export 3,500**; **PLY splat export free**. `full_res_mesh_url`,
`collider_mesh_url`, `pano_url` and the SPZ splats come with the world at no
extra charge — `fetch` pulls all of them because the signed URLs expire and a
missed one costs a regeneration.

## Commands

```bash
cd wonderland/marble
python3 marble_cli.py plan prompts/royal-garden.json     # no network, no key, no spend
python3 marble_cli.py credits                            # free
python3 marble_cli.py upload-reference prompts/royal-garden.json   # free
python3 marble_cli.py submit prompts/royal-garden.json --confirm-credits 1580
python3 marble_cli.py poll  royal-garden                 # free, resumable
python3 marble_cli.py fetch royal-garden                 # free
python3 marble_cli.py export royal-garden --asset-type splats --format ply   # free
python3 marble_cli.py verify royal-garden
```

Then, inside the editor on the GPU box:

```bash
UnrealEditor Wonderland.uproject -run=pythonscript \
  -script="wonderland/marble/import-marble-world.py --slug royal-garden"
```

It imports the best downloaded mesh (the paid HQ one if present, the free
full-res one otherwise, and it says which), requests Nanite for it, places it
with collision **off**, imports Marble's collider mesh as a hidden reference
that is explicitly *not* collision, and writes the measured bounds back into
the manifest. It deletes nothing: the existing generated world — gameplay
anchors, portals, the Dogs, the navigable plaza — is untouched.

Exit codes: `0` success, `2` **our** refusal (nothing sent), `3` the vendor said no.

## Proof

`python3 marble_offline_test.py` runs the whole pipeline against a stub of the
documented API: 52 checks, ~2 seconds, no network, no credits.
`python3 import_offline_test.py` runs the UE importer against a stubbed engine:
28 checks, proving among other things that **no path exists** that places a
Marble mesh with collision enabled. It asserts on
request counts at a socket rather than on mock call records, because the
failure being guarded against is *the vendor was billed twice*.

**What it does not prove:** the vendor's real contract. Every field is
transcribed from the official reference, and only a live call tests that.

## What is still needed

1. `WORLDLABS_API_KEY` in the shell — founder action, nothing works without it.
2. The founder's reference image at `reference/wonderland-reference.png` — it
   exists in chat, not in this repo, and the image path refuses without it.
   `prompts/royal-garden-text.json` is a text-only fallback and is labelled a
   *different experiment*, not a substitute.
3. A GPU box to run the import on. `import-marble-world.py` is written and
   tested offline (28 checks), but it runs inside the editor and there is no
   Unreal here.
