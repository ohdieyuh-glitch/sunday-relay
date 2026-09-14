# Private-beta world gate -- status with evidence

The twelve items are from `PRODUCTION_ORDER.md`. An item with no measurement is **not met**. Evidence lives in
`C:/dev/iwonder/recovery/evidence/<date>-*`. Update this file whenever a measurement changes an item's status.

**Overall (2026-09-13): NOT READY.** The hero corridor is strong. The rest of the world the map sends a
player to is not.

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Golden Arrival substantially finished | **Partly** | GA01-GA07 authored (gates, planters, heart arch, gold screens, pocket clock, royal promenade); captures `2026-09-13-GA07`. Still to judge against the Bible end to end: palace/castle end of the axis, clock plaza, mid-path. |
| 2 | Skyline communicates a large enchanted city | **Partly** | SKY02-SKY05: needle skyline, castle crown, distant metropolis to 1.25 km, five floating islands. From the hero camera it reads as a city; from ground-level path views it is still moderate. The palace family (GAP 17) is built and imported but not yet placed. |
| 3 | Core traversal works reliably | **Met at the destinations; corridor walk previously met** | beta_tour 2026-09-13: all 17 offered destinations arrive on their anchor (0 cm), none is a trap (4-way walks 184-620 cm). Corridor walk_route (d03169df). Not yet: a full walk of the beta route between destinations. |
| 4 | World Partition behaviour understood and stable | **Met** | world_audit: `WL_V2_GoldenArrival_WP2` has no World Partition object -- one persistent level. beta_probe: PIE holds exactly the editor's authored actors per pass (12 passes, 0 mismatches; 17,984 actors in PIE). No streaming, so no density changes. Cost: nothing streams out, so everything draws (see 10). |
| 5 | Major hero corridor polished | **Partly -- foreground much improved** | Arrival plaza and garden path authored to Bible language (GA05-GA07) and, since the quality directive, laid in real stone (MQ02: flagstone fields over the plaza and the level path), planted with real flowers (FL01: path kerbs and plaza planters) and framed by mushrooms with separate caps, gills, spots and stalks (MU01). Still to do: the ramp to the Clock Plaza, the Clock Plaza, the castle approach end. |
| 6 | Materials and lighting coherent | **Lighting met; materials much improved** | One atmosphere sun, the only shadow caster; three unshadowed fills; exposure pinned EV100 13.5. beta_probe fill variants (`light_grid.jpg`): fills off is darker and moodier than the Bible, so no conflict to fix. Materials MAT01-MAT03 on Bible palette; MQ01 (2026-09-13) moved 20 world instances onto an HD master -- 2048 px limestone, cobble, ivory, roof and polished-gold sets, per-instance tone, detail normal, macro variation (evidence 2026-09-13-MQ01). RoofBlue/RoofNavy still V2. Districts outside the corridor still read grey in places. |
| 7 | Blender -> Unreal repeatable | **Met** | Forge build + validate (108 assets, 0 failures) + import plan + `import_kit.py` ONLY=[...] + kit snapshot, done end to end for the palace family on 2026-09-13 in about 25 minutes. |
| 8 | Bible references represented | **Partly** | Present: golden gates, mushrooms, pocket clock, topiary heart, floating islands, needle skyline, promenade medallions. Missing in the world: palace fronts and a great dome (kit ready), giant topiary figures, teapot/key object language at landmark scale in the districts. |
| 9 | HUD / terminal / map reliable | **Met** | ui_tests 34/34 after the HUD rebuild (`2026-09-13-HUD-readouts`): usage HUD preview at 100%, Ctrl+T terminal, M map, teleport, PIE restart. |
| 10 | Performance acceptable on the founder's laptop | **Not met** | beta_tour with the editor in the foreground: 18-27 fps in PIE at 1904x928 (RTX 5060 Laptop, Lumen hardware RT, virtual shadow maps). Behind other windows the editor caps PIE near 3 fps and the numbers are void. PIE-in-editor includes editor cost; a standalone measurement is still needed. `play_perf_watch.py` records the founder's own play sessions. |
| 11 | No grey / empty / unfinished district dominates | **Not met (5 of 17)** | beta_tour captures (`tour_fwd_a.jpg`, `tour_fwd_b.jpg`, `tour_4way.jpg`): 15 of 17 destinations arrived on bare lawn or plain slabs with scattered columns, urns and balustrade pieces, often facing a wall a few metres away; at Clock Quarter the camera clips into a column. At the bar: The Arrival Gate, Castle Approach, The Grand Clock (DC01), Tea Terraces (DC02) and Gatekeeper Fields (DC03). The districts are packed generator content with no free lots: an arrival is composed by a reversible declutter trim plus an authored court, about 45 minutes each. |
| 12 | The beta route gives enough world to explore | **Not met** | Follows from 11: the map offers 17 places and 2 are finished. |

## Biggest gaps, in order

1. **District arrivals (items 11, 12).** Either author each offered destination's arrival to the Golden
   Arrival bar (a composed court: paving with borders, planting, a framing gate or arch, palace fronts behind,
   a landmark in view), or withhold it from the map until it is. The founder's standing rule: do not expose
   unfinished areas as destinations.
2. **Performance (item 10).** Measure standalone, then cheapest wins first (Lumen software vs hardware RT,
   screen percentage, shadow and fog cost, draw count of 18k always-loaded actors).
3. **Palace city in the midground (items 2, 8).** Place the palace family where it fills ground-level views.
