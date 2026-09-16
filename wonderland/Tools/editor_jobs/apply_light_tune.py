# Editor job: set properties on the world's named light components, reversibly (LOOK02 onward).
#
# apply_look.py knows four actors -- the post-process volume, the sun, the sky light and the atmosphere -- and nothing
# else. The unshadowed FILL lights are what colour every shaded surface in the world, and they were outside its reach.
# This job takes any light by actor label and any property on its component, in the same discipline as apply_look:
# every value it writes has a recorded before, it refuses to write over a value that is not the recorded before
# (someone changed it since), and REVERT puts the befores back. SAVE = False previews in memory.
#
# Colours: a light's `light_color` is an 8-bit FColor, so give [r, g, b] in 0..255; any other colour property
# (`lower_hemisphere_color`, fog colours) is a LinearColor, so give [r, g, b] in 0..1.
# Not only lights (AP01): an entry may name its "component" class -- SkyAtmosphereComponent, ExponentialHeightFogComponent
# -- and the same before/after discipline applies to the atmosphere and the fog.
# Globals: SPEC (path to a Look JSON with a "lights" section), REVERT, SAVE.
import json

SPEC = globals().get("SPEC")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", True)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
BYTE_COLOURS = ("light_color",)


def _same(a, b):
    if isinstance(a, (list, tuple)):
        return all(abs(float(x) - float(y)) < 1.5e-2 * (255.0 if abs(float(y)) > 1.5 else 1.0) for x, y in zip(a, b))
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    return abs(float(a) - float(b)) < 1e-3


def _read(comp, prop):
    v = comp.get_editor_property(prop)
    if hasattr(v, "r"):
        return [v.r, v.g, v.b]
    return v


def _write(comp, prop, value):
    if isinstance(value, (list, tuple)):
        if prop in BYTE_COLOURS:
            # KEYWORDS, NEVER POSITIONAL. FColor is laid out BGRA, and unreal.Color's positional arguments follow
            # that layout: Color(255, 226, 196) is BLUE, not warm. LOOK02's first attempt wrote exactly that and
            # made every shadow in the world bluer while the spec said warmer; the before-value check is what
            # caught it, when the revert found (196, 226, 255) where (255, 226, 196) had been recorded.
            value = unreal.Color(r=int(round(value[0])), g=int(round(value[1])), b=int(round(value[2])), a=255)
        else:
            value = unreal.LinearColor(float(value[0]), float(value[1]), float(value[2]), 1.0)
    comp.set_editor_property(prop, value)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    with open(SPEC, encoding="utf-8") as f:
        lights = json.load(f)["lights"]
    source, target = ("after", "before") if REVERT else ("before", "after")
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    by_label = {a.get_actor_label(): a for a in eas.get_all_level_actors()}
    refused, written = [], {}
    for label, spec in lights.items():
        actor = by_label.get(label)
        if actor is None:
            refused.append("%s: no such actor" % label)
            continue
        comp_class = spec.get("component", "LightComponentBase")
        comp = actor.get_component_by_class(getattr(unreal, comp_class))
        if comp is None:
            refused.append("%s: no %s" % (label, comp_class))
            continue
        for prop, want_before in spec[source].items():
            have = _read(comp, prop)
            if not _same(have, want_before):
                refused.append("%s.%s is %s, not the recorded %s" % (label, prop, have, want_before))
        if any(r.startswith(label + ".") for r in refused):
            continue
        for prop, value in spec[target].items():
            _write(comp, prop, value)
        comp.modify()
        written[label] = spec[target]
        yield 0.0
    RESULT["written"] = written
    RESULT["refused"] = refused
    if SAVE and written and not refused:
        RESULT["saved"] = unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP)
    RESULT["status"] = "done"
