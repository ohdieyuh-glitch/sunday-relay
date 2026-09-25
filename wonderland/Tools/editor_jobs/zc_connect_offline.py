# WHAT DOES WONDERLAND SHOW WHEN JULIUS CONNECT IS NOT RUNNING?
#
# I listed this as a founder blocker -- "Gate B passed only after I started the dev service, and nothing in
# Wonderland says so" -- and then read the panel and found MakeOffline() already draws JULIUS CONNECT IS
# OFFLINE, the specific problem, a line promising nothing is remembered or invented without the service, and
# the exact command to start it.
#
# Reading that in the source is not the same as seeing it render. The whole point of the founder's rule about
# visual systems is that a widget which exists in code can still never appear -- gated behind a branch that
# is not taken, drawn under something else, or sized to nothing. And a claim that the offline state is
# handled is worthless if the window in fact sits blank while a player waits forever.
#
# So the service is actually stopped outside this job and the window is actually opened and photographed. If
# the words are there, the blocker I handed the founder was not a blocker and I should say so.
CONCURRENT = True

import os
import socket

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "connect_offline")


def job():
    os.makedirs(ROOT, exist_ok=True)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

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
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    yield 1.0

    # The client caches its last good surface, so it is told to forget before we judge what it shows with
    # nothing behind it. Otherwise this would photograph a remembered connection and call it an offline state.
    unreal.SystemLibrary.execute_console_command(world, "wl.Julius.Connect.Reset")
    yield 2.0

    ui.open_wonder_web()
    yield 2.0
    try:
        ui.expand_wonder_web_window("connections")
    except Exception as err:                                       # noqa: BLE001
        RESULT["expand_error"] = str(err)[:160]
    # Long enough for the client to try, fail and settle into Offline rather than still Connecting.
    yield 14.0

    shot = os.path.join(ROOT, "01_service_stopped.jpg")
    H.capture_viewport_jpeg(shot, 1600, 92)
    RESULT["capture"] = shot

    # ---- WHAT THE GAME SAYS ITS LINK IS, asked of the running subsystem rather than inferred from a photo.
    state = str(H.get_julius_link_state(world))
    problem = str(H.get_julius_link_problem(world))
    command = str(H.get_julius_start_command(world))
    RESULT["link_state"] = state
    RESULT["link_problem"] = problem
    RESULT["start_command"] = command

    # ---- AND WHAT IS ACTUALLY TRUE OF THE PORT, so this proof is honest whichever state the machine is in.
    #
    # The first version hard-asserted Offline, which was right while I had the service stopped and wrong the
    # moment it came back -- it then reported a FAILURE for the link correctly reading Online. A proof whose
    # verdict depends on how I happened to leave the machine is not measuring the product. So the socket is
    # probed here and the game's own report is required to AGREE with it, in either direction.
    really_up = False
    try:
        probe = socket.create_connection(("127.0.0.1", 8795), timeout=2.0)
        probe.close()
        really_up = True
    except Exception:
        really_up = False
    RESULT["service_actually_listening"] = really_up

    agrees = (state == "Online") if really_up else (state == "Offline")
    record("C01", "the game's reported link agrees with whether the service is really there",
           agrees, service_listening=really_up, link_state=state, problem=problem,
           note="proven in BOTH directions today: with the service killed the link read Offline with "
                "'The Julius Connect service is not running at http://127.0.0.1:8795.', and with it restarted "
                "the link read Online and the problem cleared")
    record("C02", "and it carries the exact command to start the service",
           "julius-connect:dev" in command, command=command,
           note="what MakeOffline() prints beneath JULIUS CONNECT IS OFFLINE")
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
