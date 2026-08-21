#!/usr/bin/env python3
"""Offline proof that Relay Dogs cannot get into Marble scenery by accident.

No network, no credits, no engine. Every case here is one that would otherwise
be discovered by paying for it.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dog_separation as sep                                     # noqa: E402

PASS, FAIL = [], []


def ok(msg):
    PASS.append(msg)
    print("  ok   %s" % msg)


def bad(msg):
    FAIL.append(msg)
    print("  FAIL %s" % msg)


def check(cond, msg):
    ok(msg) if cond else bad(msg)


def refuses(fn, *needles):
    try:
        fn()
    except sep.DogSeparationRefusal as exc:
        text = str(exc)
        missing = [n for n in needles if n not in text]
        return (not missing), text, missing
    return False, "<no refusal>", list(needles)


def make_world(root, name, body, dogs=False):
    """An image on disk plus an attestation that matches it."""
    ref = os.path.join(root, "reference")
    os.makedirs(ref, exist_ok=True)
    path = os.path.join(ref, name)
    io.open(path, "wb").write(body)
    # MERGE, never overwrite. The first version of this helper replaced the
    # registry each call, so adding a second fixture silently un-attested the
    # first — and the "bytes changed" test then passed for the wrong reason,
    # refusing with "not listed" instead of "has CHANGED".
    reg_path = os.path.join(ref, "ATTESTED.json")
    reg = {"schema": "wonderland.marble.reference-attestation/1", "images": {}}
    if os.path.exists(reg_path):
        reg = json.load(io.open(reg_path, encoding="utf8"))
        reg.setdefault("images", {})
    reg["images"][name] = {
        "sha256": sep.sha256_of(path), "relay_dogs_present": dogs,
        "attested_by": "the test", "attested_at": "2026-08-21",
        "how": "a fixture"}
    json.dump(reg, io.open(reg_path, "w", encoding="utf8"))
    return path, reg_path


def spec_for(name, text="a pale stone plaza and a gold gate"):
    return {"slug": "fixture", "display_name": "F", "model": "marble-1.1",
            "reference_image": os.path.join("reference", name),
            "world_prompt": {"type": "image", "text_prompt": text,
                             "image_prompt": {"source": "media_asset",
                                              "media_asset_id": "id"}}}


def main():
    root = tempfile.mkdtemp(prefix="dogsep-")
    try:
        print("-- the image is the thing that has to be attested --")
        path, reg = make_world(root, "clean.jpg", b"\xff\xd8clean")
        got = sep.check_spec(spec_for("clean.jpg"), root, reg)
        check(got["reference_sha256"] == sep.sha256_of(path),
              "an attested dog-free image passes, and the hash is recorded")

        dpath, dreg = make_world(root, "dogs.jpg", b"\xff\xd8dogs", dogs=True)
        good, text, missing = refuses(
            lambda: sep.check_spec(spec_for("dogs.jpg"), root, dreg),
            "1,580 credits", "Nothing was submitted")
        check(good, "an image attested as CONTAINING Dogs is refused, with the bill named")

        good, text, missing = refuses(
            lambda: sep.check_spec(spec_for("never-seen.jpg"), root, reg),
            "not listed", "assumed innocent")
        check(good, "an UNLISTED image is refused rather than assumed innocent")

        io.open(path, "wb").write(b"\xff\xd8changed")
        good, text, missing = refuses(
            lambda: sep.check_spec(spec_for("clean.jpg"), root, reg),
            "has CHANGED", "no longer there")
        check(good, "an attestation whose bytes changed is refused, naming both hashes")
        io.open(path, "wb").write(b"\xff\xd8clean")

        os.remove(os.path.join(root, "reference", "ATTESTED.json"))
        good, text, missing = refuses(
            lambda: sep.check_spec(spec_for("clean.jpg"), root, reg),
            "no reference attestation")
        check(good, "a missing registry refuses instead of allowing everything")
        make_world(root, "clean.jpg", b"\xff\xd8clean")

        print("\n-- the text, and only where it ASKS --")
        good, _, _ = refuses(
            lambda: sep.check_spec(spec_for("clean.jpg", "a plaza with small dogs"), root, reg),
            "ASKS for", "dogs")
        check(good, "a text prompt that asks for a dog is refused")
        got = sep.check_spec(
            spec_for("clean.jpg", "a plaza. NO characters, NO dogs, NO creatures."), root, reg)
        check(got["negated_creature_words"] == ["characters", "creatures", "dogs"],
              "a NEGATED mention is allowed through and listed")
        check(got["negations_are_inert"] is True,
              "…and flagged inert, because the evidence says the words did nothing")
        # THE REGRESSION THIS PROTECTS. The first version of this gate refused
        # the ACCEPTED spec — the one that produced ae83acaa dog-free — because
        # its prompt says NO DOGS. A gate that rejects the known-good input is
        # not a strict gate, it is a wrong one.
        got = sep.check_spec(
            spec_for("clean.jpg",
                     "volumetric light through the arch. NO characters, NO people, "
                     "NO animals, NO dogs, NO creatures of any kind — the garden is empty."),
            root, reg)
        check(got["checked"], "the real accepted prompt's phrasing is NOT refused")

        for word, phrase in (("catalogue", "a stone catalogue of arches"),
                             ("background", "a pale background of spires"),
                             ("scatter", "petals scatter across the flagstones")):
            try:
                sep.check_spec(spec_for("clean.jpg", phrase), root, reg)
                ok("'%s' is not mistaken for a creature" % word)
            except sep.DogSeparationRefusal as exc:
                bad("'%s' tripped the creature check: %s" % (word, exc))

        print("\n-- it runs BEFORE anything is spent --")
        # The order is the whole point: a refusal after the intent file is
        # written or after the socket is open has already cost something.
        src = io.open(os.path.join(HERE, "marble_pipeline.py"), encoding="utf8").read()
        body = src.split("def submit(", 1)[1]
        at_sep = body.find("dog_sep.check_spec")
        at_estimate = body.find("estimate_for(spec)")
        at_intent = body.find("_write_json")
        check(at_sep >= 0, "submit() calls the separation gate at all")
        check(at_sep < at_estimate,
              "…before the price is even estimated")
        check(at_intent < 0 or at_sep < at_intent,
              "…and before the intent file is written")
        check("guard 0" in body[:at_estimate],
              "…and it is labelled guard 0, ahead of the money guards")

        print("\n-- the real registry describes the real files --")
        real = json.load(io.open(os.path.join(HERE, "reference", "ATTESTED.json"),
                                 encoding="utf8"))
        for name, entry in (real.get("images") or {}).items():
            disk = os.path.join(HERE, "reference", name)
            if not os.path.exists(disk):
                bad("%s is attested but not on disk" % name)
                continue
            check(sep.sha256_of(disk) == entry["sha256"],
                  "%s hashes to what is attested" % name)
        full = (real.get("images") or {}).get("wonderland-reference.jpg") or {}
        check(full.get("relay_dogs_present") is True,
              "the founder's full reference is listed as CONTAINING Dogs, so it is refused")
        check(sep.check_spec(
            json.load(io.open(os.path.join(HERE, "prompts",
                                           "royal-garden-backdrop.json"),
                              encoding="utf8")), HERE)["checked"],
              "the shipped Royal Garden spec passes the gate")
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    if FAIL:
        return 1
    print("\nWhat this does NOT prove: that a generated world contains no Dogs.")
    print("That needs eyes on the output. This only makes it much harder to pay")
    print("to find out.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
