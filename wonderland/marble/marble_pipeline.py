#!/usr/bin/env python3
"""Submit -> poll -> fetch -> export -> manifest, with the money gates.

THE ONE RULE THIS FILE EXISTS TO ENFORCE

  A billable call happens because a person typed the price. Not because a
  loop retried, not because a script re-ran, not because a previous attempt
  left no trace. `submit` writes its INTENT to disk before it opens a socket,
  so a crash between the request and the response still leaves a record that
  a generation may be running and may have been charged. The second run reads
  that record and refuses.

  Free calls (credits, operations, worlds:get, media upload, splat PLY export)
  are not gated and may be repeated freely. Knowing which is which is the
  substance of the guard, so the split is data, not judgement: EXPORT_COST and
  COST_TABLE in marble_api.py.

WORLD DIRECTORY LAYOUT  (one per generated world, slug-named)

    worlds/<slug>/spec.json        what we asked for, before any network
    worlds/<slug>/intent.json      the pre-flight receipt; the double-spend key
    worlds/<slug>/operation.json   the operation id, written the moment it exists
    worlds/<slug>/manifest.json    the durable record (manifest.py)
    worlds/<slug>/assets/          downloaded bytes; signed URLs expire, these do not
"""
import datetime
import hashlib
import io
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import manifest as manifest_mod            # noqa: E402
from marble_api import (                    # noqa: E402
    EXPORT_COST, MarbleClient, MarbleError, MarbleRefusal,
    estimate_credits, load_api_key, redact,
)

DEFAULT_ROOT = os.environ.get("WONDERLAND_MARBLE_DIR", os.path.join(HERE, "worlds"))
POLL_INTERVAL_SECONDS = float(os.environ.get("WONDERLAND_MARBLE_POLL", "20"))
# docs: a generation takes about 5 minutes. An hour is a generous ceiling that
# still ends rather than hanging a session forever.
POLL_CEILING_SECONDS = float(os.environ.get("WONDERLAND_MARBLE_POLL_CEILING", "3600"))


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def world_dir(slug, root=None):
    return os.path.join(root or DEFAULT_ROOT, slug)


def _read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with io.open(path, encoding="utf8") as handle:
        return json.load(handle)


def _write_json(path, payload):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(tmp, path)
    return path


# ------------------------------------------------------------------ spec

def load_spec(path):
    """A world spec: display_name, model, world_prompt, source_reference.

    Kept as a file rather than CLI flags because the prompt is the experiment.
    A prompt typed at a shell is unreproducible and unreviewable, and this one
    is worth 1,580 credits to get wrong.
    """
    spec = _read_json(path)
    if spec is None:
        raise MarbleRefusal("no spec at %s" % path)
    for key in ("slug", "display_name", "model", "world_prompt"):
        if not spec.get(key):
            raise MarbleRefusal("spec %s is missing %r" % (path, key))
    prompt = spec["world_prompt"]
    if prompt.get("type") not in ("text", "image", "multi-image", "video"):
        raise MarbleRefusal("spec world_prompt.type is %r, which the API does not accept"
                            % prompt.get("type"))
    return spec


def build_request(spec):
    """The exact JSON body that will be POSTed. Deterministic, printable."""
    body = {
        "display_name": spec["display_name"][:64],
        "model": spec["model"],
        "world_prompt": spec["world_prompt"],
    }
    if spec.get("seed") is not None:
        body["seed"] = int(spec["seed"])
    if spec.get("tags"):
        body["tags"] = list(spec["tags"])[:10]
    return body


def estimate_for(spec):
    prompt = spec["world_prompt"]
    is_pano = str(prompt.get("is_pano", "")).lower() in ("true", "1", "auto_pano")
    return estimate_credits(spec["model"], prompt["type"], is_pano=is_pano)


# ---------------------------------------------------------------- submit

def submit(spec, confirm_credits=None, root=None, client=None, force_new=False,
           check_balance=True):
    """The billable call. Refuses unless the price was typed and the guard is clear."""
    slug = spec["slug"]
    # Defence in depth: the CLI resolves this too, but a caller reaching past the
    # CLI must not be able to spend credits on a body the API will reject.
    prompt = spec["world_prompt"]
    if prompt.get("type") == "image":
        image = prompt.get("image_prompt") or {}
        if image.get("source") == "media_asset" and not image.get("media_asset_id"):
            raise MarbleRefusal(
                "image_prompt.media_asset_id is empty — upload the reference image "
                "first (free). Nothing was sent.")
    wdir = world_dir(slug, root)
    low, high = estimate_for(spec)
    request_body = build_request(spec)
    phash = manifest_mod.prompt_hash(request_body["world_prompt"])

    # --- guard 1: the price must have been typed, and be enough -------------
    if confirm_credits is None:
        raise MarbleRefusal(
            "This spends credits. Re-run with --confirm-credits N where N is at "
            "least the upper estimate.\n"
            "  model %s, prompt %s -> ESTIMATE %d-%d credits\n"
            "Nothing was sent."
            % (spec["model"], request_body["world_prompt"]["type"], low, high))
    if int(confirm_credits) < high:
        raise MarbleRefusal(
            "--confirm-credits %s is below the upper estimate of %d credits for "
            "model %s. Refusing: an authorisation that does not cover the cost is "
            "not an authorisation." % (confirm_credits, high, spec["model"]))

    # --- guard 2: the double-spend record -----------------------------------
    intent_path = os.path.join(wdir, "intent.json")
    previous = _read_json(intent_path)
    if previous and not force_new:
        if previous.get("prompt_sha256") == phash:
            raise MarbleRefusal(
                "REFUSING A SECOND PAID GENERATION.\n"
                "  %s already records a submission of this exact prompt at %s\n"
                "  operation: %s\n"
                "  status:    %s\n"
                "If that generation failed and you want to pay again, pass "
                "--force-new-generation. If it succeeded, use `poll` or `fetch`."
                % (intent_path, previous.get("submitted_at"),
                   previous.get("operation_id") or "(never returned)",
                   previous.get("outcome") or "unknown"))
        raise MarbleRefusal(
            "%s records a DIFFERENT prompt already submitted for slug %r. Use a "
            "new slug so the two worlds do not overwrite each other, or pass "
            "--force-new-generation deliberately." % (intent_path, slug))

    client = client or MarbleClient()

    # --- guard 3: the balance ----------------------------------------------
    remaining = None
    if check_balance:
        remaining = client.credits()
        if remaining < high:
            raise MarbleRefusal(
                "balance is %d credits, upper estimate is %d. Refusing to start a "
                "generation that may fail for insufficient credits midway."
                % (remaining, high))

    # --- the receipt, BEFORE the socket -------------------------------------
    intent = {
        "slug": slug,
        "submitted_at": utcnow(),
        "model": spec["model"],
        "prompt_type": request_body["world_prompt"]["type"],
        "prompt_sha256": phash,
        "estimate_credits": [low, high],
        "confirmed_credits": int(confirm_credits),
        "balance_before": remaining,
        "operation_id": None,
        "outcome": "in-flight: the request was about to be sent when this was written",
        "request_body": request_body,
    }
    _write_json(intent_path, intent)
    _write_json(os.path.join(wdir, "spec.json"), spec)

    try:
        operation = client.generate(request_body)
    except MarbleError as exc:
        intent["outcome"] = "error: %s" % redact(str(exc), client.api_key)
        intent["error_code"] = exc.code
        # A 4xx below 429 was rejected without work, so the guard is released:
        # nothing was charged and a corrected prompt should be free to submit.
        if exc.code in (400, 402, 404, 422):
            intent["outcome"] += "\n(rejected before any work; safe to submit again)"
            intent["guard_released"] = True
        _write_json(intent_path, intent)
        raise

    operation_id = operation.get("operation_id")
    intent["operation_id"] = operation_id
    intent["outcome"] = "submitted"
    _write_json(intent_path, intent)
    _write_json(os.path.join(wdir, "operation.json"), {
        "operation_id": operation_id,
        "submitted_at": intent["submitted_at"],
        "last_poll": operation,
    })
    return operation


# ------------------------------------------------------------------ poll

def poll(slug, root=None, client=None, once=False, sleep=time.sleep,
         interval=None, ceiling=None, log=print):
    """Poll the operation until done. Free. Writes the manifest on success."""
    wdir = world_dir(slug, root)
    state = _read_json(os.path.join(wdir, "operation.json"))
    if not state or not state.get("operation_id"):
        raise MarbleRefusal("no operation recorded for %r — has it been submitted?" % slug)
    client = client or MarbleClient()
    interval = POLL_INTERVAL_SECONDS if interval is None else interval
    ceiling = POLL_CEILING_SECONDS if ceiling is None else ceiling

    waited = 0.0
    while True:
        operation = client.operation(state["operation_id"])
        state["last_poll"] = operation
        state["polled_at"] = utcnow()
        _write_json(os.path.join(wdir, "operation.json"), state)

        meta = operation.get("metadata") or {}
        progress = meta.get("progress") or {}
        log("  %s  done=%s  %s %s" % (
            state["operation_id"], operation.get("done"),
            progress.get("status", ""), progress.get("description", "")))

        if operation.get("done"):
            if operation.get("error"):
                intent_path = os.path.join(wdir, "intent.json")
                intent = _read_json(intent_path) or {}
                intent["outcome"] = "failed: %s" % json.dumps(operation["error"])
                _write_json(intent_path, intent)
                raise MarbleError("generation failed: %s" % json.dumps(operation["error"]),
                                  code=(operation["error"] or {}).get("code"))
            return finish(slug, operation, root=root, client=client, log=log)

        if once:
            return None
        waited += interval
        if waited > ceiling:
            raise MarbleError(
                "still not done after %.0f seconds. The operation is NOT lost — "
                "re-run `poll %s` to resume; polling is free." % (waited, slug))
        sleep(interval)


def finish(slug, operation, root=None, client=None, log=print):
    """Turn a completed operation into a manifest."""
    wdir = world_dir(slug, root)
    spec = _read_json(os.path.join(wdir, "spec.json")) or {}
    intent = _read_json(os.path.join(wdir, "intent.json")) or {}
    client = client or MarbleClient()

    meta = operation.get("metadata") or {}
    world_id = meta.get("world_id")
    response = operation.get("response") or {}
    if not world_id:
        world_id = response.get("world_id") or response.get("id")
    if not world_id:
        raise MarbleError(
            "the completed operation named no world_id. Nothing to record.\n"
            "operation: %s" % json.dumps(operation)[:600])

    world = response if response.get("assets") else client.world(world_id)

    man = manifest_mod.new(
        world_id=world_id,
        display_name=spec.get("display_name") or world.get("display_name") or slug,
        prompt=(intent.get("request_body") or {}).get("world_prompt")
               or spec.get("world_prompt") or {},
        model=spec.get("model") or world.get("model") or "unknown",
        operation_id=operation.get("operation_id"),
        source_reference=spec.get("source_reference") or {"kind": "unrecorded"},
        generated_at=operation.get("updated_at") or utcnow(),
    )
    manifest_mod.apply_world(man, world)
    manifest_mod.apply_cost(man, operation)
    man["licence"]["checked_at"] = None
    man["unreal_destination"] = spec.get("unreal_destination") or {
        "content_path": "/Game/Wonderland/Marble/%s" % slug,
        "level": "/Game/Wonderland/Maps/WonderlandHub",
        "actor_label": "MarbleVisualLayer_%s" % slug,
    }
    man["transform"]["unreal_origin_cm"] = (spec.get("placement") or {}).get(
        "origin_cm", [0.0, 0.0, 0.0])
    man["transform"]["unreal_rotation_deg"] = (spec.get("placement") or {}).get(
        "rotation_deg", [0.0, 0.0, 0.0])

    path = manifest_mod.write(os.path.join(wdir, "manifest.json"), man)
    intent["outcome"] = "succeeded"
    intent["world_id"] = world_id
    _write_json(os.path.join(wdir, "intent.json"), intent)
    log("  manifest: %s" % path)
    log("  world_id: %s" % world_id)
    log("  cost:     %s credits" % man["cost"]["total_credits"])
    return man


# ----------------------------------------------------------------- fetch

# Which free asset each key downloads to. Order matters only for the log.
FREE_ASSETS = (
    ("thumbnail_url", "thumbnail.jpg"),
    ("pano_url", "panorama.jpg"),
    ("full_res_mesh_url", "mesh_full_res.glb"),
    ("hq_mesh_url", "mesh_hq.glb"),
    ("collider_mesh_url", "collider.glb"),
)


def fetch(slug, root=None, log=print, opener=None, only=None):
    """Download every asset URL the world already carries. FREE — no credits.

    The signed URLs expire. Whatever is not pulled now is a paid regeneration
    later, which is why this grabs everything available rather than only what
    the current import step happens to want.
    """
    wdir = world_dir(slug, root)
    path = os.path.join(wdir, "manifest.json")
    man = _read_json(path)
    if not man:
        raise MarbleRefusal("no manifest for %r — run poll first" % slug)
    assets_dir = os.path.join(wdir, "assets")
    os.makedirs(assets_dir, exist_ok=True)

    got = dict(man["assets"].get("downloaded") or {})
    for key, filename in FREE_ASSETS:
        if only and key not in only:
            continue
        url = man["assets"].get(key)
        if not url:
            log("  - %-20s not present on this world" % key)
            continue
        dest = os.path.join(assets_dir, filename)
        size = _download(url, dest, opener=opener)
        got[key] = {"path": os.path.relpath(dest, wdir), "bytes": size,
                    "fetched_at": utcnow()}
        log("  + %-20s %s (%s)" % (key, filename, _human(size)))

    for name, url in (man["assets"].get("splat_spz_urls") or {}).items():
        if only and "splats" not in only:
            continue
        if not url:
            continue
        dest = os.path.join(assets_dir, "splat_%s.spz" % name)
        size = _download(url, dest, opener=opener)
        got["splat_%s" % name] = {"path": os.path.relpath(dest, wdir), "bytes": size,
                                  "fetched_at": utcnow()}
        log("  + splat %-14s %s (%s)" % (name, os.path.basename(dest), _human(size)))

    man["assets"]["downloaded"] = got
    manifest_mod.write(path, man)
    return man


def _download(url, dest, opener=None, timeout=600):
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "relay-wonderland-marble/1"})
    open_fn = opener.open if opener is not None else urllib.request.urlopen
    tmp = dest + ".part"
    total = 0
    with open_fn(request, timeout=timeout) as response, io.open(tmp, "wb") as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
            total += len(chunk)
    os.replace(tmp, dest)
    return total


def _human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.1f %s" % (n, unit)
        n /= 1024.0


# ---------------------------------------------------------------- export

def export(slug, asset_type, fmt, root=None, client=None, confirm_credits=None,
           resolution=None, mesh_variant=None, log=print, opener=None):
    """Request an export. splats/ply is free; mesh/glb costs credits and is gated."""
    wdir = world_dir(slug, root)
    path = os.path.join(wdir, "manifest.json")
    man = _read_json(path)
    if not man:
        raise MarbleRefusal("no manifest for %r — run poll first" % slug)

    price = EXPORT_COST.get((asset_type, fmt))
    if price is None:
        raise MarbleRefusal(
            "no published price for export %s/%s. Refusing." % (asset_type, fmt))
    if price > 0:
        if confirm_credits is None or int(confirm_credits) < price:
            raise MarbleRefusal(
                "%s/%s export costs %d credits. Re-run with "
                "--confirm-credits %d to authorise it. Nothing was sent."
                % (asset_type, fmt, price, price))
        already = [e for e in man.get("exports") or []
                   if e.get("asset_type") == asset_type and e.get("format") == fmt
                   and e.get("local_path")]
        if already:
            raise MarbleRefusal(
                "a %s/%s export is already recorded for this world at %s. "
                "Refusing to pay %d credits twice."
                % (asset_type, fmt, already[0]["local_path"], price))

    client = client or MarbleClient()
    operation = client.export(man["marble_world_id"], asset_type, fmt,
                              resolution=resolution, mesh_variant=mesh_variant)

    # PLY splat exports come back done; HQ mesh exports are async.
    while not operation.get("done"):
        log("  export in progress…")
        time.sleep(POLL_INTERVAL_SECONDS)
        operation = client.operation(operation["operation_id"])
    if operation.get("error"):
        raise MarbleError("export failed: %s" % json.dumps(operation["error"]))

    result = operation.get("response") or {}
    url = result.get("url")
    local = None
    if url:
        name = "export_%s_%s%s.%s" % (asset_type, fmt,
                                      ("_" + resolution) if resolution else "", fmt)
        dest = os.path.join(wdir, "assets", name)
        size = _download(url, dest, opener=opener)
        local = os.path.relpath(dest, wdir)
        log("  + %s (%s)" % (local, _human(size)))

    charged = ((operation.get("cost") or {}).get("total_credits"))
    manifest_mod.record_export(man, asset_type, fmt, url, local,
                               charged if charged is not None else price,
                               extra={"resolution": resolution,
                                      "mesh_variant": mesh_variant,
                                      "operation_id": operation.get("operation_id")})
    if asset_type == "mesh" and fmt == "glb":
        # The HQ mesh usually also appears on the world object afterwards.
        try:
            manifest_mod.apply_world(man, client.world(man["marble_world_id"]))
        except MarbleError:
            pass
    manifest_mod.write(path, man)
    return man


# --------------------------------------------------------- reference image

IMAGE_EXTENSIONS = {".jpg": "jpg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp"}


def reference_path(spec, spec_path=None):
    """Where the spec's reference image lives.

    `reference_image` is relative to wonderland/marble/, NOT to the spec file.
    Specs live in prompts/ and the image lives in reference/; resolving against
    the spec's own directory sent the operator to prompts/reference/, a path
    that will never exist. Absolute paths are honoured as given, and a
    spec-relative file is accepted too so a spec kept elsewhere still works.
    """
    ref = spec.get("reference_image") or ""
    if not ref:
        return ""
    if os.path.isabs(ref):
        return ref
    candidates = [os.path.normpath(os.path.join(HERE, ref))]
    if spec_path:
        candidates.append(os.path.normpath(
            os.path.join(os.path.dirname(os.path.abspath(spec_path)), ref)))
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return candidates[0]


def resolve_prompt(spec, spec_path=None):
    """Refuse a spec that cannot produce a valid request.

    The image path is the founder's instruction, and the failure it can have is
    silent: a `media_asset_id` of null serialises to a body the API rejects
    with a 422 — after the round trip, and after the operator has already typed
    a price. Catching it here costs nothing and keeps the refusal ours.
    """
    prompt = spec["world_prompt"]
    if prompt.get("type") != "image":
        return spec
    source = (prompt.get("image_prompt") or {})
    if source.get("source") == "media_asset" and not source.get("media_asset_id"):
        where = reference_path(spec, spec_path)
        raise MarbleRefusal(
            "this spec is conditioned on the founder's reference IMAGE and no image "
            "has been uploaded yet.\n"
            "  1. put the image at: %s\n"
            "  2. run:  python3 marble_cli.py upload-reference %s\n"
            "     (uploading media is FREE and charges no credits)\n"
            "Nothing was sent."
            % (where, spec_path or "<spec>"))
    if source.get("source") == "uri" and not source.get("uri"):
        raise MarbleRefusal("image_prompt.source is 'uri' but no uri is set")
    return spec


def upload_reference(spec_path, client=None, log=print):
    """Upload the local reference image and write its id back into the spec. FREE."""
    spec = load_spec(spec_path)
    ref = spec.get("reference_image")
    if not ref:
        raise MarbleRefusal("spec has no reference_image path")
    image_path = reference_path(spec, spec_path)
    if not os.path.exists(image_path):
        raise MarbleRefusal(
            "no reference image at %s.\n"
            "This is the founder's canonical Wonderland image. Save it there and "
            "re-run. Nothing was sent." % image_path)

    extension = IMAGE_EXTENSIONS.get(os.path.splitext(image_path)[1].lower())
    if not extension:
        raise MarbleRefusal(
            "%s is not a format the API accepts (jpg, jpeg, png, webp)." % image_path)

    with io.open(image_path, "rb") as handle:
        payload = handle.read()
    digest = hashlib.sha256(payload).hexdigest()
    log("  %s  %s bytes  sha256 %s" % (os.path.basename(image_path), len(payload), digest[:16]))

    client = client or MarbleClient()
    prepared = client.prepare_upload(os.path.basename(image_path), "image", extension)
    asset = prepared.get("media_asset") or {}
    upload_info = prepared.get("upload_info") or {}
    asset_id = asset.get("id")
    if not asset_id:
        raise MarbleError("prepare_upload returned no media_asset.id: %r" % (prepared,))
    client.upload_media(upload_info, payload)
    log("  uploaded. media_asset_id = %s" % asset_id)

    spec["world_prompt"]["image_prompt"]["media_asset_id"] = asset_id
    spec["world_prompt"]["image_prompt"]["source"] = "media_asset"
    spec.setdefault("source_reference", {})["media_asset_id"] = asset_id
    spec["source_reference"]["sha256"] = digest
    spec["source_reference"]["uploaded_at"] = utcnow()
    _write_json(spec_path, spec)
    log("  spec updated: %s" % spec_path)
    return asset_id
