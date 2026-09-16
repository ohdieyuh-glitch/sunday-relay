# Editor job, READ-ONLY and CONCURRENT: the city's STREETS, as geometry a dressing pass can follow.
#
# The generator lays every street as SM_terrace_platform slabs (FillEMC_St*, South_Road*, FillWE_St*, CxCityNE_Rd*...),
# about 2,900 of them. For each one this reports where it is, which way it runs, how long and wide it is, and how
# high its top is -- which is everything needed to put beds and lamps ALONG a street edge rather than scattering them
# by hand, and to tell a street's edge from the seam between two slabs of the same street.
# Globals: MATERIALS (street paving instances), EXCLUDE_BOX (xmin, xmax, ymin, ymax) for the hand-authored corridor,
# OUT (json path).
import json
import math

CONCURRENT = True
MAP_OBJECT = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
MATERIALS = tuple(globals().get("MATERIALS", ("MI_V2_Cobble", "MI_V2_PlazaShade", "MI_V2_PathStone", "MI_V2_PathWarm")))
EXCLUDE_BOX = globals().get("EXCLUDE_BOX", (-2600.0, 2600.0, -9800.0, 16000.0))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/street_census.json")


def job():
    world = unreal.find_object(None, MAP_OBJECT)
    GS = unreal.GameplayStatics
    rows = []
    n = 0
    for a in GS.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None or mesh.get_name() != "SM_terrace_platform":
            continue
        mats = [m.get_name() for m in smc.get_materials() if m]
        if not mats or mats[0] not in MATERIALS:
            continue
        loc = a.get_actor_location()
        if EXCLUDE_BOX[0] <= loc.x <= EXCLUDE_BOX[1] and EXCLUDE_BOX[2] <= loc.y <= EXCLUDE_BOX[3]:
            continue
        rot = a.get_actor_rotation()
        scale = a.get_actor_scale3d()
        bb = mesh.get_bounding_box()
        # the slab's own extent in ITS frame, so a rotated street still reports its true length and width
        lx = (bb.max.x - bb.min.x) * abs(scale.x)
        ly = (bb.max.y - bb.min.y) * abs(scale.y)
        cx = (bb.max.x + bb.min.x) * 0.5 * scale.x
        cy = (bb.max.y + bb.min.y) * 0.5 * scale.y
        th = math.radians(rot.yaw)
        centre_x = loc.x + cx * math.cos(th) - cy * math.sin(th)
        centre_y = loc.y + cx * math.sin(th) + cy * math.cos(th)
        o, ext = a.get_actor_bounds(False)
        rows.append({"label": a.get_actor_label(), "mat": mats[0],
                     "x": round(centre_x, 1), "y": round(centre_y, 1), "top": round(o.z + ext.z, 1),
                     "yaw": round(rot.yaw, 1), "len_x": round(lx, 1), "len_y": round(ly, 1)})
    RESULT["count"] = len(rows)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    RESULT["out"] = OUT
    RESULT["status"] = "done"
