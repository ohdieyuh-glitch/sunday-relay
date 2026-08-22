#!/usr/bin/env python3
"""Keep Relay Dogs OUT of Marble scenery, before a paid generation, not after.

THE FAILURE THIS EXISTS FOR

Generation 47928d7e cost 1,580 credits and was thrown away because Marble
reproduced the Relay Dogs out of the reference image. The text prompt said not
to. Image conditioning beat the negative — which is not a surprise once you see
it, and is the reason a second "please don't" would not have helped either.

The repair was to crop the reference above the dog band. But a repair that lives
in one JSON file is a repair that holds until someone points the spec at the
full reference again, and the only thing that would have stopped them was a
sentence in a comment.

WHAT IS ACTUALLY CHECKED

Two things, and only things that can be known:

  1. THE IMAGE. It must be listed in reference/ATTESTED.json as dog-free, and
     its bytes must still hash to what was attested. Nothing here can look at a
     picture and decide; this records that a person did, which file, and when.
     An unlisted image is refused — not assumed innocent — because the failure
     mode is silent and expensive.

  2. THE TEXT, and only where it ASKS for something. A Marble world_prompt's
     text describes what to BUILD, so an un-negated "dog" in it is a request and
     is refused. A NEGATED one — "NO dogs, NO creatures of any kind" — is not,
     and refusing it would have been wrong: the accepted generation ae83acaa
     carries exactly that phrasing and came back dog-free, while the rejected
     47928d7e carried the same phrasing and came back full of Dogs. The variable
     was the image, both times. So a negation is allowed through and reported as
     what the evidence says it is: inert. It is not protection, and anyone
     reading this should not believe it is.

WHAT IS NOT CHECKED, AND MUST NOT BE CLAIMED

Whether the generated world contains Dogs. That needs eyes on the output, and
the founder's visual review is where it happens. This gate reduces the chance of
paying to find out; it does not detect.
"""
import hashlib
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
ATTESTATION = os.path.join(HERE, "reference", "ATTESTED.json")

# Words that ASK for a creature. Deliberately narrow: this refuses a paid
# generation, so a false positive costs a person a minute and a false negative
# costs 1,580 credits — but a list broad enough to catch "figure" would refuse
# every architectural prompt, and a gate that cries wolf gets switched off.
CREATURE_WORDS = (
    "dog", "dogs", "puppy", "puppies", "corgi", "shiba", "husky",
    "cat", "cats", "kitten", "fox", "wolf", "lion", "tiger", "monkey",
    "creature", "creatures", "animal", "animals", "pet", "pets",
    "character", "characters", "mascot", "figurine", "figurines",
)


# A MarbleRefusal, not a bare Exception. The CLI catches MarbleRefusal and turns
# it into a clean refusal with the right exit code; a sibling exception type
# escapes that handler as an unhandled traceback, so the one guard that stands
# between a bad reference image and 1,580 credits would have reported itself as
# a crash.
try:
    from marble_api import MarbleRefusal as _Base
except Exception:                        # importable without the client present
    _Base = Exception


class DogSeparationRefusal(_Base):
    """Raised INSTEAD of spending credits."""


def sha256_of(path):
    digest = hashlib.sha256()
    with io.open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_attestation(path=None):
    path = path or ATTESTATION
    if not os.path.exists(path):
        raise DogSeparationRefusal(
            "no reference attestation at %s. Every image that conditions a paid "
            "generation has to be listed there as dog-free. Nothing was "
            "submitted." % path)
    with io.open(path, encoding="utf8") as handle:
        return json.load(handle), path


def check_image(rel_path, root, attestation_path=None):
    """Refuse unless this exact file is attested dog-free."""
    registry, reg_path = load_attestation(attestation_path)
    images = registry.get("images") or {}
    name = os.path.basename(rel_path)
    entry = images.get(name)
    if entry is None:
        raise DogSeparationRefusal(
            "%s is not listed in %s.\n"
            "An image that conditions a paid Marble generation must be attested "
            "dog-free first — an unlisted image is refused rather than assumed "
            "innocent, because the failure is silent and costs credits. Add an "
            "entry recording who looked at it and what they saw.\n"
            "Nothing was submitted." % (name, reg_path))
    full = os.path.join(root, rel_path) if not os.path.isabs(rel_path) else rel_path
    if not os.path.exists(full):
        raise DogSeparationRefusal(
            "%s is attested but is not on disk at %s. Nothing was submitted."
            % (name, full))
    actual = sha256_of(full)
    if actual != entry.get("sha256"):
        raise DogSeparationRefusal(
            "%s has CHANGED since it was attested.\n"
            "  attested %s\n  on disk  %s\n"
            "The attestation describes bytes that are no longer there, so it "
            "proves nothing about this file. Look at the image again and update "
            "the entry. Nothing was submitted."
            % (name, entry.get("sha256"), actual))
    if entry.get("relay_dogs_present"):
        raise DogSeparationRefusal(
            "%s is attested as CONTAINING Relay Dogs, and must never condition a "
            "generation.\n  %s\n"
            "Marble supplies the backdrop; the Dogs are authored Unreal assets "
            "placed after and over it. What Marble copies out of a reference "
            "becomes unremovable scenery — this exact image already cost 1,580 "
            "credits that way. Crop above the dog band and attest the crop.\n"
            "Nothing was submitted." % (name, entry.get("how") or ""))
    return entry


# What turns a creature word into an exclusion rather than a request. Checked
# in the words immediately before it, because "NO dogs" and "a garden of dogs"
# differ only there.
NEGATORS = ("no", "not", "never", "without", "zero", "excluding", "exclude",
            "free", "absent", "devoid", "minus", "avoid")
NEGATION_WINDOW = 3          # words


def _negated(words, index):
    """Is the creature word at `index` preceded by a negator within the window?"""
    start = max(0, index - NEGATION_WINDOW)
    return any(w.strip(",.;:—-'\"") in NEGATORS for w in words[start:index])


def check_text(text):
    """Refuse a creature the text ASKS for. Report a negated one as inert.

    Returns the list of negated mentions, so a caller can say out loud that they
    are not doing anything.
    """
    if not text:
        return []
    words = text.lower().replace("\n", " ").split()
    stripped = [w.strip(",.;:!?—-()'\"") for w in words]
    requested, negated = [], []
    for index, word in enumerate(stripped):
        if word not in CREATURE_WORDS:
            continue
        (negated if _negated(stripped, index) else requested).append(word)
    if requested:
        raise DogSeparationRefusal(
            "the text prompt ASKS for %s.\n"
            "Marble's text describes what to BUILD, so naming a creature there "
            "requests one. Marble supplies the backdrop; Relay Dogs are authored "
            "Unreal assets placed after and over it.\n"
            "Nothing was submitted." % ", ".join(sorted(set(requested))))
    return sorted(set(negated))


def check_spec(spec, root, attestation_path=None):
    """Every check, in the order that costs least to fail. Returns a record."""
    prompt = spec.get("world_prompt") or {}
    negated = check_text(prompt.get("text_prompt"))
    image_rel = spec.get("reference_image")
    entry = None
    if prompt.get("type") in ("image", "multi-image"):
        if not image_rel:
            raise DogSeparationRefusal(
                "world_prompt.type is %r but the spec names no reference_image, "
                "so there is nothing to attest. Nothing was submitted."
                % prompt.get("type"))
        entry = check_image(image_rel, root, attestation_path)
    return {
        "checked": True,
        "reference_image": image_rel,
        "reference_sha256": (entry or {}).get("sha256"),
        "attested_by": (entry or {}).get("attested_by"),
        "text_asked_for_no_creature": True,
        # Recorded, not celebrated. Both 47928d7e (rejected, full of Dogs) and
        # ae83acaa (accepted, dog-free) carried these same exclusions; the image
        # was the variable. They are in the manifest so nobody later reads the
        # prompt and concludes the words were what protected the world.
        "negated_creature_words": negated,
        "negations_are_inert": bool(negated),
    }
