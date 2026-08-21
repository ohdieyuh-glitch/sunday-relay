#!/usr/bin/env python3
"""The record of a generated Marble world — the only durable claim about it.

A generated world is a paid artefact that arrives as a bag of signed URLs
which EXPIRE. Six weeks later the question "what is this mesh, what did it
cost, what was it made from, and where does it belong in the level" has
exactly one place to be answered, and this is it.

Everything the founder asked a manifest to carry is a REQUIRED field, and
`validate()` refuses a manifest that omits one. Fields whose value the vendor
does not supply are recorded explicitly as unavailable rather than dropped:
"the API does not return licence metadata" is a fact worth keeping, and a
missing key reads identically to a forgotten one.

Coordinates: Marble reports metres, Unreal counts centimetres. The conversion
is stored, not assumed, because a scale that lives only in someone's head is
how a plaza arrives at 1/100th size and gets diagnosed as a broken import.
"""
import copy
import hashlib
import io
import json
import os

SCHEMA_VERSION = "wonderland.marble.manifest/1"

# Every one of these must be present. Several may be the string "unavailable"
# or null with a reason, but the KEY is never absent.
REQUIRED = (
    "schema_version",
    "marble_world_id",
    "display_name",
    "source_reference",
    "prompt",
    "model",
    "generated_at",
    "operation_id",
    "cost",
    "assets",
    "exports",
    "transform",
    "bounds",
    "collision_source",
    "unreal_destination",
    "licence",
)

UNAVAILABLE = "unavailable: the World API does not return this field"


def new(world_id, display_name, prompt, model, operation_id,
        source_reference, generated_at):
    """A manifest skeleton with every required key present."""
    return {
        "schema_version": SCHEMA_VERSION,
        "marble_world_id": world_id,
        "display_name": display_name,
        "operation_id": operation_id,
        # The exact request body that produced this world, minus nothing. It is
        # what makes a regeneration a comparison rather than a new experiment.
        "prompt": copy.deepcopy(prompt),
        "prompt_sha256": prompt_hash(prompt),
        "source_reference": source_reference,
        "model": model,
        "generated_at": generated_at,
        "cost": {
            "total_credits": None,
            "line_items": [],
            "note": "authoritative value copied from operation.cost when done",
        },
        "assets": {
            "caption": None,
            "thumbnail_url": None,
            "pano_url": None,
            "full_res_mesh_url": None,
            "hq_mesh_url": None,
            "collider_mesh_url": None,
            "splat_spz_urls": {},
            "world_marble_url": None,
            "downloaded": {},
            "url_note": ("Marble asset URLs are signed and expire. `downloaded` "
                         "holds the local paths, which do not."),
        },
        "exports": [],
        "transform": {
            "metric_scale_factor": None,
            "ground_plane_offset_m": None,
            "unreal_uniform_scale": None,
            "unreal_origin_cm": [0.0, 0.0, 0.0],
            "unreal_rotation_deg": [0.0, 0.0, 0.0],
            "axis_note": ("glTF is Y-up right-handed; Unreal is Z-up left-handed. "
                          "Interchange applies the conversion on import; "
                          "unreal_rotation_deg is the ARTISTIC yaw on top of it."),
        },
        "bounds": {
            "source": None,
            "min_cm": None,
            "max_cm": None,
        },
        "collision_source": {
            "authority": "unreal",
            "detail": ("Marble geometry is imported NoCollision. Gameplay collision "
                       "and navigation stay native Unreal — see MARBLE.md."),
            "collider_mesh_used_as": "reference only unless explicitly promoted",
        },
        "unreal_destination": {
            "content_path": None,
            "level": None,
            "actor_label": None,
        },
        "licence": {
            "commercial_use": UNAVAILABLE,
            "terms_url": "https://www.worldlabs.ai/terms",
            "checked_at": None,
            "note": ("The World object schema carries no licence fields. Commercial "
                     "terms must be read from the vendor's terms of service and "
                     "recorded here by a person."),
        },
    }


def prompt_hash(prompt):
    """Stable hash of a world prompt. The double-spend guard keys on this."""
    blob = json.dumps(prompt, sort_keys=True, separators=(",", ":")).encode("utf8")
    return hashlib.sha256(blob).hexdigest()


def apply_world(man, world):
    """Fold a GET /worlds/{id} response into the manifest."""
    assets = (world or {}).get("assets") or {}
    mesh = assets.get("mesh") or {}
    splats = assets.get("splats") or {}
    imagery = assets.get("imagery") or {}
    semantics = splats.get("semantics_metadata") or {}

    man["assets"]["caption"] = assets.get("caption")
    man["assets"]["thumbnail_url"] = assets.get("thumbnail_url")
    man["assets"]["pano_url"] = imagery.get("pano_url")
    man["assets"]["full_res_mesh_url"] = mesh.get("full_res_mesh_url")
    man["assets"]["hq_mesh_url"] = mesh.get("hq_mesh_url")
    man["assets"]["collider_mesh_url"] = mesh.get("collider_mesh_url")
    man["assets"]["splat_spz_urls"] = splats.get("spz_urls") or {}
    man["assets"]["world_marble_url"] = world.get("world_marble_url")
    if world.get("model"):
        man["model"] = world["model"]
    if world.get("updated_at"):
        man["world_updated_at"] = world["updated_at"]

    scale = semantics.get("metric_scale_factor")
    man["transform"]["metric_scale_factor"] = scale
    man["transform"]["ground_plane_offset_m"] = semantics.get("ground_plane_offset")
    # Marble metres -> Unreal centimetres. Stated as an equation in the file so
    # nobody has to re-derive it at 2am on a GPU box.
    if isinstance(scale, (int, float)) and scale > 0:
        man["transform"]["unreal_uniform_scale"] = float(scale) * 100.0
    return man


def apply_cost(man, operation):
    """Copy the AUTHORITATIVE cost off a completed operation."""
    cost = (operation or {}).get("cost")
    if not cost:
        man["cost"]["note"] = ("operation completed without a cost object; the "
                               "vendor did not report a charge for this call")
        return man
    man["cost"]["total_credits"] = cost.get("total_credits")
    man["cost"]["line_items"] = cost.get("line_items") or []
    man["cost"]["note"] = "reported by the API on the completed operation"
    return man


def record_export(man, asset_type, fmt, url, local_path, credits, extra=None):
    entry = {
        "asset_type": asset_type,
        "format": fmt,
        "url_expires": bool(url),
        "local_path": local_path,
        "credits": credits,
    }
    if extra:
        entry.update(extra)
    man["exports"].append(entry)
    return man


def validate(man):
    """Return a list of problems. Empty list means the manifest is complete."""
    problems = []
    if not isinstance(man, dict):
        return ["manifest is not an object"]
    for key in REQUIRED:
        if key not in man:
            problems.append("missing required field: %s" % key)
    if man.get("schema_version") != SCHEMA_VERSION:
        problems.append("schema_version is %r, expected %r"
                        % (man.get("schema_version"), SCHEMA_VERSION))
    if not man.get("marble_world_id"):
        problems.append("marble_world_id is empty — this manifest describes no world")
    src = man.get("source_reference") or {}
    if not src.get("kind"):
        problems.append("source_reference.kind is empty")
    collision = man.get("collision_source") or {}
    if collision.get("authority") != "unreal":
        problems.append(
            "collision_source.authority is %r. Marble geometry must never be the "
            "collision authority without evidence; see MARBLE.md."
            % (collision.get("authority"),))
    return problems


def write(path, man):
    problems = validate(man)
    if problems:
        raise ValueError("refusing to write an incomplete manifest:\n  - %s"
                         % "\n  - ".join(problems))
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with io.open(path, "w", encoding="utf8") as handle:
        json.dump(man, handle, indent=2, sort_keys=False, ensure_ascii=False)
        handle.write("\n")
    return path


def read(path):
    with io.open(path, encoding="utf8") as handle:
        return json.load(handle)
