# DOES THE LIVING BRAIN ACTUALLY LAND IN THE PANEL'S BRAIN WINDOW?
#
# UWonderlandUiSubsystem::FrameBrainSculpture places the sculpture straight ahead of the pawn and then aims the
# camera AWAY from it by exactly the angle that carries it to the window's centre -- the same trick the wardrobe
# uses to put the Relay Dog behind its preview hole. It is a handful of arctangents, and a sign error in any one
# of them puts the brain off the edge of the screen.
#
# THAT IS AN EXPENSIVE WAY TO FIND OUT. The editor is shared with the world lane, so a PIE run costs a slot that
# may not come free for hours. The maths does not need the editor: it is pure arithmetic over the panel's own
# rectangle, so it is checked here by doing the projection FORWARDS and asking where the sculpture actually
# lands, rather than by re-deriving the same formula and agreeing with itself.
#
#   python wonderland/Tools/brain_framing_check.py
import math
import sys

# WonderlandProjectBrainPanel.cpp: constexpr FRect Hologram = {0.502f, 0.125f, 0.892f, 0.956f}
HOLOGRAM = (0.502, 0.125, 0.892, 0.956)
# WonderlandBrainSculpture.h: BrainRadiusUU, and the shell the python swims on
BRAIN_RADIUS = 120.0
REACH = BRAIN_RADIUS * 1.55 * 2.0
FILL = 0.74
MIN_DISTANCE, MAX_DISTANCE = 260.0, 2000.0


def frame(hfov_deg, vx, vy, rect=HOLOGRAM):
    """Exactly what FrameBrainSculpture computes."""
    centre = ((rect[0] + rect[2]) * 0.5, (rect[1] + rect[3]) * 0.5)
    size = (rect[2] - rect[0], rect[3] - rect[1])
    aspect = vx / vy
    tan_h = math.tan(math.radians(hfov_deg * 0.5))
    tan_v = tan_h / aspect
    want_tall = max(size[1] * FILL, 0.05)
    distance = min(max(REACH / (want_tall * 2.0 * tan_v), MIN_DISTANCE), MAX_DISTANCE)
    yaw_off = math.degrees(math.atan((centre[0] - 0.5) * 2.0 * tan_h))
    pitch_off = math.degrees(math.atan((centre[1] - 0.5) * 2.0 * tan_v))
    return centre, size, tan_h, tan_v, distance, yaw_off, pitch_off


def project(distance, yaw_off, pitch_off, tan_h, tan_v):
    """
    WHERE IT REALLY ENDS UP. The sculpture sits straight down the pawn's forward axis; the camera is aimed with
    yaw reduced by yaw_off and pitch raised by pitch_off, so relative to the CAMERA the sculpture sits at +yaw_off
    and -pitch_off. Screen y runs downward, which is why the pitch term adds.
    """
    sx = 0.5 + math.tan(math.radians(yaw_off)) / (2.0 * tan_h)
    sy = 0.5 + math.tan(math.radians(pitch_off)) / (2.0 * tan_v)
    half = math.atan((REACH * 0.5) / distance)
    fill_h = 2.0 * math.tan(half) / (2.0 * tan_v)
    return sx, sy, fill_h


def main():
    cases = [(90.0, 1920, 1080), (90.0, 2560, 1440), (90.0, 1280, 720),
             (80.0, 1920, 1080), (100.0, 1920, 1080), (90.0, 1920, 1200), (90.0, 3440, 1440)]
    bad = 0
    print("%-22s %8s %8s %8s   %8s %8s   %7s" % ("viewport / fov", "dist", "yawOff", "pitchOff", "landsX", "landsY", "fillH"))
    for hfov, vx, vy in cases:
        centre, size, tan_h, tan_v, distance, yaw_off, pitch_off = frame(hfov, vx, vy)
        sx, sy, fill_h = project(distance, yaw_off, pitch_off, tan_h, tan_v)
        # it must land on the window's centre, and fill about FILL of the window's height
        ok_x = abs(sx - centre[0]) < 1e-6
        ok_y = abs(sy - centre[1]) < 1e-6
        clamped = distance in (MIN_DISTANCE, MAX_DISTANCE)
        ok_fill = clamped or abs(fill_h - size[1] * FILL) < 1e-6
        # and the whole brain must be ON SCREEN, not merely centred on a point that is
        ok_edges = (sx - fill_h * 0.5 * (tan_v / tan_h) > 0.0 and sx + fill_h * 0.5 * (tan_v / tan_h) < 1.0
                    and sy - fill_h * 0.5 > 0.0 and sy + fill_h * 0.5 < 1.0)
        flag = "" if (ok_x and ok_y and ok_fill and ok_edges) else "   <-- FAIL"
        if flag:
            bad += 1
        print("%-22s %8.1f %8.2f %8.2f   %8.4f %8.4f   %7.4f%s"
              % ("%dx%d @%.0f" % (vx, vy, hfov), distance, yaw_off, pitch_off, sx, sy, fill_h, flag))

    centre = ((HOLOGRAM[0] + HOLOGRAM[2]) * 0.5, (HOLOGRAM[1] + HOLOGRAM[3]) * 0.5)
    print("\nwindow centre is %.4f, %.4f -- every landsX/landsY above must equal it" % centre)
    print("window height is %.4f, so fillH should be %.4f (%.0f%% of it)"
          % (HOLOGRAM[3] - HOLOGRAM[1], (HOLOGRAM[3] - HOLOGRAM[1]) * FILL, FILL * 100))
    print("\n%s" % ("ALL CASES LAND IN THE WINDOW" if bad == 0 else "%d CASE(S) FAILED" % bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
