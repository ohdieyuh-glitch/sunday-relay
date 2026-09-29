# GOLDEN ARRIVAL AXIS PROBE (CORE, 2026-09-29): why did the self-powered axis walk stop at (72, 6867)?
#
# READ-ONLY, editor world, no PIE: collision exists in the editor world, so the question "what would stop a walker
# here" is answered by traces, not by driving a Dog. Between the heart garden (0, 6350) and the medallion (150, 7300)
# the axis passes a 6.5 m gold gate arch (V2Batch_gate_arch_gold, piers at +/-4.5 m) and GA02's heart rose arch.
#   1. CAPSULE SWEEPS along the axis line at lateral offsets -300..+300 cm, three capsule sizes: the first blocking
#      hit (actor label, component, point) per sweep. A clear sweep means a walker of that size passes on that line.
#   2. A FLOOR PROFILE every 25 cm along the centre line (line trace down, Pawn channel): any rise between samples
#      above the character step height (45 cm) is a ledge a walker cannot climb.
# Nothing is edited or saved.
CONCURRENT = False

import math

PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2
A = (0.0, 6350.0)
B = (150.0, 7300.0)
SIZES = ((30.0, 60.0), (34.0, 88.0), (42.0, 96.0))      # (radius, half height) cm: small, Dog-like, generous
OFFSETS = (-300.0, -200.0, -100.0, -50.0, 0.0, 50.0, 100.0, 200.0, 300.0)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    w = ues.get_editor_world()
    RESULT["status"] = "running"

    def floor(x, y):
        hit = unreal.SystemLibrary.line_trace_single(w, unreal.Vector(x, y, 3000.0), unreal.Vector(x, y, -3000.0),
                                                     PAWN, False, [], unreal.DrawDebugTrace.NONE, True,
                                                     unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        if hit is None:
            return None, None
        t = hit.to_tuple()
        return float(t[4].z), (t[9].get_actor_label() if t[9] is not None else "?")

    dx, dy = B[0] - A[0], B[1] - A[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    lx, ly = -uy, ux
    # 2. floor profile
    prof, ledges = [], []
    last = None
    n = int(L / 25.0)
    for k in range(n + 1):
        x, y = A[0] + ux * 25.0 * k, A[1] + uy * 25.0 * k
        z, who = floor(x, y)
        prof.append([round(x), round(y), None if z is None else round(z, 1), who])
        if z is not None and last is not None and z - last[0] > 45.0:
            ledges.append({"at": [round(x), round(y)], "rise_cm": round(z - last[0], 1), "onto": who, "from": last[1]})
        if z is not None:
            last = (z, who)
        if k % 20 == 0:
            yield 0.0
    RESULT["floor_profile_samples"] = len(prof)
    RESULT["floor_min_max"] = [min(p[2] for p in prof if p[2] is not None), max(p[2] for p in prof if p[2] is not None)]
    RESULT["ledges_over_45cm"] = ledges
    RESULT["floor_profile"] = prof[::4]
    # 1. capsule sweeps
    sweeps = []
    for (r, hh) in SIZES:
        for off in OFFSETS:
            sx, sy = A[0] + lx * off, A[1] + ly * off
            ex, ey = B[0] + lx * off, B[1] + ly * off
            z0, _ = floor(sx, sy)
            z0 = (z0 if z0 is not None else 0.0) + hh + 5.0
            hit = unreal.SystemLibrary.capsule_trace_single(w, unreal.Vector(sx, sy, z0), unreal.Vector(ex, ey, z0),
                                                           r, hh, PAWN, False, [], unreal.DrawDebugTrace.NONE, True,
                                                           unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            rec = {"radius": r, "half_height": hh, "offset_cm": off, "z": round(z0)}
            if hit is None:
                rec["clear"] = True
            else:
                t = hit.to_tuple()
                rec.update({"clear": False, "actor": t[9].get_actor_label() if t[9] is not None else "?",
                            "component": t[10].get_name() if t[10] is not None else "?",
                            "at": [round(t[4].x), round(t[4].y), round(t[4].z)], "start_penetrating": bool(t[1])})
            sweeps.append(rec)
            yield 0.0
    RESULT["sweeps"] = sweeps
    RESULT["clear_sweeps"] = sum(1 for s in sweeps if s["clear"])
    blockers = {}
    for s in sweeps:
        if not s["clear"]:
            blockers[s["actor"]] = blockers.get(s["actor"], 0) + 1
    RESULT["blockers"] = blockers
    RESULT["status"] = "probed: %d/%d sweeps clear, %d ledges > 45 cm" % (RESULT["clear_sweeps"], len(sweeps), len(ledges))
