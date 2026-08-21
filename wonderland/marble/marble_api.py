#!/usr/bin/env python3
"""The World Labs Marble World API, as documented, and nothing invented.

WHY THIS FILE IS NARROW

Every endpoint, header, field name and cost in here is transcribed from the
official reference at https://docs.worldlabs.ai/api (fetched 2026-08-21) and
carries the doc path it came from. Nothing is guessed. If a field is not in
that reference it is not sent, because a request the server does not
understand is not a cheaper failure than one it does — a rejected generation
still costs a human a round trip, and a MISinterpreted one costs credits.

WHAT THIS FILE REFUSES TO DO

  * It never invents a key. No key in the environment is a refusal, not a
    fallback to anonymous access.
  * It never retries a request that can be billed. A 429 is a rate limit: the
    request was rejected before it started and retrying is safe. A 500 on a
    generation start is AMBIGUOUS — the server may have begun work — so it is
    reported to a person and never repeated automatically. The founder's
    instruction was explicit and this is where it is enforced.
  * It has no opinion about art. Prompt construction lives in the pipeline;
    this is transport.

STDLIB ONLY. This runs on a laptop, in CI and on a GPU box with no pip.
"""
import io
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------- constants

BASE_URL = os.environ.get("WORLDLABS_API_BASE", "https://api.worldlabs.ai")
API_KEY_ENV = "WORLDLABS_API_KEY"
AUTH_HEADER = "WLT-Api-Key"          # docs.worldlabs.ai/api — not Authorization.
USER_AGENT = "relay-wonderland-marble/1 (+https://github.com/ohdieyuh-glitch/sunday-relay)"

# docs.worldlabs.ai/api/reference/worlds/generate.md
MODELS = ("marble-1.0-draft", "marble-1.0", "marble-1.1", "marble-1.1-plus")
PROMPT_TYPES = ("text", "image", "multi-image", "video")

# docs.worldlabs.ai/api/pricing.md, transcribed 2026-08-21.
#
# These are ESTIMATES USED TO REFUSE, never to report a bill. The authoritative
# number is `operation.cost.total_credits` returned when the work is done, and
# the manifest records THAT. A table that silently drifts from the vendor's
# price list must never be the thing a receipt quotes.
#
#   (model, prompt type) -> (low, high) credits
COST_TABLE = {
    ("marble-1.1", "text"):          (1580, 1580),
    ("marble-1.1", "image"):         (1580, 1580),   # non-pano image
    ("marble-1.1", "image-pano"):    (1500, 1500),
    ("marble-1.1", "multi-image"):   (1600, 1600),
    ("marble-1.1", "video"):         (1600, 1600),
    ("marble-1.1-plus", "text"):     (1580, 3080),   # +0..1500 by world size
    ("marble-1.1-plus", "image"):    (1580, 3080),
    ("marble-1.1-plus", "image-pano"): (1500, 3000),
    ("marble-1.1-plus", "multi-image"): (1600, 3100),
    ("marble-1.1-plus", "video"):    (1600, 3100),
}
# docs.worldlabs.ai/api/pricing.md: HQ textured mesh export is billed; PLY
# splat export is free. Both are stated here so the CLI can gate on the paid
# one without a second source of truth.
EXPORT_COST = {
    ("mesh", "glb"):   3500,
    ("splats", "ply"): 0,
}
FREE_OPERATIONS = ("credits", "operations", "media-assets", "worlds:get")


class MarbleError(Exception):
    """Any failure talking to Marble. `code` is the HTTP status when there was one."""

    def __init__(self, message, code=None, detail=None):
        super().__init__(message)
        self.code = code
        self.detail = detail


class MarbleRefusal(MarbleError):
    """A refusal by US, before the network. Never caused by the vendor.

    Separate from MarbleError so a caller cannot accidentally treat "you have
    no API key" or "that would spend 3500 credits you did not authorise" as a
    transient fault worth retrying.
    """


# ------------------------------------------------------------------- key

def load_api_key(env=None):
    """Return the API key or refuse. There is no anonymous mode.

    Fail-closed is the whole point: a pipeline that quietly degrades to "no
    key, so skip the call and report success" is how a founder finds out on a
    stream that nothing was ever generated.
    """
    env = os.environ if env is None else env
    key = (env.get(API_KEY_ENV) or "").strip()
    if not key:
        raise MarbleRefusal(
            "%s is not set. Marble is fail-closed: export the key in the shell "
            "that runs this, and never commit it.\n"
            "    export %s='...'   # from https://platform.worldlabs.ai\n"
            "Nothing was sent and nothing was charged."
            % (API_KEY_ENV, API_KEY_ENV))
    if len(key) < 8:
        raise MarbleRefusal(
            "%s is set but implausibly short (%d chars). Refusing to send it."
            % (API_KEY_ENV, len(key)))
    return key


def redact(text, key):
    """Remove the key from anything about to be printed or written to disk."""
    if not key or not text:
        return text
    return str(text).replace(key, "<%s>" % API_KEY_ENV)


# ------------------------------------------------------------------ client

class MarbleClient(object):
    def __init__(self, api_key=None, base_url=None, timeout=120.0, opener=None):
        self.api_key = api_key or load_api_key()
        self.base_url = (base_url or BASE_URL).rstrip("/")
        self.timeout = timeout
        # Injected in tests against a local stub. Production leaves it None and
        # gets urllib's default opener with system trust.
        self._opener = opener

    # -- transport ---------------------------------------------------------

    def _open(self, req):
        if self._opener is not None:
            return self._opener.open(req, timeout=self.timeout)
        return urllib.request.urlopen(req, timeout=self.timeout)

    def _request(self, method, path, body=None, retry_safe=False,
                 max_attempts=4, sleep=time.sleep):
        """One HTTP call.

        retry_safe: True ONLY for requests that cannot start billable work.
        A 429 is retried with Retry-After honoured even for unsafe requests,
        because a rate-limited request was never accepted (docs: rate limits
        apply to generation STARTS). Every other failure on an unsafe request
        is raised for a person to look at.
        """
        url = self.base_url + path
        data = None
        headers = {
            AUTH_HEADER: self.api_key,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if body is not None:
            data = json.dumps(body).encode("utf8")
            headers["Content-Type"] = "application/json"

        attempt = 0
        while True:
            attempt += 1
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with self._open(req) as resp:
                    raw = resp.read().decode("utf8", "replace")
                    if not raw:
                        return {}
                    try:
                        return json.loads(raw)
                    except ValueError:
                        raise MarbleError(
                            "%s %s returned non-JSON (%d bytes)" % (method, path, len(raw)),
                            code=getattr(resp, "status", None))
            except urllib.error.HTTPError as exc:
                payload = ""
                try:
                    payload = exc.read().decode("utf8", "replace")
                except Exception:
                    pass
                detail = _detail_of(payload)
                code = exc.code
                if code == 429 and attempt < max_attempts:
                    # `or` was wrong here: Retry-After: 0 is a real instruction
                    # ("go now"), and falsy, so it silently became exponential
                    # backoff. The server's number wins whenever it sent one.
                    hinted = _retry_after(exc.headers)
                    wait = hinted if hinted is not None else min(60.0, 2.0 ** attempt)
                    sleep(wait)
                    continue
                if code >= 500 and retry_safe and attempt < max_attempts:
                    sleep(min(30.0, 2.0 ** attempt))
                    continue
                raise MarbleError(_explain(code, detail, method, path),
                                  code=code, detail=detail)
            except urllib.error.URLError as exc:
                # A network fault on a READ can be retried; on a possible-bill
                # request it cannot, because we do not know whether the server
                # received it.
                if retry_safe and attempt < max_attempts:
                    sleep(min(30.0, 2.0 ** attempt))
                    continue
                raise MarbleError("network failure on %s %s: %s" % (method, path, exc.reason))

    # -- endpoints ---------------------------------------------------------

    def credits(self):
        """GET /marble/v1/credits -> remaining_credits (free call)."""
        body = self._request("GET", "/marble/v1/credits", retry_safe=True)
        if "remaining_credits" not in body:
            raise MarbleError("credits response had no remaining_credits: %r" % (body,))
        return int(body["remaining_credits"])

    def prepare_upload(self, file_name, kind, extension):
        """POST /marble/v1/media-assets:prepare_upload (free call)."""
        if kind not in ("image", "video"):
            raise MarbleRefusal("media kind must be image or video, got %r" % (kind,))
        return self._request("POST", "/marble/v1/media-assets:prepare_upload", {
            "file_name": file_name,
            "kind": kind,
            "extension": extension,
        }, retry_safe=True)

    def upload_media(self, upload_info, payload):
        """PUT the bytes to the signed URL from prepare_upload. Free."""
        url = upload_info.get("upload_url")
        if not url:
            raise MarbleError("prepare_upload returned no upload_url")
        method = (upload_info.get("upload_method") or "PUT").upper()
        headers = dict(upload_info.get("required_headers") or {})
        headers.setdefault("User-Agent", USER_AGENT)
        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with self._open(req) as resp:
                return getattr(resp, "status", 200)
        except urllib.error.HTTPError as exc:
            raise MarbleError("upload failed: HTTP %d" % exc.code, code=exc.code)
        except urllib.error.URLError as exc:
            raise MarbleError("upload failed: %s" % exc.reason)

    def generate(self, payload):
        """POST /marble/v1/worlds:generate — THE BILLABLE CALL.

        No retry_safe. If this raises, a person decides what happens next.
        """
        return self._request("POST", "/marble/v1/worlds:generate", payload,
                             retry_safe=False)

    def operation(self, operation_id):
        """GET /marble/v1/operations/{id} (free call)."""
        return self._request("GET", "/marble/v1/operations/%s"
                             % urllib.parse.quote(str(operation_id)), retry_safe=True)

    def world(self, world_id):
        """GET /marble/v1/worlds/{id} (free call)."""
        return self._request("GET", "/marble/v1/worlds/%s"
                             % urllib.parse.quote(str(world_id)), retry_safe=True)

    def export(self, world_id, asset_type, fmt, resolution=None, mesh_variant=None):
        """POST /marble/v1/worlds/{id}:export.

        splats/ply is free and synchronous. mesh/glb is 3500 credits and async.
        The COST GATE is in the pipeline, not here, so that a caller cannot get
        a billable export by reaching past a CLI flag into the client.
        """
        body = {"asset_type": asset_type, "format": fmt}
        if resolution:
            body["resolution"] = resolution
        if mesh_variant:
            body["mesh_variant"] = mesh_variant
        return self._request("POST", "/marble/v1/worlds/%s:export"
                             % urllib.parse.quote(str(world_id)), body,
                             retry_safe=False)


# ---------------------------------------------------------------- helpers

def _detail_of(payload):
    try:
        parsed = json.loads(payload)
    except Exception:
        return payload[:400] if payload else ""
    if isinstance(parsed, dict) and "detail" in parsed:
        return parsed["detail"]
    return parsed


def _retry_after(headers):
    try:
        value = headers.get("Retry-After")
    except Exception:
        return None
    if not value:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _explain(code, detail, method, path):
    """Turn a status code into the sentence a person needs. docs/api/errors.md."""
    known = {
        400: "the request was invalid, or the prompt violated content policy",
        401: "the API key was rejected",
        402: "INSUFFICIENT CREDITS — nothing was generated and nothing was charged",
        403: "this key is not permitted to do that",
        404: "no such resource for this key",
        422: "the request body did not match the schema",
        429: "rate limited (default tier is ~3 requests/min, 60/hour)",
    }
    head = known.get(code, "server error" if code and code >= 500 else "request failed")
    line = "%s %s -> HTTP %s: %s" % (method, path, code, head)
    if detail:
        line += "\n  detail: %s" % (json.dumps(detail)[:800]
                                    if not isinstance(detail, str) else detail[:800])
    if code and code >= 500 and path.endswith(":generate"):
        line += ("\n  NOT RETRIED. A 5xx on a generation start is ambiguous — the "
                 "server may already be generating. Check the dashboard or "
                 "`marble_cli.py worlds` before submitting again.")
    return line


def estimate_credits(model, prompt_type, is_pano=False):
    """(low, high) credits for one generation, or refuse if the combination
    is not in the published table. An unknown price is not an excuse to spend."""
    key_type = "image-pano" if (prompt_type == "image" and is_pano) else prompt_type
    key = (model, key_type)
    if key not in COST_TABLE:
        raise MarbleRefusal(
            "no published price for model=%s prompt=%s. Refusing to submit a "
            "generation whose cost this repo cannot state." % (model, key_type))
    return COST_TABLE[key]
