# LL01 -- gold lantern standards for the strange lanterns: tried, REJECTED (2026-09-17)

Gap: at LanternLaneCam27 the 25 SM_lantern_strange landmarks (LMLanternHamlets 11, LMMushroomGrove 11, 3 waypoints)
read as rust -- bronze bent posts with streaked beige barrels (teal glass in the Mushroom Grove).

Tried: forge WL_Object_LanternStandard (292df7ae; 12.2 m gold standard, two scrolled arms, two glazed lanterns),
imported on editor 74 (3 parts, 0 failed); ll01_lantern_standards.py sank each lantern and its glass by a recorded
actor trim (50 changed, 0 refused) and stood a standard at the same place, yaw and height (0.79x-1.23x).

Judgement (ll01_key.jpg, ll01_ab.jpg): NOT better.
- The Lantern Hamlets' lanterns stand in a tight sculptural cluster; eleven standards with 2.6 m arms overlap into a
  thicket of pale posts (Hamlets close-up).
- The Mushroom Grove loses its teal glass -- the district's one colour accent.
- At LanternLaneCam27 the slim pale posts read weaker as a landmark than the heavy barrels did.
- The whimsy of a "strange" lantern is gone; a formal street standard is the wrong object for a landmark cluster.
Gains (gold, glazed, no rust) did not outweigh these.

Reverted on editor 74: 75 actors removed, all 50 trims restored from their recorded before values, verified
(0 LL01 actors, 0 strange lanterns still sunk) and the map saved in its original state (verified_and_saved.json).

Next attempt should keep the object's character, not replace it: a whimsical gold lantern with a curling post and
jewel-coloured glass (teal / rose), ONE per cluster position and no wide arms -- or retexture the existing strange
lantern's bronze away from the rust streaks.
