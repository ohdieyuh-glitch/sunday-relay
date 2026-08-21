#!/usr/bin/env python3
"""Marble from the command line. The only place a paid call can be started.

    python3 marble_cli.py credits
    python3 marble_cli.py plan     prompts/royal-garden.json
    python3 marble_cli.py submit   prompts/royal-garden.json --confirm-credits 1580
    python3 marble_cli.py poll     royal-garden
    python3 marble_cli.py fetch    royal-garden
    python3 marble_cli.py export   royal-garden --asset-type splats --format ply
    python3 marble_cli.py export   royal-garden --asset-type mesh --format glb \
                                   --confirm-credits 3500
    python3 marble_cli.py status   royal-garden
    python3 marble_cli.py verify   royal-garden

`plan` touches no network and needs no key: it prints the exact request body
and the price. Read it before spending anything.

Exit codes: 0 success · 2 our refusal (nothing sent) · 3 vendor/API error.
Refusals and errors are different exits on purpose — a CI step must be able to
tell "you did not authorise this" from "the vendor said no".
"""
import argparse
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import manifest as manifest_mod            # noqa: E402
import marble_pipeline as pipeline         # noqa: E402
from marble_api import (                    # noqa: E402
    EXPORT_COST, MarbleClient, MarbleError, MarbleRefusal, load_api_key,
)

EXIT_OK, EXIT_REFUSED, EXIT_ERROR = 0, 2, 3


def _client():
    return MarbleClient(api_key=load_api_key())


def cmd_credits(args):
    print("remaining credits: %d" % _client().credits())
    return EXIT_OK


def cmd_upload_reference(args):
    """Upload the founder's reference image. FREE — charges no credits."""
    asset_id = pipeline.upload_reference(args.spec, client=_client())
    print("media_asset_id: %s" % asset_id)
    print("the spec now carries it; `plan` will show the real request body.")
    return EXIT_OK


def cmd_plan(args):
    """No network, no key, no spend. What WOULD be sent, and what it WOULD cost."""
    spec = pipeline.load_spec(args.spec)
    pipeline.resolve_prompt(spec, args.spec)
    body = pipeline.build_request(spec)
    low, high = pipeline.estimate_for(spec)
    print("slug:        %s" % spec["slug"])
    print("model:       %s" % spec["model"])
    print("prompt type: %s" % body["world_prompt"]["type"])
    print("ESTIMATE:    %d-%d credits   (docs.worldlabs.ai/api/pricing.md)" % (low, high))
    print("world dir:   %s" % pipeline.world_dir(spec["slug"]))
    print("\n--- request body that would be POSTed to /marble/v1/worlds:generate ---")
    print(json.dumps(body, indent=2, ensure_ascii=False))
    intent = os.path.join(pipeline.world_dir(spec["slug"]), "intent.json")
    if os.path.exists(intent):
        print("\nNOTE: %s already exists — `submit` will refuse unless the prompt "
              "changed or --force-new-generation is passed." % intent)
    print("\nNothing was sent. To spend: submit %s --confirm-credits %d"
          % (args.spec, high))
    return EXIT_OK


def cmd_submit(args):
    spec = pipeline.load_spec(args.spec)
    pipeline.resolve_prompt(spec, args.spec)
    operation = pipeline.submit(
        spec,
        confirm_credits=args.confirm_credits,
        client=_client(),
        force_new=args.force_new_generation,
        check_balance=not args.skip_balance_check,
    )
    print("submitted. operation_id: %s" % operation.get("operation_id"))
    print("poll it with:  python3 %s poll %s" % (os.path.basename(__file__), spec["slug"]))
    return EXIT_OK


def cmd_poll(args):
    man = pipeline.poll(args.slug, client=_client(), once=args.once,
                        interval=args.interval)
    if man is None:
        print("not finished yet — polling is free, run it again.")
    return EXIT_OK


def cmd_fetch(args):
    pipeline.fetch(args.slug)
    print("done — all downloads were free.")
    return EXIT_OK


def cmd_export(args):
    price = EXPORT_COST.get((args.asset_type, args.format))
    pipeline.export(args.slug, args.asset_type, args.format,
                    client=_client(), confirm_credits=args.confirm_credits,
                    resolution=args.resolution, mesh_variant=args.mesh_variant)
    print("export recorded (%s credits)." % ("free" if price == 0 else price))
    return EXIT_OK


def cmd_status(args):
    wdir = pipeline.world_dir(args.slug)
    if not os.path.isdir(wdir):
        print("no local record of %r at %s" % (args.slug, wdir))
        return EXIT_REFUSED
    for name in ("spec.json", "intent.json", "operation.json", "manifest.json"):
        path = os.path.join(wdir, name)
        print("%-16s %s" % (name, "present" if os.path.exists(path) else "-"))
    intent = pipeline._read_json(os.path.join(wdir, "intent.json"))
    if intent:
        print("\nsubmitted_at: %s" % intent.get("submitted_at"))
        print("operation_id: %s" % intent.get("operation_id"))
        print("outcome:      %s" % intent.get("outcome"))
        print("confirmed:    %s credits" % intent.get("confirmed_credits"))
    man = pipeline._read_json(os.path.join(wdir, "manifest.json"))
    if man:
        print("\nworld_id:     %s" % man.get("marble_world_id"))
        print("charged:      %s credits" % (man.get("cost") or {}).get("total_credits"))
        got = (man.get("assets") or {}).get("downloaded") or {}
        print("downloaded:   %d files" % len(got))
        for key, info in sorted(got.items()):
            print("   %-22s %s" % (key, info.get("path")))
        for entry in man.get("exports") or []:
            print("export:       %s/%s -> %s (%s credits)"
                  % (entry.get("asset_type"), entry.get("format"),
                     entry.get("local_path"), entry.get("credits")))
    return EXIT_OK


def cmd_verify(args):
    """Is the local record complete and do the files it names exist?"""
    wdir = pipeline.world_dir(args.slug)
    path = os.path.join(wdir, "manifest.json")
    man = pipeline._read_json(path)
    if not man:
        print("FAIL no manifest at %s" % path)
        return EXIT_REFUSED
    problems = manifest_mod.validate(man)
    for entry in (man.get("assets") or {}).get("downloaded", {}).values():
        local = os.path.join(wdir, entry.get("path") or "")
        if not os.path.exists(local):
            problems.append("manifest names a downloaded file that is gone: %s" % local)
        elif entry.get("bytes") and os.path.getsize(local) != entry["bytes"]:
            problems.append("size mismatch for %s: manifest %d, disk %d"
                            % (local, entry["bytes"], os.path.getsize(local)))
    if problems:
        print("FAIL %d problem(s):" % len(problems))
        for problem in problems:
            print("  - %s" % problem)
        return EXIT_REFUSED
    print("OK   manifest complete, every recorded file present")
    print("     world %s, %s credits, %d downloaded asset(s)"
          % (man["marble_world_id"], (man.get("cost") or {}).get("total_credits"),
             len((man.get("assets") or {}).get("downloaded") or {})))
    return EXIT_OK


def build_parser():
    parser = argparse.ArgumentParser(
        prog="marble_cli.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = parser.add_subparsers(dest="command")

    subs.add_parser("credits", help="remaining credits (free)").set_defaults(fn=cmd_credits)

    upload = subs.add_parser("upload-reference",
                             help="upload the spec's reference image (free)")
    upload.add_argument("spec")
    upload.set_defaults(fn=cmd_upload_reference)

    plan = subs.add_parser("plan", help="print the request body and price; no network")
    plan.add_argument("spec")
    plan.set_defaults(fn=cmd_plan)

    submit = subs.add_parser("submit", help="START A PAID GENERATION")
    submit.add_argument("spec")
    submit.add_argument("--confirm-credits", type=int, default=None,
                        help="the price you authorise; must cover the upper estimate")
    submit.add_argument("--force-new-generation", action="store_true",
                        help="pay again for a slug that already has an intent record")
    submit.add_argument("--skip-balance-check", action="store_true",
                        help="do not call /credits first (not recommended)")
    submit.set_defaults(fn=cmd_submit)

    poll = subs.add_parser("poll", help="poll the operation (free)")
    poll.add_argument("slug")
    poll.add_argument("--once", action="store_true")
    poll.add_argument("--interval", type=float, default=None)
    poll.set_defaults(fn=cmd_poll)

    fetch = subs.add_parser("fetch", help="download every free asset")
    fetch.add_argument("slug")
    fetch.set_defaults(fn=cmd_fetch)

    export = subs.add_parser("export", help="export splats (free) or HQ mesh (paid)")
    export.add_argument("slug")
    export.add_argument("--asset-type", choices=("splats", "mesh"), required=True)
    export.add_argument("--format", choices=("ply", "glb"), required=True)
    export.add_argument("--resolution", choices=("full_res", "500k", "150k", "100k"))
    export.add_argument("--mesh-variant", choices=("textured", "vertex_colored"))
    export.add_argument("--confirm-credits", type=int, default=None)
    export.set_defaults(fn=cmd_export)

    status = subs.add_parser("status", help="local record for a slug")
    status.add_argument("slug")
    status.set_defaults(fn=cmd_status)

    verify = subs.add_parser("verify", help="manifest completeness + files on disk")
    verify.add_argument("slug")
    verify.set_defaults(fn=cmd_verify)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "fn", None):
        parser.print_help()
        return EXIT_REFUSED
    try:
        return args.fn(args)
    except MarbleRefusal as exc:
        sys.stderr.write("REFUSED: %s\n" % exc)
        return EXIT_REFUSED
    except MarbleError as exc:
        sys.stderr.write("API ERROR: %s\n" % exc)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
