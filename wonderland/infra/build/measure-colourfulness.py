import subprocess, sys
def s2l(v):
    v=v/255.0
    return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
for cap in sys.argv[1:]:
    raw=subprocess.run(["ffmpeg","-v","error","-i",cap,"-vf","scale=480:270",
      "-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE).stdout
    n=len(raw)//3; c=0.0; l=0.0
    for k in range(n):
        i=k*3
        p=(s2l(raw[i]), s2l(raw[i+1]), s2l(raw[i+2]))
        c += max(p)-min(p)
        l += 0.299*p[0]+0.587*p[1]+0.114*p[2]
    print("%-26s chroma %.4f  luma %.4f  chroma/luma %.4f"
          % (cap.split("/")[-1], c/n, l/n, (c/n)/(l/n)))

# WHY THIS EXISTS, AND WHAT IT CORRECTED.
#
# For most of a session I compared the world's albedo "saturation" -- computed
# as (max-min)/max -- against the delivered frame's "chroma", computed as
# max-min. Those are DIFFERENT FORMULAS, and the comparison cannot support a
# conclusion. It was quoted repeatedly, including in a published report.
#
# The quantity to compare is CHROMA OVER LUMA, because that is what
# multiplicative light preserves: a Lambertian surface lit at level E renders
# albedo*E, so chroma and luma both scale by E and their ratio does not. Read
# correctly, the frame delivers 49% of the albedo's chroma-per-luma -- a real
# gap, and about half the one I had been claiming.
#
# Run across the session's captures it also localises the loss, which no
# per-material measurement had managed:
#
#     a203547  base            chroma 0.1826
#     75ff09b                  chroma 0.1725
#     9bdb61e                  chroma 0.1655
#     f80c8c6  lamps 14000->2200   chroma 0.0907   <-- HALVED HERE
#     84a66fd  head            chroma 0.0835
#
# The lantern practicals were carrying half the frame's colour. Cutting them
# was right -- eighteen shadowless gold lights against a 340-lux sun were
# deciding the hue of every material in the world. But they were also a third
# of its light, and what replaced them was NEUTRAL sun and sky, which does not
# carry colour the way warm light does. Wonderland is not mysteriously grey.
# It went grey at a commit, and the commit is known.
