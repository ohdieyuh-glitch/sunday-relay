# What does the HUD test library actually expose to Python? Asked, not assumed.
L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary


def job():
    RESULT["hud_members"] = sorted(m for m in dir(H) if not m.startswith("_"))
    try:
        RESULT["frame_cost_raw"] = repr(H.get_frame_cost_ms())
    except Exception as bad:
        RESULT["frame_cost_error"] = str(bad)[:300]
    try:
        RESULT["draw_call_raw"] = repr(H.get_draw_call_count())
    except Exception as bad:
        RESULT["draw_call_error"] = str(bad)[:300]
    RESULT["status"] = "probed"
    yield 0.1
