# DOES THE CONVERTED MAP ACTUALLY STREAM?
#
# LEDGER ROW H, BLOCKING since it was written: "Confirmed in-engine: world_partition: None, runtime grid
# {'None': 20858}. Despite the _WP2 in its name this map is not partitioned -- every actor is permanently
# resident and nothing streams at any distance."
#
# WorldPartitionConvertCommandlet was run with -ConversionSuffix, which produces a NEW map and leaves the
# authoritative one alone. That matters here more than it usually would: Content is a junction shared by
# every worktree on this machine, so converting in place would have changed the map under every other
# session at once. The original is untouched at 46,151,953 bytes; the converted twin is 13,416 bytes with
# 21,047 external actor files beside it, which is what a partitioned map looks like.
#
# This asks BOTH maps the same question, so the answer is a comparison rather than an assertion.
import os

import unreal

ORIGINAL = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
CONVERTED = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2_WP"


def look(path):
    """Whether this map is partitioned, measured by its SHAPE ON DISK rather than by an API.

    THE API WAS TRIED FIRST AND IS NOT TRUSTWORTHY HERE. `world.get_editor_property("world_partition")`
    raises "Failed to find property" on a UWorld in this build, and
    `WorldPartitionBlueprintLibrary.is_world_partitioned()` on a merely LOADED (not open) world returned
    True for both maps -- including the 46 MB monolith the ledger already measured as unpartitioned. A
    reading that says the same thing about two maps that are obviously different is not a reading.

    The disk shape is unambiguous and needs no API. A partitioned map is a small stub package whose actors
    live in __ExternalActors__ beside it; an unpartitioned one carries every actor inline. 46,151,953 bytes
    with no external actors, against 13,416 bytes with 21,047 of them, is not a close call.
    """
    out = {"package": path, "exists": bool(unreal.EditorAssetLibrary.does_asset_exist(path))}
    if not out["exists"]:
        return out
    world = unreal.load_asset(path)
    out["loaded"] = world is not None

    name = path.rsplit("/", 1)[-1]
    content = os.path.join(unreal.Paths.project_content_dir())
    umap = os.path.join(content, "WonderlandV2", "Maps", name + ".umap")
    out["umap_bytes"] = os.path.getsize(umap) if os.path.exists(umap) else None

    ext = os.path.join(content, "__ExternalActors__", "WonderlandV2", "Maps", name)
    n = 0
    for root, _dirs, files in os.walk(ext):
        n += sum(1 for f in files if f.endswith(".uasset"))
    out["external_actors"] = n

    # A stub package with thousands of external actors beside it IS a partitioned map; a multi-megabyte
    # package with none is not.
    out["is_partitioned"] = bool(n > 100 and (out["umap_bytes"] or 0) < 1000000)
    return out


def job():
    RESULT["status"] = "running"
    RESULT["original"] = look(ORIGINAL)
    RESULT["converted"] = look(CONVERTED)

    a = RESULT["original"]
    b = RESULT["converted"]
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    record("H01", "the converted map exists on disk and loads", b.get("exists") and b.get("loaded"),
           package=CONVERTED)
    record("H02", "the converted map IS partitioned, which the authoritative one is not",
           bool(b.get("is_partitioned")) and not bool(a.get("is_partitioned")),
           converted_umap_bytes=b.get("umap_bytes"), converted_external_actors=b.get("external_actors"),
           original_umap_bytes=a.get("umap_bytes"), original_external_actors=a.get("external_actors"))
    record("H03", "the authoritative map is untouched -- still unpartitioned, still the one in use",
           a.get("exists") and a.get("loaded") and not bool(a.get("is_partitioned")),
           umap_bytes=a.get("umap_bytes"), external_actors=a.get("external_actors"))

    RESULT["status"] = "measured"
    yield 0.1
