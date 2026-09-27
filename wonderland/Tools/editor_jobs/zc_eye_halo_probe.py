# WHY THE COSTUMES' EYES DO NOT GLOW WHEN THE DEFAULT DOG'S DO.
#
# Round 4 put M_WL_EyeHalo -- an additive surface that fades radially across its face -- on both the default
# Dog's halo cubes and every costume's authored "eyehalo" pane. Photographed at 11:16 (captures/zc/eyes_look):
# Relay OG's eyes are unmistakably glowing, a gold pool spilling across the visor and dying out. Arden's and
# Skeleton's are the same flat squares as before. Same material, same drive, same build; one works and four
# do not, and the difference is the path -- the Dog's halos are plain static mesh components created in C++,
# the costumes' are INSTANCES in the figure's own instanced components.
#
# Four things could produce that picture and they need opposite fixes, so this reads all four off the live
# actor instead of choosing between them by argument:
#
#   1. THE PANE IS NOT THERE.        the "eyehalo" material has no instances in any component
#   2. THE PANE IS NOT LIT.          its Color is black or tiny -- the drive never reached it
#   3. THE PANE IS NOT SOFT.         its parent is still M_WL_VoxelAdditive, so my override did not take
#   4. THE PANE IS NOT SEEN.         it is inside the visor, behind the eye, or its component is hidden
#
# It also reports the eye CORE beside it, because "the halo is missing" and "the halo is there and the core
# is fifty times brighter" look identical in a photograph and are not the same bug.
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eye_halo_probe")


def job():
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if dog is None or ui is None:
        RESULT["status"] = "FAIL: no Dog"
        return

    def vec_of(mat, pname):
        try:
            c = mat.get_vector_parameter_value(pname)
            return [round(float(c.r), 3), round(float(c.g), 3), round(float(c.b), 3)]
        except Exception:                                          # noqa: BLE001
            return None

    def surfaces_of(actor):
        """Every drawn component of an actor, with its material's parent and colour."""
        rows = []
        for cls in (unreal.InstancedStaticMeshComponent, unreal.StaticMeshComponent):
            try:
                comps = actor.get_components_by_class(cls)
            except Exception:                                      # noqa: BLE001
                continue
            for comp in comps:
                try:
                    count = int(comp.get_instance_count()) if hasattr(comp, "get_instance_count") else 1
                except Exception:                                  # noqa: BLE001
                    count = 1
                row = {"component": comp.get_name(), "class": comp.get_class().get_name(),
                       "instances": count, "visible": bool(comp.is_visible()), "materials": []}
                try:
                    b = comp.get_local_bounds()
                    row["local_bounds"] = [str(b[0]), str(b[1])]
                except Exception:                                  # noqa: BLE001
                    pass
                for slot in range(comp.get_num_materials()):
                    mat = comp.get_material(slot)
                    if mat is None:
                        row["materials"].append({"slot": slot, "material": None})
                        continue
                    entry = {"slot": slot, "material": mat.get_name()}
                    try:
                        parent = mat.get_editor_property("parent")
                        entry["parent"] = parent.get_name() if parent else None
                    except Exception:                              # noqa: BLE001
                        entry["parent"] = None
                    entry["Color"] = vec_of(mat, "Color")
                    entry["EmissiveColor"] = vec_of(mat, "EmissiveColor")
                    for s in ("EmissiveStrength", "Inner", "Falloff"):
                        try:
                            entry[s] = round(float(mat.get_scalar_parameter_value(s)), 4)
                        except Exception:                          # noqa: BLE001
                            pass
                    row["materials"].append(entry)
                rows.append(row)
        return rows

    # ---- THE DEFAULT DOG'S OWN HALOS, which DO glow: the control for everything below.
    RESULT["relay_og_halos"] = []
    ui.wear_relay_skin("relay_og")
    yield 6.0
    for row in surfaces_of(dog):
        if "halo" in row["component"].lower() or "eye" in row["component"].lower():
            RESULT["relay_og_halos"].append(row)
    emit("P_DOG", "INFO", "the default Dog's eye and halo components", RESULT["relay_og_halos"][:6])

    soft_on_dog = any(m.get("parent") == "M_WL_EyeHalo"
                      for row in RESULT["relay_og_halos"] for m in row["materials"])
    record("P00", "the Dog's halos wear the soft material (the control, photographed glowing)", soft_on_dog,
           components=len(RESULT["relay_og_halos"]))

    # ---- AND NOW EACH COSTUME.
    per_skin = {}
    RESULT["costumes"] = per_skin
    for skin in SKINS:
        if skin == "relay_og":
            continue
        ui.wear_relay_skin(skin)
        yield 6.0
        # The costume is its own actor: every embodiment in the world that is not a cub or a companion. Take
        # them all and say which is which rather than guessing by name.
        # A MID IS NAMED AFTER ITS PARENT, NOT AFTER THE FIGURE'S MATERIAL. The first run of this job looked for
        # a material called "eyehalo" and found none on any costume -- because every instance is called
        # MID_<parent>_<n>. The figure's own names do not survive into the render data at all, so the only
        # identity a surface has here is its PARENT material, which is exactly the thing in question.
        found = []
        try:
            for actor in unreal.GameplayStatics.get_all_actors_of_class(
                    world, unreal.WonderlandCompanionEmbodiment):
                dist = (actor.get_actor_location() - dog.get_actor_location()).length()
                try:
                    attached = actor.get_attach_parent_actor()
                    attached_to = attached.get_name() if attached else None
                except Exception:                                  # noqa: BLE001
                    attached_to = None
                try:
                    owner = actor.get_owner()
                    owned_by = owner.get_name() if owner else None
                except Exception:                                  # noqa: BLE001
                    owned_by = None
                surfaces = surfaces_of(actor)
                parents = {}
                for row in surfaces:
                    for m in row["materials"]:
                        key = m.get("parent") or "none"
                        parents[key] = parents.get(key, 0) + 1
                found.append({"actor": actor.get_name(), "attached_to": attached_to, "owned_by": owned_by,
                              "metres_from_dog": round(float(dist) / 100.0, 2),
                              "surface_count": len(surfaces), "parents": parents, "surfaces": surfaces})
        except Exception as err:                                   # noqa: BLE001
            per_skin[skin] = {"error": str(err)[:200]}
            continue
        emit("P_WHO_%s" % skin, "INFO", "%s: every embodiment in the world" % skin,
             [{k: f[k] for k in ("actor", "attached_to", "owned_by", "metres_from_dog",
                                 "surface_count", "parents")} for f in found])

        # THE COSTUME IS THE ONE ATTACHED TO THE DOG. Nearness picked the AI Companion, which follows at half a
        # metre and is also an embodiment; it reported the same eleven materials under all four skins, which is
        # the tell that the sample never changed when the costume did.
        worn = None
        for f in found:
            if f["attached_to"] == dog.get_name():
                worn = f
                break
        if worn is None:
            for f in found:
                if f["metres_from_dog"] < 1.5 and (worn is None or f["surface_count"] > worn["surface_count"]):
                    worn = f
        # An eye halo is an ADDITIVE surface: its parent is M_WL_EyeHalo if the round-4 override took, and
        # M_WL_VoxelAdditive if it did not. Either way it is the only additive thing on a head.
        halo_rows, core_rows, additive_rows = [], [], []
        for row in (worn or {}).get("surfaces", []):
            for m in row["materials"]:
                parent = m.get("parent") or ""
                entry = {"component": row["component"], "instances": row["instances"],
                         "visible": row["visible"], **m}
                if parent in ("M_WL_EyeHalo", "M_WL_VoxelAdditive", "EmissiveMeshMaterial"):
                    additive_rows.append(entry)
                    if parent == "M_WL_EyeHalo":
                        halo_rows.append(entry)
                elif parent == "M_WL_VoxelGlow":
                    core_rows.append(entry)
        if not halo_rows:
            halo_rows = list(additive_rows)
        per_skin[skin] = {"embodiments_in_world": len(found),
                          "worn_actor": (worn or {}).get("actor"),
                          "worn_attached_to": (worn or {}).get("attached_to"),
                          "worn_surface_count": (worn or {}).get("surface_count"),
                          "worn_parents": (worn or {}).get("parents"),
                          "halo": halo_rows, "core": core_rows[:4],
                          "additive_surfaces": len(additive_rows)}
        emit("P_%s" % skin, "INFO", "%s: halo rows %d, core rows %d" % (skin, len(halo_rows), len(core_rows)),
             {"halo": halo_rows[:2], "core": core_rows[:2], "parents": (worn or {}).get("parents")})

    dressed = [s for s in SKINS if s != "relay_og"]
    present = {s: len(per_skin.get(s, {}).get("halo", [])) for s in dressed}
    record("P01", "1. the eyehalo pane EXISTS as a drawn surface on every costume",
           all(v > 0 for v in present.values()), halo_surfaces_per_skin=present,
           note="zero means the generator's pane never became geometry, or its material was merged away")

    def first_halo(s):
        rows = per_skin.get(s, {}).get("halo", [])
        return rows[0] if rows else {}

    parents = {s: first_halo(s).get("parent") for s in dressed}
    record("P02", "3. it wears M_WL_EyeHalo rather than the flat additive",
           all(p == "M_WL_EyeHalo" for p in parents.values()), parent_per_skin=parents,
           note="the flat additive draws one colour to the cube's hard edge -- the olive frame of round 3")

    lit = {s: first_halo(s).get("Color") for s in dressed}
    record("P03", "2. it is driven to a real level, not black",
           all(c is not None and max(c) > 100.0 for c in lit.values() if c is not None)
           and all(lit.get(s) is not None for s in dressed),
           colour_per_skin=lit,
           note="an additive surface carries the scene's thousand in its Color; under ~100 it is invisible "
                "against a white point of 25,000")

    seen = {s: first_halo(s).get("visible") for s in dressed}
    record("P04", "4. its component is visible", all(v is True for v in seen.values()), visible_per_skin=seen)

    # A COMPONENT CAN CARRY THE RIGHT MATERIAL AND DRAW NOTHING. One instanced component is made per
    # (part, material) pair and the pane's transforms are added to it; an empty one is invisible and looks
    # from every parameter dump exactly like a working one.
    counts = {s: first_halo(s).get("instances") for s in dressed}
    record("P05", "5. it actually has instances in it",
           all(isinstance(c, int) and c > 0 for c in counts.values()), instances_per_skin=counts)
    bounds = {s: first_halo(s).get("local_bounds") for s in dressed}
    RESULT["halo_local_bounds"] = bounds

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
