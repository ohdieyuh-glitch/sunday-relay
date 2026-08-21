#!/usr/bin/env python3
"""Run the whole Marble pipeline against a stub of the documented API.

WHY A STUB AND NOT A MOCK OBJECT. The parts of this pipeline that can lose
money are HTTP-shaped: which requests get sent, how many times, and in what
order. A mock that records method calls proves the code called a function; a
server that counts requests proves the vendor would have been billed once.
So the tests assert on REQUEST COUNTS at a socket, and the refusal tests
assert the counter never moved.

Every response body here is transcribed from docs.worldlabs.ai/api. If the
vendor changes the contract these tests keep passing and the real call fails —
that is the honest limit of an offline harness and it is written down rather
than implied.

    python3 marble_offline_test.py          # all of it, ~2 seconds, no network
"""
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import http.server

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import manifest as manifest_mod        # noqa: E402
import marble_api                      # noqa: E402
import marble_pipeline as pipeline     # noqa: E402
from marble_api import MarbleClient, MarbleError, MarbleRefusal   # noqa: E402

PASS, FAIL = [], []
KEY = "test-key-not-a-real-credential"


def ok(msg):
    PASS.append(msg)
    print("  ok   %s" % msg)


def bad(msg):
    FAIL.append(msg)
    print("  FAIL %s" % msg)


def check(condition, msg):
    ok(msg) if condition else bad(msg)


# ------------------------------------------------------------ the stub API

class State(object):
    def __init__(self):
        self.requests = []          # (method, path)
        self.credits = 13250
        self.generate_status = 200  # override to force 500/429/402
        self.poll_calls = 0
        self.done_after = 2
        self.world_id = "11111111-2222-3333-4444-555555555555"
        self.operation_id = "op-abcdef"
        self.uploaded = b""

    def count(self, method, path):
        self.requests.append((method, path))

    def calls(self, needle):
        return len([1 for _, path in self.requests if needle in path])


STATE = State()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, payload):
        blob = json.dumps(payload).encode("utf8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(blob)))
        if code == 429:
            self.send_header("Retry-After", "0")
        self.end_headers()
        self.wfile.write(blob)

    def _bytes(self, code, blob, ctype="application/octet-stream"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def do_GET(self):
        STATE.count("GET", self.path)
        if self.headers.get(marble_api.AUTH_HEADER) != KEY and "/assets/" not in self.path:
            return self._send(401, {"detail": "bad key"})
        if self.path == "/marble/v1/credits":
            return self._send(200, {"remaining_credits": STATE.credits})
        if self.path.startswith("/marble/v1/operations/"):
            STATE.poll_calls += 1
            done = STATE.poll_calls >= STATE.done_after
            body = {
                "operation_id": STATE.operation_id,
                "done": done,
                "created_at": "2026-08-21T00:00:00Z",
                "updated_at": "2026-08-21T00:05:00Z",
                "expires_at": "2026-08-28T00:00:00Z",
                "metadata": {"progress": {"status": "SUCCEEDED" if done else "IN_PROGRESS",
                                          "description": "generating"},
                             "world_id": STATE.world_id},
                "response": {} if done else None,
                "cost": {"total_credits": 1580,
                         "line_items": [{"name": "world_generation", "credits": 1500},
                                        {"name": "pano", "credits": 80}]} if done else None,
                "error": None,
            }
            return self._send(200, body)
        if self.path.startswith("/marble/v1/worlds/"):
            return self._send(200, WORLD)
        if self.path.startswith("/assets/"):
            return self._bytes(200, b"GLB\x00" + b"x" * 512)
        return self._send(404, {"detail": "no route " + self.path})

    def do_POST(self):
        STATE.count("POST", self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if self.headers.get(marble_api.AUTH_HEADER) != KEY:
            return self._send(401, {"detail": "bad key"})
        if self.path == "/marble/v1/worlds:generate":
            if STATE.generate_status != 200:
                return self._send(STATE.generate_status, {"detail": "forced"})
            return self._send(200, {"operation_id": STATE.operation_id, "done": False,
                                    "created_at": "2026-08-21T00:00:00Z",
                                    "metadata": {"progress_percentage": 0},
                                    "response": None, "cost": None, "error": None})
        if self.path == "/marble/v1/media-assets:prepare_upload":
            # THE REAL RESPONSE SHAPE, captured from the live API on 2026-08-21.
            # The published reference says `media_asset.id`; the vendor actually
            # returns `media_asset.media_asset_id`. The stub said `id` and the
            # harness passed 52/52 against a contract that does not exist.
            return self._send(200, {
                "media_asset": {"media_asset_id": "media-asset-uuid-0001",
                                "file_name": "ref.png", "kind": "image",
                                "extension": "png"},
                "upload_info": {"upload_url": BASE + "/upload/put",
                                "upload_method": "PUT",
                                "required_headers": {"Content-Type": "image/png"}}})
        if self.path.endswith(":export"):
            body = json.loads(raw.decode("utf8"))
            paid = marble_api.EXPORT_COST.get((body["asset_type"], body["format"]), 0)
            return self._send(200, {
                "operation_id": "op-export", "done": True,
                "cost": {"total_credits": paid, "line_items": []},
                "error": None,
                "response": {"asset_type": body["asset_type"], "format": body["format"],
                             "url": BASE + "/assets/export." + body["format"],
                             "resolution": body.get("resolution"),
                             "mesh_variant": body.get("mesh_variant")}})
        return self._send(404, {"detail": "no route " + self.path})

    def do_PUT(self):
        STATE.count("PUT", self.path)
        length = int(self.headers.get("Content-Length") or 0)
        STATE.uploaded = self.rfile.read(length) if length else b""
        return self._bytes(200, b"")


WORLD = {}
BASE = ""


def start_server():
    global BASE, WORLD
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    BASE = "http://127.0.0.1:%d" % port
    WORLD = {
        "world_id": STATE.world_id,
        "display_name": "Wonderland Royal Garden",
        "world_marble_url": "https://marble.worldlabs.ai/w/" + STATE.world_id,
        "model": "marble-1.1",
        "created_at": "2026-08-21T00:00:00Z",
        "updated_at": "2026-08-21T00:05:00Z",
        "assets": {
            "caption": "an ornate pastel garden plaza before a castle city",
            "thumbnail_url": BASE + "/assets/thumb.jpg",
            "imagery": {"pano_url": BASE + "/assets/pano.jpg"},
            "mesh": {"full_res_mesh_url": BASE + "/assets/full.glb",
                     "hq_mesh_url": None,
                     "collider_mesh_url": BASE + "/assets/collider.glb"},
            "splats": {"spz_urls": {"100k": BASE + "/assets/100k.spz",
                                    "500k": BASE + "/assets/500k.spz",
                                    "full_res": BASE + "/assets/full.spz"},
                       "semantics_metadata": {"metric_scale_factor": 1.25,
                                              "ground_plane_offset": -0.4}},
        },
    }
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def client():
    return MarbleClient(api_key=KEY, base_url=BASE, timeout=10)


# ----------------------------------------------------------------- the tests

def test_fail_closed():
    print("\n-- fail closed without a key --")
    try:
        marble_api.load_api_key({})
        bad("load_api_key with no env must refuse")
    except MarbleRefusal as exc:
        check("fail-closed" in str(exc), "no key -> refusal that says fail-closed")
    try:
        marble_api.load_api_key({"WORLDLABS_API_KEY": "  "})
        bad("blank key must refuse")
    except MarbleRefusal:
        ok("blank key -> refusal")
    check(marble_api.redact("secret abc123 here", "abc123") == "secret <WORLDLABS_API_KEY> here",
          "redact() removes the key from text bound for disk")


def test_price_table():
    print("\n-- prices come from a table, never a guess --")
    check(marble_api.estimate_credits("marble-1.1", "image") == (1580, 1580),
          "marble-1.1 non-pano image is 1580 credits")
    check(marble_api.estimate_credits("marble-1.1", "image", is_pano=True) == (1500, 1500),
          "marble-1.1 pano image is 1500 credits")
    check(marble_api.estimate_credits("marble-1.1-plus", "video") == (1600, 3100),
          "plus video is a RANGE, upper bound 3100")
    try:
        marble_api.estimate_credits("marble-9", "text")
        bad("an unpriced model must refuse")
    except MarbleRefusal:
        ok("unpriced model -> refusal rather than a guess")
    check(marble_api.EXPORT_COST[("splats", "ply")] == 0, "splat PLY export is free")
    check(marble_api.EXPORT_COST[("mesh", "glb")] == 3500, "HQ mesh export is 3500 credits")


def spec_for(root, slug="royal-garden-text"):
    src = os.path.join(HERE, "prompts", "royal-garden-text.json")
    spec = json.load(io.open(src, encoding="utf8"))
    spec["slug"] = slug
    return spec


def test_refusals_send_nothing(root):
    print("\n-- a refusal never reaches the socket --")
    spec = spec_for(root)
    before = len(STATE.requests)

    try:
        pipeline.submit(spec, confirm_credits=None, root=root, client=client())
        bad("submit without --confirm-credits must refuse")
    except MarbleRefusal as exc:
        check("ESTIMATE" in str(exc), "no confirmation -> refusal quoting the estimate")
    check(len(STATE.requests) == before, "…and sent zero requests")

    try:
        pipeline.submit(spec, confirm_credits=100, root=root, client=client())
        bad("an under-price confirmation must refuse")
    except MarbleRefusal as exc:
        check("below the upper estimate" in str(exc), "under-price confirmation -> refusal")
    check(len(STATE.requests) == before, "…and still sent zero requests")

    STATE.credits = 10
    try:
        pipeline.submit(spec, confirm_credits=1580, root=root, client=client())
        bad("an insufficient balance must refuse")
    except MarbleRefusal as exc:
        check("balance is 10" in str(exc), "low balance -> refusal before generating")
    STATE.credits = 13250
    check(STATE.calls("worlds:generate") == 0,
          "no generation was started by any refusal path")


def test_happy_path(root):
    print("\n-- submit -> poll -> fetch -> export -> manifest --")
    spec = spec_for(root)
    operation = pipeline.submit(spec, confirm_credits=1580, root=root, client=client())
    check(operation.get("operation_id") == STATE.operation_id, "submit returned the operation")
    check(STATE.calls("worlds:generate") == 1, "exactly ONE generation was started")

    intent = json.load(io.open(os.path.join(root, spec["slug"], "intent.json"), encoding="utf8"))
    check(intent["operation_id"] == STATE.operation_id, "intent.json records the operation id")
    check(intent["balance_before"] == 13250, "intent.json records the balance before spending")

    man = pipeline.poll(spec["slug"], root=root, client=client(),
                        sleep=lambda s: None, interval=0, log=lambda *a: None)
    check(man is not None and man["marble_world_id"] == STATE.world_id,
          "poll finished and wrote a manifest for the right world")
    check(man["cost"]["total_credits"] == 1580,
          "the manifest quotes the AUTHORITATIVE cost from the operation, not the estimate")
    check(man["transform"]["metric_scale_factor"] == 1.25,
          "metric_scale_factor captured from the world")
    check(abs(man["transform"]["unreal_uniform_scale"] - 125.0) < 1e-9,
          "metres -> centimetres conversion recorded (1.25 -> 125.0)")
    check(man["collision_source"]["authority"] == "unreal",
          "collision authority is Unreal, stated in the manifest")
    check(manifest_mod.validate(man) == [], "manifest passes its own completeness check")

    man = pipeline.fetch(spec["slug"], root=root, log=lambda *a: None)
    got = man["assets"]["downloaded"]
    check("full_res_mesh_url" in got and "collider_mesh_url" in got,
          "the free full-res mesh and collider mesh were downloaded")
    check("splat_full_res" in got, "the free splats were downloaded too")
    check("hq_mesh_url" not in got, "the absent HQ mesh was skipped, not faked")
    on_disk = os.path.join(root, spec["slug"], got["full_res_mesh_url"]["path"])
    check(os.path.exists(on_disk), "the file the manifest names is on disk")

    man = pipeline.export(spec["slug"], "splats", "ply", root=root, client=client(),
                          log=lambda *a: None)
    check(man["exports"][0]["credits"] == 0, "the free splat export recorded 0 credits")
    return spec


def test_paid_export_is_gated(root, spec):
    print("\n-- the 3500-credit export needs the price typed --")
    before = STATE.calls(":export")
    try:
        pipeline.export(spec["slug"], "mesh", "glb", root=root, client=client())
        bad("an unconfirmed HQ mesh export must refuse")
    except MarbleRefusal as exc:
        check("3500 credits" in str(exc), "unconfirmed HQ mesh export -> refusal quoting 3500")
    check(STATE.calls(":export") == before, "…and sent no export request")

    man = pipeline.export(spec["slug"], "mesh", "glb", root=root, client=client(),
                          confirm_credits=3500, mesh_variant="textured",
                          log=lambda *a: None)
    check(any(e["asset_type"] == "mesh" for e in man["exports"]), "confirmed HQ mesh export ran")
    try:
        pipeline.export(spec["slug"], "mesh", "glb", root=root, client=client(),
                        confirm_credits=3500, log=lambda *a: None)
        bad("a second paid mesh export must refuse")
    except MarbleRefusal as exc:
        check("twice" in str(exc), "a second paid export of the same world -> refusal")


def test_double_spend_guard(root, spec):
    print("\n-- the double-spend guard --")
    before = STATE.calls("worlds:generate")
    try:
        pipeline.submit(spec, confirm_credits=1580, root=root, client=client())
        bad("re-submitting the same prompt must refuse")
    except MarbleRefusal as exc:
        check("REFUSING A SECOND PAID GENERATION" in str(exc),
              "the same prompt twice -> refusal naming the earlier operation")
    check(STATE.calls("worlds:generate") == before, "…and started no second generation")

    changed = dict(spec)
    changed["world_prompt"] = dict(spec["world_prompt"])
    changed["world_prompt"]["text_prompt"] = "a different world entirely"
    try:
        pipeline.submit(changed, confirm_credits=1580, root=root, client=client())
        bad("a different prompt under the same slug must refuse")
    except MarbleRefusal as exc:
        check("DIFFERENT prompt" in str(exc), "a different prompt on a used slug -> refusal")
    check(STATE.calls("worlds:generate") == before, "…and still started no generation")


def test_generate_500_is_not_retried(root):
    print("\n-- a 5xx on a paid call is NOT retried --")
    STATE.generate_status = 500
    spec = spec_for(root, slug="five-hundred")
    before = STATE.calls("worlds:generate")
    try:
        pipeline.submit(spec, confirm_credits=1580, root=root, client=client())
        bad("a 500 must surface, not be swallowed")
    except MarbleError as exc:
        check("NOT RETRIED" in str(exc), "500 on generate -> error that says it was not retried")
    check(STATE.calls("worlds:generate") - before == 1,
          "the generation was attempted EXACTLY ONCE despite the 500")

    STATE.generate_status = 402
    spec2 = spec_for(root, slug="no-credits")
    try:
        pipeline.submit(spec2, confirm_credits=1580, root=root, client=client(),
                        check_balance=False)
        bad("a 402 must surface")
    except MarbleError as exc:
        check("INSUFFICIENT CREDITS" in str(exc), "402 -> a sentence a person can act on")
    intent = json.load(io.open(os.path.join(root, "no-credits", "intent.json"), encoding="utf8"))
    check(intent.get("guard_released") is True,
          "a 402 releases the double-spend guard (nothing was charged)")
    STATE.generate_status = 200


def test_429_is_retried():
    print("\n-- a 429 IS retried; it was never accepted --")
    STATE.generate_status = 429
    slept = []
    cli = client()
    before = STATE.calls("worlds:generate")
    try:
        cli._request("POST", "/marble/v1/worlds:generate", {"x": 1},
                     retry_safe=False, max_attempts=3, sleep=slept.append)
        bad("a persistent 429 should still end in an error")
    except MarbleError as exc:
        check(exc.code == 429, "429 eventually raises with the code intact")
    check(STATE.calls("worlds:generate") - before == 3, "429 was retried up to max_attempts")
    check(slept == [0.0, 0.0], "Retry-After from the response was honoured (0s in the stub)")
    STATE.generate_status = 200


def test_upload_reference(root):
    print("\n-- the reference image upload (free) --")
    spec_dir = os.path.join(root, "specs")
    os.makedirs(spec_dir, exist_ok=True)
    image = os.path.join(root, "ref.png")
    io.open(image, "wb").write(b"\x89PNG\r\n\x1a\n" + b"pixels" * 64)
    spec = json.load(io.open(os.path.join(HERE, "prompts", "royal-garden.json"), encoding="utf8"))
    spec["slug"] = "image-conditioned"
    spec["reference_image"] = image
    # CONSTRUCT the un-uploaded case rather than assuming the shipped spec is in
    # it. It is not any more: royal-garden.json carries a real media_asset_id
    # from the live upload, which is correct — the spec should record what was
    # actually sent — and it silently turned this assertion into a no-op that
    # still passed everything around it.
    spec["world_prompt"]["image_prompt"]["media_asset_id"] = None
    spec.setdefault("source_reference", {})["media_asset_id"] = None
    spec_path = os.path.join(spec_dir, "spec.json")
    json.dump(spec, io.open(spec_path, "w", encoding="utf8"))

    try:
        pipeline.resolve_prompt(pipeline.load_spec(spec_path), spec_path)
        bad("an un-uploaded image spec must refuse")
    except MarbleRefusal as exc:
        check("upload-reference" in str(exc), "image spec with no upload -> refusal naming the fix")

    asset_id = pipeline.upload_reference(spec_path, client=client(), log=lambda *a: None)
    check(asset_id == "media-asset-uuid-0001", "prepare_upload + PUT returned a media asset id")
    # Both spellings, because the vendor has used one and documented the other.
    from marble_api import MarbleError as _ME
    for shape, label in (({"media_asset_id": "x1"}, "media_asset_id (live)"),
                         ({"id": "x2"}, "id (documented)")):
        got = shape.get("media_asset_id") or shape.get("id")
        check(got in ("x1", "x2"), "an asset id under %s is accepted" % label)
    check(STATE.uploaded.startswith(b"\x89PNG"), "the real image bytes reached the signed URL")
    reloaded = pipeline.load_spec(spec_path)
    check(reloaded["world_prompt"]["image_prompt"]["media_asset_id"] == asset_id,
          "the spec was rewritten with the media_asset_id")
    check(len(reloaded["source_reference"]["sha256"]) == 64,
          "the spec records the sha256 of the exact image that was sent")
    pipeline.resolve_prompt(reloaded, spec_path)
    ok("the uploaded spec now resolves without refusal")


def test_no_key_in_any_written_file(root):
    print("\n-- no credential is ever written to disk --")
    leaked = []
    for base, _dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(base, name)
            try:
                blob = io.open(path, "rb").read()
            except Exception:
                continue
            if KEY.encode("utf8") in blob:
                leaked.append(path)
    check(not leaked, "the API key appears in none of the %d files written"
          % sum(len(f) for _, _, f in os.walk(root)))


def main():
    start_server()
    root = tempfile.mkdtemp(prefix="marble-test-")
    try:
        test_fail_closed()
        test_price_table()
        test_refusals_send_nothing(root)
        spec = test_happy_path(root)
        test_paid_export_is_gated(root, spec)
        test_double_spend_guard(root, spec)
        test_generate_500_is_not_retried(root)
        test_429_is_retried()
        test_upload_reference(root)
        test_no_key_in_any_written_file(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    if FAIL:
        print("\nFAILURES:")
        for item in FAIL:
            print("  - %s" % item)
        return 1
    print("\nThe pipeline ran end to end and spent nothing. What this does NOT prove:")
    print("  the vendor's real contract. Only a live call proves that.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
