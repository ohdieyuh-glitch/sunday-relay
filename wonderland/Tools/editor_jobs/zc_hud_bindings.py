# No PIE: does every binding zc_hud_proof calls exist, under the name it uses?
CHECK = {'WonderlandUiSubsystem': ['click_nav_button', 'close_overlay', 'describe_hud_rects', 'did_mini_map_draw_photograph', 'equip_command_to_selected_slot', 'get_command_station_slot_rows', 'get_mini_map_arrow_angle', 'get_mini_map_capture_count', 'get_mini_map_marker_offset', 'get_mini_map_paint_count', 'get_mini_map_region_line', 'get_mini_map_uu_per_pixel', 'get_mini_map_view_angle', 'get_mini_map_world_line', 'get_nav_bar_labels', 'get_nav_click_count', 'get_terminal_command_rows', 'is_command_station_open', 'is_live_terminal_open', 'is_menu_open', 'is_mini_map_capture_in_world', 'is_mini_map_marker_drawn', 'is_mini_map_on_screen', 'is_missions_open', 'is_nav_bar_on_screen', 'is_project_brain_open', 'navigate_to', 'select_command_slot'], 'WonderlandCommandPresetSubsystem': ['describe_active_layout', 'equip_command', 'reset_all_layouts', 'restore_defaults'], 'WonderlandUiTestLibrary': ['capture_game_viewport', 'focus_game_viewport', 'get_ui', 'press_key', 'set_background_throttle_suspended', 'set_key_held'], 'WonderlandMissionSubsystem': ['set_beat_by_id']}


def job():
    table = {"WonderlandUiSubsystem": unreal.WonderlandUiSubsystem, "WonderlandCommandPresetSubsystem": unreal.WonderlandCommandPresetSubsystem,
             "WonderlandUiTestLibrary": unreal.WonderlandUiTestLibrary, "WonderlandMissionSubsystem": unreal.WonderlandMissionSubsystem}
    missing = []
    for cls, names in CHECK.items():
        for n in names:
            if not hasattr(table[cls], n):
                missing.append(cls + "." + n)
    RESULT["checked"] = sum(len(v) for v in CHECK.values())
    RESULT["missing"] = missing
    RESULT["snake_near_misses"] = sorted(a for a in dir(unreal.WonderlandUiSubsystem) if "mini_map" in a or "nav" in a or "command" in a)
    RESULT["other_apis"] = {"GameplayStatics.get_game_instance": hasattr(unreal.GameplayStatics, "get_game_instance"),
                            "GameplayStatics.get_world_delta_seconds": hasattr(unreal.GameplayStatics, "get_world_delta_seconds"),
                            "ObjectIterator": hasattr(unreal, "ObjectIterator")}
    RESULT["status"] = "done"
    yield 0.1
