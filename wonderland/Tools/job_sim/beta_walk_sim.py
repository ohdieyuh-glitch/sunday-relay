"""Offline dry run of zc_beta_walk.py against a simulated world, driven the way editor_channel.py drives it.

WHY THIS EXISTS. A proof harness that runs only inside the editor cannot be tested without spending an
editor slot, and a gate that cannot fail looks exactly like one that passes. This runs the real job file --
generator stepping, conditional waits, the channel's TimeoutError thrown in -- against a stub `unreal`
with falling physics and delayed cell streaming, so each gate can be watched going RED on a world that
deserves it. On 2026-09-28 it showed the committed walk passing a tile with no floor at all (W04 could never
fail), reading a plaza stand in the basement, reading slow-frame stands in mid-air, and leaking
wl.Sky.DayMinutes 0 on every exit path -- and the fixed walk catching all four.

Usage: python beta_walk_sim.py <job.py> <scenario>      (e.g. ../editor_jobs/zc_beta_walk.py normal)
Scenarios:
  normal   - every tile has a floor; frames at real speed
  slow     - game time runs at 0.4x wall clock (slow frames), so a fixed 2 s wait reads a Dog in mid-air
  stuck    - set_movement_mode throws, so the Dog is never released and hangs where it was held
  boom     - get_player_pawn starts throwing part-way (the job's own guards swallow it: "did not survive")
  crash    - a capture throws on the 4th stand and the exception escapes the job
  hang     - PIE never ends, so the channel throws TimeoutError into the job's last wait
The world always contains a plaza whose content mean sits far below its floor (a basement at -861 under a
plaza at +12), a frontier quadrant beyond 1 km with no floor at all, and a frontier band on 99 m mountains
whose empty neighbours borrow a tile height far above their real floor (the zzV4 false alarm at [13,11]). W02/W05 fail here by construction
(the synthetic world has an empty quadrant and no wilderness); they are not what this checks.
"""
import json
import math
import os
import sys
import tempfile
import types

JOB, SCEN = sys.argv[1], sys.argv[2]
CAPSULE = 89.2


class Clock:
    t = 1000.0

    def time(self):
        return self.t


CLOCK = Clock()
DILATION = 0.4 if SCEN == "slow" else 1.0


class Vector:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)


class Mode:
    def __init__(self, name):
        self.name = name

    def __str__(self):
        return "MovementMode." + self.name


MOVE = types.SimpleNamespace(MOVE_NONE=Mode("MOVE_NONE"), MOVE_FALLING=Mode("MOVE_FALLING"),
                             MOVE_WALKING=Mode("MOVE_WALKING"))

# ---- the world: tiles are 200 m; the job centres its grid on a disc about the origin.
NOFLOOR_R = 1000e2       # every point beyond 1 km in the +x,+y quadrant has no floor (and no content)
PLAZA_R = 150e2          # the arrival plaza: floor at +12 with a basement at -861 underneath it
BASEMENT_XY = (6800.0, 6800.0)   # the centre of the job's grid tile nearest the origin (core ~1,232 m)


def floors_at(x, y):
    """Floors (z of walkable top surface) under a point, highest first."""
    r = math.hypot(x, y)
    if x > 0 and y > 0 and r > NOFLOOR_R:
        return []
    if r < PLAZA_R:
        return [12.0, -861.0]
    return [-14.0]


class Streaming:
    arrive_at = 0.0

    @classmethod
    def moved(cls):
        cls.arrive_at = CLOCK.t + 1.5          # a cell takes 1.5 s of wall time to arrive after a teleport


class Movement:
    def __init__(self, pawn):
        self.pawn = pawn
        self.mode = MOVE.MOVE_WALKING
        self.vz = 0.0

    def disable_movement(self):
        self.mode = MOVE.MOVE_NONE

    def set_movement_mode(self, m):
        if SCEN == "stuck":
            raise RuntimeError("simulated: set_movement_mode refused")
        self.mode = m

    def is_falling(self):
        return self.mode is MOVE.MOVE_FALLING

    def get_editor_property(self, name):
        if name == "movement_mode":
            return self.mode
        if name == "velocity":
            return Vector(0, 0, self.vz)
        raise KeyError(name)

    def set_editor_property(self, name, v):
        if name == "velocity":
            self.vz = v.z


class Pawn:
    def __init__(self):
        self.loc = Vector(0, 0, 101.2)
        self.character_movement = Movement(self)
        self.alive = True

    def get_actor_location(self):
        if not self.alive:
            raise RuntimeError("ObjectInstance is null")
        return Vector(self.loc.x, self.loc.y, self.loc.z)

    def set_actor_location(self, v, sweep, teleport):
        if not self.alive:
            raise RuntimeError("ObjectInstance is null")
        far = math.hypot(v.x - self.loc.x, v.y - self.loc.y) > 5000
        self.loc = Vector(v.x, v.y, v.z)
        if far:
            Streaming.moved()
        return True


PAWN = Pawn()


def physics(wall_dt):
    dt_total = wall_dt * DILATION
    while dt_total > 1e-9:
        dt = min(0.02, dt_total)
        dt_total -= dt
        m = PAWN.character_movement
        if not PAWN.alive or m.mode is not MOVE.MOVE_FALLING:
            continue
        m.vz = max(-4000.0, m.vz - 980.0 * dt)
        nz = PAWN.loc.z + m.vz * dt
        streamed = CLOCK.t >= Streaming.arrive_at
        below = [f for f in floors_at(PAWN.loc.x, PAWN.loc.y) if f + CAPSULE <= PAWN.loc.z + 1e-6]
        if streamed and below and nz <= below[0] + CAPSULE:
            PAWN.loc.z = below[0] + CAPSULE
            m.vz = 0.0
            m.mode = MOVE.MOVE_WALKING
        else:
            PAWN.loc.z = nz
        if PAWN.loc.z < -50000.0:
            PAWN.alive = False                 # KillZ


class Hit:
    def __init__(self, z):
        self.z = z

    def to_tuple(self):
        return (True, False, 0.5, 100.0, Vector(0, 0, self.z), Vector(0, 0, self.z))


def line_trace_single(world, a, b, *rest):
    if CLOCK.t < Streaming.arrive_at:
        return None
    lo, hi = min(a.z, b.z), max(a.z, b.z)
    hits = [f for f in floors_at(a.x, a.y) if lo <= f <= hi]
    return Hit(max(hits)) if hits else None


class Actor:
    def __init__(self, x, y, z, label):
        self._l, self._label = Vector(x, y, z), label

    def get_actor_location(self):
        return Vector(self._l.x, self._l.y, self._l.z)

    def get_actor_label(self):
        return self._label

    def get_components_by_class(self, cls):
        return []


def make_actors():
    out = []
    # a disc of content out to ~1,150 m, one actor per ~50 m, at the floor height
    for i in range(-24, 25):
        for j in range(-24, 25):
            x, y = i * 5000.0, j * 5000.0
            r = math.hypot(x, y)
            if r > 115000.0:
                continue
            if x > 0 and y > 0 and r > NOFLOOR_R:
                continue
            # MOUNTAIN NEIGHBOURS: in the -x,-y frontier band the content sits 99 m up, so the empty tiles
            # beyond it BORROW a tile height near 9900 while their real floor is -14 -- the live zzV4 case
            # at [13,11], where a correct landing was flagged as a fall.
            z = 9900.0 if (x < 0 and y < 0 and r > 100000.0) else 0.0
            out.append(Actor(x, y, z, "A_%d_%d" % (i, j)))
    # the plaza's deep content: a basement, tanks and pipes that pull the tile mean far below the floor
    for k in range(40):
        out.append(Actor(BASEMENT_XY[0] - 2000.0 + k * 100, BASEMENT_XY[1], -1500.0, "Basement_%d" % k))
    return out


ACTORS = make_actors()
CVARS = {"wl.Sky.DayMinutes": 24.0}
STATE = {"pie": False, "stands": 0}


def execute_console_command(world, cmd):
    parts = cmd.split()
    if parts and parts[0] in CVARS and len(parts) > 1:
        CVARS[parts[0]] = float(parts[1])


def get_console_variable_float_value(name):
    return CVARS.get(name, 0.0)


class GS:
    @staticmethod
    def get_player_pawn(world, i):
        if not STATE["pie"]:
            return None
        if SCEN == "boom":
            STATE["stands"] += 1
            if STATE["stands"] > 40:
                raise RuntimeError("simulated failure part-way through the stands")
        return PAWN

    @staticmethod
    def get_all_actors_of_class(world, cls):
        return list(ACTORS) if cls == "StaticMeshActor" else list(ACTORS)


class LES:
    def editor_request_begin_play(self):
        STATE["pie"] = True

    def editor_request_end_play(self):
        if SCEN != "hang":                 # hang: PIE never ends, so the job's final wait times out
            STATE["pie"] = False


def capture(path, w, q):
    STATE["captures"] = STATE.get("captures", 0) + 1
    if SCEN == "crash" and STATE["captures"] > 3:
        raise RuntimeError("simulated: capture failed on the 4th stand")
    return True


class UES:
    def get_game_world(self):
        return "PIE_WORLD" if STATE["pie"] else None

    def get_editor_world(self):
        return "EDITOR_WORLD"


unreal = types.SimpleNamespace(
    Vector=Vector, MovementMode=MOVE,
    StaticMeshActor="StaticMeshActor", Actor="Actor", InstancedStaticMeshComponent="ISM",
    LevelEditorSubsystem=LES, UnrealEditorSubsystem=UES,
    get_editor_subsystem=lambda cls: cls(),
    GameplayStatics=GS,
    SystemLibrary=types.SimpleNamespace(execute_console_command=execute_console_command,
                                        get_console_variable_float_value=get_console_variable_float_value,
                                        line_trace_single=line_trace_single),
    TraceTypeQuery=types.SimpleNamespace(TRACE_TYPE_QUERY1=1, TRACE_TYPE_QUERY2=2),
    DrawDebugTrace=types.SimpleNamespace(NONE=0),
    LinearColor=types.SimpleNamespace(RED=0, GREEN=1),
    WonderlandUiTestLibrary=types.SimpleNamespace(set_background_throttle_suspended=lambda b: True,
                                                 focus_game_viewport=lambda: True),
    WonderlandHudTestLibrary=types.SimpleNamespace(capture_viewport_jpeg=capture),
)

CHANNEL = os.path.join(tempfile.mkdtemp(prefix="beta_walk_sim_"), "_channel")   # captures land beside it
os.makedirs(CHANNEL, exist_ok=True)
RESULT = {"status": "running"}
LOG = []
ns = {"unreal": unreal, "RESULT": RESULT, "emit": lambda *p: LOG.append(" ".join(str(x) for x in p)),
      "CHANNEL": CHANNEL, "__name__": "__wl_job__", "__file__": JOB}
exec(compile(open(JOB, encoding="utf-8").read(), JOB, "exec"), ns)
ns["time"] = CLOCK                     # wall clock the job reads == the simulated wall clock


def advance(dt):
    CLOCK.t += dt
    physics(dt)


gen = ns["job"]()
error = None
thrown = None
while True:
    try:
        y = gen.throw(thrown) if thrown is not None else next(gen)
        thrown = None
    except StopIteration:
        break
    except Exception as e:           # what the channel records as status "error"
        error = repr(e)
        break
    if y is None:
        advance(0.02)
    elif isinstance(y, (int, float)):
        advance(float(y))
    else:
        cond, limit = (y[0], y[1]) if isinstance(y, tuple) else (y, 120.0)
        began = CLOCK.t
        while not cond():
            advance(0.25)
            if CLOCK.t - began > limit:
                thrown = TimeoutError("waited condition timed out")
                break

summary = {
    "scenario": SCEN, "job": os.path.basename(JOB), "status": RESULT.get("status"), "error": error,
    "day_minutes_found": RESULT.get("day_minutes_found"), "day_minutes_restored": RESULT.get("day_minutes_restored"),
    "cvar_after": CVARS["wl.Sky.DayMinutes"],
    "tests": {t["id"]: t["pass"] for t in RESULT.get("tests", [])},
    "stands": [{k: v.get(k) for k in ("tile", "radius_metres", "expected_near_z", "surface_z", "landed_z",
                                       "fell_through", "landed", "unmeasured", "airborne_z")}
               for v in RESULT.get("visits", [])],
}
print(json.dumps(summary, indent=1))
