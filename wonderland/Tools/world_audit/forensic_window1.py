import json, os, re, struct, collections, hashlib
CK = "C:/dev/iwonder/recovery/_map_checkpoints/2026-09-29-2026-09-29-pre-window1"
CONTENT = "C:/dev/iwonder/wonderland-task3/wonderland/Content"
MAP = "WL_V2_GoldenArrival_WP2"
TAG = b"\xc1\x83\x2a\x9e"                       # PACKAGE_FILE_TAG 0x9E2A83C1, little endian
EXPECT = {"WI030": 200, "WI122": 168, "WN150": 368, "WN210": 348, "WT270": 317, "WT330": 304, "HT356": 241, "HN181": 172,
          "HN238": 235, "HI057": 165, "HT308": 190, "TW01": 17, "MG01": 13, "SR030": 21, "SR150": 23}
REPLACED = {"HT356", "HN181", "HN238", "HI057", "HT308"}
h = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hashcheck_w1.json")))
def live(rel):
    top, rest = rel.split("/", 1)
    return "%s/%s/WonderlandV2/Maps/%s" % (CONTENT, top, rest)
def magic(path):
    with open(path, "rb") as f:
        head = f.read(4); f.seek(-4, 2); tail = f.read(4)
    return head == TAG, tail == TAG
PASSRE = re.compile(rb"WL_PASS_([A-Z0-9]+)")
def passes(path):
    data = open(path, "rb").read()
    return sorted({m.decode() for m in PASSRE.findall(data)} - {"AUTHORED"})
rep = {"added": len(h["added"]), "deleted": len(h["deleted"]), "changed": h["changed"]}
# 1 every live package: magic at head and tail, zero-byte
bad, zero, total = [], 0, 0
for top in ("__ExternalActors__", "__ExternalObjects__"):
    for d, _, fs in os.walk("%s/%s/WonderlandV2/Maps/%s" % (CONTENT, top, MAP)):
        for fn in fs:
            if fn.endswith(".uasset"):
                p = os.path.join(d, fn); total += 1
                if os.path.getsize(p) == 0:
                    zero += 1; continue
                hd, tl = magic(p)
                if not (hd and tl):
                    bad.append(p)
umap = "%s/WonderlandV2/Maps/%s.umap" % (CONTENT, MAP)
rep["live_packages"] = total; rep["zero_byte"] = zero; rep["bad_magic"] = len(bad); rep["bad_examples"] = bad[:5]
rep["umap_magic"] = magic(umap); rep["umap_size"] = os.path.getsize(umap)
# 2 attribute added actor packages to passes
add_by = collections.Counter(); add_unattrib = []
for rel in h["added"]:
    if rel.startswith("__ExternalObjects__"):
        add_by["(folder object)"] += 1; continue
    ps = passes(live(rel))
    if len(ps) == 1: add_by[ps[0]] += 1
    else: add_unattrib.append((rel, ps))
rep["added_by_pass"] = dict(add_by); rep["added_unattributed"] = add_unattrib[:10]
rep["added_vs_expected"] = {k: (add_by.get(k, 0), v) for k, v in EXPECT.items() if add_by.get(k, 0) != v}
# 3 deleted packages: from the checkpoint copy, which pass did they belong to
del_by = collections.Counter()
for rel in h["deleted"]:
    ps = passes("%s/%s" % (CK, rel))
    del_by[",".join(ps) or "(none)"] += 1
rep["deleted_by_pass"] = dict(del_by)
rep["deleted_outside_replaced"] = {k: v for k, v in del_by.items() if k not in REPLACED}
# 4 the replaced passes: nothing of theirs left behind from before
json.dump(rep, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "forensic_w1.json"), "w"), indent=1)
print(json.dumps(rep, indent=1)[:4000])
