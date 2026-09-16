# Assemble a zc_mission_experience scenario into a film the founder can watch.
#
#   python mission_film.py <scenario folder> [ffmpeg.exe]
#
# PLAYED AT THE WORLD'S OWN SPEED. Frames were taken every tick under slow motion, so their spacing in world time is
# uneven; each frame is held for exactly the world time until the next one (from frames.json), which makes the film
# play the mission at 1x world speed however fast the editor happened to capture.
#
# Also writes key_moments.jpg: the first settled frame of every stage, tiled, for a glance at the whole lifecycle.
import json
import os
import subprocess
import sys


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
                    "-vsync", "vfr", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                    "-movflags", "+faststart", film], check=True, cwd=folder)

    # ---- key moments: the frame 40% into each stage run
    runs, start = [], 0
    for i in range(1, len(frames) + 1):
        if i == len(frames) or frames[i]["beat"] != frames[start]["beat"]:
            runs.append((frames[start]["beat"], frames[start:i]))
            start = i
    picks = []
    for beat, run in runs:
        if beat in ("idle", "unobserved") and picks:
            continue
        pick = run[int(len(run) * 0.4)]
        if not picks or picks[-1][0] != beat:
            picks.append((beat, pick))
    picks = picks[:16]
    sheet_list = os.path.join(folder, "moments.txt")
    with open(sheet_list, "w", encoding="utf-8") as fh:
        for _, pick in picks:
            fh.write("file 'f_%05d.jpg'\n" % pick["i"])
    columns = 4
    rows = (len(picks) + columns - 1) // columns
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", sheet_list,
                    "-vf", "scale=640:-1,tile=%dx%d:padding=4:color=black" % (columns, rows), "-frames:v", "1",
                    os.path.join(folder, "key_moments.jpg")], check=True, cwd=folder)

    seconds = frames[-1]["t"] - frames[0]["t"]
    print(json.dumps({"film": film, "frames": len(frames), "world_seconds": round(seconds, 1),
                      "moments": [[b, p["i"]] for b, p in picks]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
