# Editor job, READ-ONLY and CONCURRENT: what World Partition streams and what lights the world.
#
# Private-beta gate items 4 (World Partition understood and stable) and 6 (lighting coherent). In the editor
# every actor of this map is loaded; in PIE only what the runtime hash streams in around the player is. So the
# job records, per authored pass and per generator folder, how many actors are spatially loaded (streamed by
# cell) versus always loaded, which runtime grid they use, and the partition grids (cell size, loading
# range). Then every light, sky, fog, cloud and post-process volume with the settings that conflict when
# doubled: atmosphere-sun flags and indices, intensities, mobility, exposure.
# Globals: OUT (json path). Reads the editor world (the map object), never PIE.
import json
from collections import Counter, defaultdict

CONCURRENT = True
MAP_OBJECT = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/world_audit.json")


def _plain(v):
    if isinstance(v, (bool, int, float, str)) or v is None:
        return v
    if isinstance(v, (unreal.LinearColor, unreal.Color)):
        return [round(v.r, 3), round(v.g, 3), round(v.b, 3)]
    if isinstance(v, unreal.Vector):
        return [round(v.x, 3), round(v.y, 3), round(v.z, 3)]
    if isinstance(v, unreal.Name):
        return str(v)
    if isinstance(v, unreal.EnumBase):
        return str(v.name)
    return str(v)[:200]


def _prop(obj, name, default=None):
    try:
        return _plain(obj.get_editor_property(name))
    except Exception:
        return default


def _struct(s, names):
    return {n: _prop(s, n) for n in names}


def job():
    world = unreal.find_object(None, MAP_OBJECT)
    GS = unreal.GameplayStatics
    out = {"partition": {}, "streaming": {}, "lighting": {}}

    ws = world.get_world_settings()
    part = out["partition"]
    try:
        wpo = ws.get_editor_property("world_partition")
        part["world_partition"] = None if wpo is None else wpo.get_name()
        if wpo is not None:
            part["world_partition_props"] = {n: _prop(wpo, n) for n in ("enable_streaming", "streaming_policy_class", "runtime_hash")}
            rh = wpo.get_editor_property("runtime_hash")
            part["runtime_hash_class"] = rh.get_class().get_name() if rh else None
            for key in ("grids", "runtime_partitions"):
                try:
                    grids = rh.get_editor_property(key)
                except Exception as exc:
                    part[key + "_error"] = repr(exc)[:200]
                    continue
                part[key] = []
                for g in grids:
                    row = {n: _prop(g, n) for n in ("grid_name", "cell_size", "loading_range", "block_on_slow_streaming", "priority", "name")}
                    row["repr"] = str(g)[:400]
                    part[key].append(row)
    except Exception as exc:
        part["error"] = repr(exc)[:300]
    yield None

    per_group = defaultdict(Counter)
    grids = Counter()
    layers = Counter()
    n = 0
    for a in GS.get_all_actors_of_class(world, unreal.Actor):
        n += 1
        if n % 3000 == 0:
            yield None
        tags = [str(t) for t in a.tags]
        passes = [t for t in tags if t.startswith("WL_PASS_")]
        folder = str(a.get_folder_path())
        group = passes[0] if passes else "folder:" + (folder.split("/")[0] if folder and folder != "None" else "(none)")
        spatial = _prop(a, "is_spatially_loaded")
        per_group[group]["spatial" if spatial else ("always" if spatial is False else "unknown")] += 1
        per_group[group]["class:" + a.get_class().get_name()] += 1
        grids[str(_prop(a, "runtime_grid"))] += 1
        try:
            for dl in a.get_data_layer_assets():
                layers[dl.get_name()] += 1
        except Exception:
            pass
    out["streaming"] = {"actors": n, "groups": {g: dict(c) for g, c in sorted(per_group.items())},
                        "runtime_grids": dict(grids), "data_layers": dict(layers)}
    yield None

    L = out["lighting"]
    L["directional"] = []
    for a in GS.get_all_actors_of_class(world, unreal.DirectionalLight):
        c = a.get_component_by_class(unreal.DirectionalLightComponent)
        r = a.get_actor_rotation()
        row = {"label": a.get_actor_label(), "hidden": _prop(a, "hidden"), "pitch_yaw": [round(r.pitch, 1), round(r.yaw, 1)],
               "folder": str(a.get_folder_path()), "spatial": _prop(a, "is_spatially_loaded"), "tags": [str(t) for t in a.tags]}
        row.update(_struct(c, ("visible", "intensity", "light_color", "temperature", "use_temperature", "mobility", "cast_shadows",
                               "atmosphere_sun_light", "atmosphere_sun_light_index", "forward_shading_priority",
                               "cast_cloud_shadows", "cast_shadows_on_clouds", "dynamic_shadow_distance_movable_light",
                               "dynamic_shadow_cascades", "affects_world")))
        L["directional"].append(row)
    L["sky_light"] = []
    for a in GS.get_all_actors_of_class(world, unreal.SkyLight):
        c = a.get_component_by_class(unreal.SkyLightComponent)
        row = {"label": a.get_actor_label(), "hidden": _prop(a, "hidden"), "spatial": _prop(a, "is_spatially_loaded")}
        row.update(_struct(c, ("visible", "intensity", "real_time_capture", "source_type", "mobility", "lower_hemisphere_is_black",
                               "cast_shadows", "light_color", "affects_world")))
        L["sky_light"].append(row)
    for key, cls, comp, names in (
            ("sky_atmosphere", unreal.SkyAtmosphere, unreal.SkyAtmosphereComponent,
             ("sky_luminance_factor", "rayleigh_scattering_scale", "mie_scattering_scale", "aerial_perspective_view_distance_scale", "visible")),
            ("height_fog", unreal.ExponentialHeightFog, unreal.ExponentialHeightFogComponent,
             ("fog_density", "fog_height_falloff", "start_distance", "enable_volumetric_fog", "visible")),
            ("volumetric_cloud", unreal.VolumetricCloud, unreal.VolumetricCloudComponent,
             ("layer_bottom_altitude", "layer_height", "visible"))):
        L[key] = []
        for a in GS.get_all_actors_of_class(world, cls):
            c = a.get_component_by_class(comp)
            row = {"label": a.get_actor_label(), "hidden": _prop(a, "hidden"), "spatial": _prop(a, "is_spatially_loaded")}
            row.update(_struct(c, names) if c else {"component": None})
            L[key].append(row)
    L["post_process"] = []
    for a in GS.get_all_actors_of_class(world, unreal.PostProcessVolume):
        s = a.get_editor_property("settings")
        row = {"label": a.get_actor_label(), "unbound": _prop(a, "unbound"), "priority": _prop(a, "priority"),
               "blend_weight": _prop(a, "blend_weight"), "enabled": _prop(a, "enabled"), "spatial": _prop(a, "is_spatially_loaded")}
        row.update(_struct(s, ("override_auto_exposure_method", "auto_exposure_method", "override_auto_exposure_min_brightness",
                               "auto_exposure_min_brightness", "override_auto_exposure_max_brightness", "auto_exposure_max_brightness",
                               "override_auto_exposure_bias", "auto_exposure_bias",
                               "override_auto_exposure_apply_physical_camera_exposure", "auto_exposure_apply_physical_camera_exposure",
                               "override_dynamic_global_illumination_method", "dynamic_global_illumination_method",
                               "override_reflection_method", "reflection_method", "override_lumen_scene_lighting_quality",
                               "lumen_scene_lighting_quality", "override_lumen_final_gather_quality", "lumen_final_gather_quality",
                               "override_bloom_intensity", "bloom_intensity", "override_vignette_intensity", "vignette_intensity")))
        L["post_process"].append(row)
    other = Counter()
    for a in GS.get_all_actors_of_class(world, unreal.Light):
        if not isinstance(a, unreal.DirectionalLight):
            other[a.get_class().get_name()] += 1
    L["other_lights"] = dict(other)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    RESULT.update({"actors": n, "directional": len(L["directional"]), "status": "done"})
