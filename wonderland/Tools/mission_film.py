# Assemble a zc_mission_experience scenario into a film the founder can watch.
#
#   python mission_film.py <scenario folder> [ffmpeg.exe]
#
# PLAYED AT THE WORLD'S OWN SPEED. Frames were taken every tick under slow motion, so their spacing in world time is
# uneven; each frame is held for exactly the world time until the next one (from frames.json), which makes the film
# play the mission at 1x world speed however fast the editor happened to capture.
#
# Also writes key_moments.jpg: one labelled frame per stage of the founder's lifecycle -- preparation, research (with
# a page mid-turn), implementation (with the Jhinn's beam if it joined), verification (beam lit), review, repair,
# completion, and the companions home again -- tiled four across.
import json
import os
import subprocess
import sys

STAGES = [
    ("PREPARATION", ("mission_start",), None),
    ("RESEARCH", ("researching", "prompt_architect", "guidance"), "page_turning"),
    ("IMPLEMENTATION", ("coding_agent",), "jhinn_beam"),
    ("VERIFICATION", ("verifying",), "dog_beam"),
    ("REVIEW", ("independent_reviewer", "review_challenge"), None),
    ("REPAIR", ("repair_required", "repairing"), "jhinn_beam"),
    ("COMPLETION", ("complete_verified",), None),
]
FONT = "C\\:/Windows/Fonts/segoeuib.ttf"


def pick(frames, beats, prefer):
    # The FIRST time the mission is in this stage: review comes round twice when a repair is sent back, and the sheet
    # tells the story in order.
    run = []
    for f in frames:
        if f["beat"] in beats and f.get("contract"):
            run.append(f)
        elif run:
            break
    if not run:
        return None
    # Past the cross-fade into the stage, and preferring the frame that shows the stage's own sign.
    settled = run[len(run) // 4:] or run
    if prefer == "page_turning":
        good = [f for f in settled if f.get("page_turning")]
    elif prefer == "jhinn_beam":
        good = [f for f in settled if f["companions"][1]["beam"]]
    elif prefer == "dog_beam":
        good = [f for f in settled if f.get("dog_beam")]
    else:
        good = []
    chosen = good[len(good) // 2] if good else settled[len(settled) // 2]
    return chosen


def main():
    folder = sys.argv[1]
    ffmpeg = sys.argv[2] if len(sys.argv) > 2 else "ffmpeg"
    frames = json.load(open(os.path.join(folder, "frames.json"), encoding="utf-8"))
    frames = [f for f in frames if f["ok"] and os.path.exists(os.path.join(folder, "f_%05d.jpg" % f["i"]))]
    if len(frames) < 2:
        print("not enough frames")
        return 1

    # ---- the film: a concat list with a duration per frame, from world time
    listing = os.path.join(folder, "film.txt")
    with open(listing, "w", encoding="utf-8") as fh:
        for a, b in zip(frames, frames[1:]):
            duration = max(0.005, min(0.5, b["t"] - a["t"]))
            fh.write("file 'f_%05d.jpg'\nduration %.4f\n" % (a["i"], duration))
        fh.write("file 'f_%05d.jpg'\n" % frames[-1]["i"])
    film = os.path.join(folder, "mission_film.mp4")
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing,
                    "-fps_mode", "cfr", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                    "-movflags", "+faststart", film], check=True, cwd=folder)

    # ---- key moments: one labelled tile per stage, then the companions home after completion
    picks = []
    for label, beats, prefer in STAGES:
        chosen = pick(frames, beats, prefer)
        if chosen is not None:
            picks.append((label, chosen))
    picks.sort(key=lambda p: p[1]["i"])
    home =[f for f in frames if not f.get("contract") and picks and f["i"] > picks[-1][1]["i"]]
    if home:
        picks.append(("BACK TO FOLLOW", home[-1]))
    tiles = []
    for n, (label, chosen) in enumerate(picks):
        tile = os.path.join(folder, "moment_%d.png" % n)
        text = "%d  %s" % (n + 1, label)
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", "f_%05d.jpg" % chosen["i"], "-vf",
                        "scale=640:-1,drawtext=fontfile='%s':text='%s':x=12:y=10:fontsize=26:fontcolor=white:"
                        "box=1:boxcolor=black@0.62:boxborderw=8" % (FONT, text), tile], check=True, cwd=folder)
        tiles.append(tile)
    columns = 4
    rows = (len(tiles) + columns - 1) // columns
    sheet_list = os.path.join(folder, "moments.txt")
    with open(sheet_list, "w", encoding="utf-8") as fh:
        for tile in tiles:
            fh.write("file '%s'\n" % os.path.basename(tile))
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", sheet_list,
                    "-vf", "tile=%dx%d:padding=4:color=black" % (columns, rows), "-frames:v", "1",
                    os.path.join(folder, "key_moments.jpg")], check=True, cwd=folder)

    seconds = frames[-1]["t"] - frames[0]["t"]
    print(json.dumps({"film": film, "frames": len(frames), "world_seconds": round(seconds, 1),
                      "moments": [[label, p["i"], p["beat"]] for label, p in picks]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
