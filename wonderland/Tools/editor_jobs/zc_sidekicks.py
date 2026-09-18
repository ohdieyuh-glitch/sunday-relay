# PIE proof: THE LLM COMPANION AND JHINN, BACKED BY A REAL RUNTIME (provider-free).
#
# FOUNDER DIRECTIVE (2026-09-17): "BEGIN REAL CHATGPT + CLAUDE CODE SIDEKICK INTEGRATION … Build EVERYTHING around the
# live connection provider-free … Do not fake responses when live mode is selected."
#
# This films the whole architecture with deterministic fixtures behind it, so what the founder sees is the real path with
# a stand-in at the far end rather than a mock of the path itself:
#   1. Both companions start SIMULATED and say so.
#   2. Asking for a REAL provider (OpenAI, Claude Code) goes to AUTH REQUIRED and contacts nothing -- the boundary the
#      founder's own account will cross later, shown honestly.
#   3. Connected to their development stand-ins, they answer: the terminal shows THINKING, then the answer, marked
#      [SIMULATED], and the bodies move because the runtime says they are working -- not because a timer said so.
#   4. Jhinn does bounded scoped work and reports; it does not become Julius.
#   5. A turn is cancelled; a failure is shown honestly; the companion is disconnected and truthfully says DISCONNECTED.
#   6. All three are present at once: Julius's Dog, Jhinn, and the LLM Companion, with separate authority.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "sidekicks")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    steps = []
    RESULT["steps"] = steps
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        sidekicks = next(s for s in unreal.ObjectIterator(unreal.WonderlandSidekickSubsystem) if s.get_world() == world)
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1600, 92)
            steps.append({
                "step": label, "note": note, "file": path,
                "sidekicks": str(sidekicks.describe_sidekicks()),
                "llm_mascot": str(sidekicks.mascot_state_of("llm-companion")),
                "jhinn_mascot": str(sidekicks.mascot_state_of("jhinn")),
            })

        # The companion terminals are one instrument with the Julius terminal, brought up by Ctrl+T -- a real chord, held
        # across frames the way a keyboard holds it, because that is how the game's shortcut reads it.
        L.focus_game_viewport()
        L.set_key_held("LeftControl", True)
        yield 0.12
        L.set_key_held("T", True)
        yield 0.12
        L.set_key_held("T", False)
        yield 0.08
        L.set_key_held("LeftControl", False)
        yield 1.5
        RESULT["terminals_open"] = bool(ui.is_live_terminal_open())
        RESULT["at_start"] = str(sidekicks.describe_sidekicks())
        shot("01_simulated", "both companions start SIMULATED and say so")

        # ---- 2. THE REAL PROVIDERS: asked for, and honestly refused until the founder connects an account
        console("wl.Sidekicks.Connect llm openai")
        yield 2.0
        console("wl.Sidekicks.Connect jhinn claude-code")
        yield 3.0
        RESULT["auth_required"] = str(sidekicks.describe_sidekicks())
        shot("02_auth_required", "OpenAI and Claude Code: AUTH REQUIRED, nothing contacted")

        # ---- 3. THE DEVELOPMENT STAND-INS: the whole path, with a fixture at the far end
        console("wl.Sidekicks.Connect llm dev-companion")
        yield 3.0
        console("wl.Sidekicks.Connect jhinn dev-single-agent")
        yield 3.0
        RESULT["connected"] = str(sidekicks.describe_sidekicks())
        shot("03_connected", "connected to their stand-ins; state, provider and model on the terminals")

        # ---- 4. A REAL TURN: thinking, then an answer, with the body moving because the runtime says so
        console("wl.Sidekicks.Say llm what are you, and what are you not?")
        yield 0.7
        RESULT["while_thinking"] = str(sidekicks.describe_sidekicks())
        RESULT["llm_mascot_while_thinking"] = str(sidekicks.mascot_state_of("llm-companion"))
        shot("04_thinking", "mascot=%s" % RESULT["llm_mascot_while_thinking"])
        yield 6.0
        RESULT["after_answer"] = str(sidekicks.describe_sidekicks())
        shot("05_answered", "the answer, marked SIMULATED")

        # ---- 5. JHINN DOES BOUNDED WORK, and stops
        console("wl.Sidekicks.Say jhinn add one test to the palette file and run it")
        yield 1.0
        RESULT["jhinn_mascot_working"] = str(sidekicks.mascot_state_of("jhinn"))
        shot("06_jhinn_working", "jhinn mascot=%s" % RESULT["jhinn_mascot_working"])
        yield 8.0
        RESULT["jhinn_done"] = str(sidekicks.describe_sidekicks())
        shot("07_jhinn_reported", "scoped work, reported, and it stops there")

        # ---- 6. A FAILURE, TOLD PLAINLY
        console("wl.Sidekicks.Say llm please rate limit me")
        yield 5.0
        RESULT["rate_limited"] = str(sidekicks.describe_sidekicks())
        shot("08_rate_limited", "a rate limit is a wait, and the body is idle rather than busy")

        # ---- 7. DISCONNECT: and it truthfully says so
        yield 6.0
        console("wl.Sidekicks.Disconnect llm")
        yield 3.0
        RESULT["disconnected"] = str(sidekicks.describe_sidekicks())
        RESULT["llm_mascot_disconnected"] = str(sidekicks.mascot_state_of("llm-companion"))
        shot("09_disconnected", "mascot=%s" % RESULT["llm_mascot_disconnected"])

        # ---- 8. ALL THREE PRESENT, WITH SEPARATE AUTHORITY
        console("wl.Sidekicks.Connect llm dev-companion")
        yield 3.0
        console("wl.Sidekicks.Say llm what is Julius, and what are you?")
        yield 1.0
        console("wl.Sidekicks.Say jhinn look at the palette file")
        yield 2.0
        shot("10_all_three", "Julius's Dog, Jhinn and the LLM Companion, each doing its own thing")
        yield 8.0
        RESULT["final"] = str(sidekicks.describe_sidekicks())
        shot("11_all_three_done", "final=%s" % RESULT["final"])
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLSIDEKICKS could not end play: %s" % exc)
