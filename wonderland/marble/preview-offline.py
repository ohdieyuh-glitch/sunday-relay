#!/usr/bin/env python3
"""Render the Marble backdrop from a Wonderland hero camera WITHOUT Unreal and
WITHOUT a GPU.

Why this is honest rather than a mock-up. The export is KHR_materials_unlit:
World Labs bakes the lighting into the texture, which is what a backdrop wants
and what the manifest already records. An unlit textured mesh has no shading
term, so its on-screen colour is a function of the texture and the camera
alone -- not of Unreal's renderer, its exposure, or its lights. That makes a
CPU rasterisation of it a faithful preview of the backdrop layer, and it is the
one part of Wonderland that can be seen before the L4 is attached. It says
nothing about the authored plaza, the Relay Dogs or the lit world around it,
and this script never claims otherwise.

It reproduces the SAME transform chain the importer applies, and refuses to
render if that chain does not reproduce transform.expected_unreal_extent_cm.
"""

import argparse
import json
import math
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import placement  # noqa: E402  -- the one description of the transform chain


def log(msg):
    sys.stderr.write("[preview] %s\n" % msg)


# --------------------------------------------------------------------------
# GLB
# --------------------------------------------------------------------------

_COMPONENT = {
    5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
    5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4),
}
_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def parse_glb(path):
    with open(path, "rb") as fh:
        magic, version, _total = struct.unpack("<III", fh.read(12))
        if magic != 0x46546C67:
            raise SystemExit("%s is not a GLB (bad magic)" % path)
        if version != 2:
            raise SystemExit("%s is glTF version %d, expected 2" % (path, version))
        doc = None
        blob = b""
        while True:
            head = fh.read(8)
            if len(head) < 8:
                break
            length, kind = struct.unpack("<II", head)
            payload = fh.read(length)
            if kind == 0x4E4F534A:
                doc = json.loads(payload.decode("utf-8"))
            elif kind == 0x004E4942:
                blob = payload
    if doc is None:
        raise SystemExit("%s has no JSON chunk" % path)
    return doc, blob


def read_accessor(doc, blob, index):
    """Return an (n, components) float/int array for accessor `index`."""
    acc = doc["accessors"][index]
    fmt, size = _COMPONENT[acc["componentType"]]
    comps = _COUNT[acc["type"]]
    count = acc["count"]
    if "bufferView" not in acc:
        return np.zeros((count, comps), dtype=np.float64)
    view = doc["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or (size * comps)
    dtype = np.dtype("<" + fmt)
    if stride == size * comps:
        flat = np.frombuffer(blob, dtype=dtype, count=count * comps, offset=base)
        out = flat.reshape(count, comps)
    else:
        raw = np.frombuffer(blob, dtype=np.uint8, count=stride * count, offset=base)
        raw = raw.reshape(count, stride)[:, : size * comps]
        out = np.ascontiguousarray(raw).view(dtype).reshape(count, comps)
    if acc.get("normalized"):
        info = np.iinfo(dtype)
        out = out.astype(np.float32)
        out = out / float(info.max) if info.min == 0 else np.maximum(out / float(info.max), -1.0)
    return out


def node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if "scale" in node:
        m = np.diag(list(node["scale"]) + [1.0]) @ m
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        r = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0.0],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0.0],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ])
        m = r @ m
    if "translation" in node:
        t = np.eye(4)
        t[:3, 3] = node["translation"]
        m = t @ m
    return m


def collect_primitives(doc, blob):
    """Walk the scene graph and yield world-space (positions, uv, color, indices)."""
    nodes = doc.get("nodes", [])
    scene = doc.get("scenes", [{}])[doc.get("scene", 0)]
    stack = [(r, np.eye(4)) for r in scene.get("nodes", [])]
    out = []
    while stack:
        idx, parent = stack.pop()
        node = nodes[idx]
        world = parent @ node_matrix(node)
        for child in node.get("children", []):
            stack.append((child, world))
        if "mesh" not in node:
            continue
        for prim in doc["meshes"][node["mesh"]].get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            attrs = prim["attributes"]
            pos = read_accessor(doc, blob, attrs["POSITION"]).astype(np.float64)
            pos = (world[:3, :3] @ pos.T).T + world[:3, 3]
            uv = None
            if "TEXCOORD_0" in attrs:
                uv = read_accessor(doc, blob, attrs["TEXCOORD_0"]).astype(np.float32)
            col = None
            if "COLOR_0" in attrs:
                col = read_accessor(doc, blob, attrs["COLOR_0"]).astype(np.float32)[:, :3]
                if col.max() > 1.001:
                    col = col / 255.0
            if "indices" in prim:
                tri = read_accessor(doc, blob, prim["indices"]).astype(np.int64).reshape(-1)
            else:
                tri = np.arange(len(pos), dtype=np.int64)
            out.append((pos, uv, col, tri.reshape(-1, 3), prim.get("material")))
    return out


def load_texture(doc, blob, material_index, glb_path):
    """Base-colour texture as a float32 HxWx3 in 0..1, or None."""
    try:
        from PIL import Image
    except ImportError:
        return None
    if material_index is None:
        return None
    mat = doc.get("materials", [])[material_index]
    pbr = mat.get("pbrMetallicRoughness", {})
    tex_info = pbr.get("baseColorTexture")
    if not tex_info:
        return None
    tex = doc["textures"][tex_info["index"]]
    img = doc["images"][tex.get("source", 0)]
    import io
    if "bufferView" in img:
        view = doc["bufferViews"][img["bufferView"]]
        off = view.get("byteOffset", 0)
        raw = blob[off:off + view["byteLength"]]
        handle = io.BytesIO(raw)
    elif "uri" in img and not img["uri"].startswith("data:"):
        handle = os.path.join(os.path.dirname(glb_path), img["uri"])
    else:
        return None
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(handle) as im:
        im = im.convert("RGB")
        arr = np.asarray(im, dtype=np.uint8)
    return arr


# --------------------------------------------------------------------------
# the importer's transform chain, reproduced
# --------------------------------------------------------------------------

def to_unreal_cm(pos, manifest, mode):
    """glTF scene-space metres -> Unreal centimetres, through placement.py.

    `pos` has already had the GLB's node hierarchy applied by the scene walk,
    which is where the node rotation belongs -- Unreal bakes it into the static
    mesh at import. Everything after that is the ACTOR transform, and there is
    exactly one description of it, next door in placement.py, tested without an
    engine.
    """
    place = placement.placement_from(manifest, mode)
    basis = np.array(place.basis, dtype=np.float64)
    out = (basis @ pos.T).T * place.scale + np.array(place.origin)
    out[:, 2] += place.z_offset
    return out


def verify_extent(world, manifest):
    """The render is refused unless the chain reproduces the measured extents."""
    expected = manifest["transform"].get("expected_unreal_extent_cm")
    measured = (world.max(axis=0) - world.min(axis=0))
    if not expected:
        log("no expected_unreal_extent_cm in the manifest; extent unverified")
        return measured, None
    # Component by component, in Unreal axis order. Sorting here would let an
    # axis swap through, and an axis swap is one of the two ways this chain has
    # actually been wrong.
    ratios = [m / e for m, e in zip(measured, expected) if e]
    worst = max(max(ratios), 1.0 / min(ratios))
    log("extent measured %s cm vs expected %s cm (worst ratio %.4g)"
        % ([round(v) for v in measured], [round(v) for v in expected], worst))
    if worst > 1.02:
        raise SystemExit(
            "REFUSING TO RENDER: this script's transform chain does not reproduce the\n"
            "extent the engine measured, so the picture would not be the picture UE has.\n"
            "Fix the chain (or the manifest) before trusting any frame from here.")
    return measured, worst


# --------------------------------------------------------------------------
# camera + rasteriser
# --------------------------------------------------------------------------

class Camera(object):
    """Unreal conventions: left-handed, +X forward, +Y right, +Z up, horizontal FOV."""

    def __init__(self, pos, look, fov_deg, width, height):
        self.pos = np.array(pos, dtype=np.float64)
        f = np.array(look, dtype=np.float64) - self.pos
        n = np.linalg.norm(f)
        if n == 0:
            raise SystemExit("camera position and target are the same point")
        self.forward = f / n
        world_up = np.array([0.0, 0.0, 1.0])
        if abs(np.dot(self.forward, world_up)) > 0.999:
            world_up = np.array([1.0, 0.0, 0.0])
        self.right = np.cross(world_up, self.forward)
        self.right /= np.linalg.norm(self.right)
        self.up = np.cross(self.forward, self.right)
        self.width = int(width)
        self.height = int(height)
        self.tan_h = math.tan(math.radians(float(fov_deg)) * 0.5)
        self.tan_v = self.tan_h * (self.height / float(self.width))

    def project(self, pts):
        """-> (sx, sy, depth). depth <= 0 means behind the camera."""
        rel = pts - self.pos
        depth = rel @ self.forward
        safe = np.where(depth > 1e-6, depth, 1e-6)
        x = (rel @ self.right) / (safe * self.tan_h)
        y = (rel @ self.up) / (safe * self.tan_v)
        sx = (x + 1.0) * 0.5 * self.width
        sy = (1.0 - y) * 0.5 * self.height
        return sx, sy, depth


def rasterise(cam, world, tris, colors):
    """Z-buffered flat-shaded triangle fill.

    Triangles whose screen footprint is a couple of pixels -- the overwhelming
    majority of a photogrammetric shell -- are resolved as points in one
    vectorised pass.  Only the genuinely large ones pay for a per-triangle
    barycentric fill, which keeps a 600k-triangle mesh inside a minute of CPU.
    """
    sx, sy, depth = cam.project(world)
    W, H = cam.width, cam.height
    depth_buf = np.full(W * H, np.inf, dtype=np.float64)
    color_buf = np.zeros((W * H, 3), dtype=np.float32)

    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    in_front = (depth[a] > 1.0) & (depth[b] > 1.0) & (depth[c] > 1.0)
    tri_x = np.column_stack([sx[a], sx[b], sx[c]])
    tri_y = np.column_stack([sy[a], sy[b], sy[c]])
    xmin, xmax = tri_x.min(axis=1), tri_x.max(axis=1)
    ymin, ymax = tri_y.min(axis=1), tri_y.max(axis=1)
    on_screen = (xmax >= 0) & (xmin < W) & (ymax >= 0) & (ymin < H)
    keep = in_front & on_screen
    if getattr(cam, "wrap_guard", False):
        # An equirectangular projection wraps at the seam, and a triangle whose
        # two ends land on opposite edges is not a wide triangle -- it is one
        # crossing the cut. Filling its bounding box would paint a band across
        # the whole image, so drop it; at this triangle density the seam costs
        # a sliver, not a feature.
        keep &= (xmax - xmin) < (W * 0.5)
    tri_col = (colors[a] + colors[b] + colors[c]) / 3.0
    tri_depth = (depth[a] + depth[b] + depth[c]) / 3.0

    small = keep & ((xmax - xmin) < 2.0) & ((ymax - ymin) < 2.0)
    px = np.clip(((tri_x[small].mean(axis=1))).astype(np.int64), 0, W - 1)
    py = np.clip(((tri_y[small].mean(axis=1))).astype(np.int64), 0, H - 1)
    idx = py * W + px
    dz = tri_depth[small]
    np.minimum.at(depth_buf, idx, dz)
    hit = depth_buf[idx] == dz
    color_buf[idx[hit]] = tri_col[small][hit]

    big = np.flatnonzero(keep & ~small)
    log("rasterising %d point-sized and %d filled triangles" % (int(small.sum()), big.size))
    for t in big:
        x0, x1 = int(max(0, math.floor(xmin[t]))), int(min(W - 1, math.ceil(xmax[t])))
        y0, y1 = int(max(0, math.floor(ymin[t]))), int(min(H - 1, math.ceil(ymax[t])))
        if x1 < x0 or y1 < y0:
            continue
        ax, bx, cx = tri_x[t]
        ay, by, cy = tri_y[t]
        area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(area) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((bx - ax) * (gy - ay) - (gx - ax) * (by - ay)) / area
        w1 = ((gx - ax) * (cy - ay) - (cx - ax) * (gy - ay)) / area
        inside = (w0 >= 0) & (w1 >= 0) & ((w0 + w1) <= 1)
        if not inside.any():
            continue
        flat = ((gy[inside] - 0.5).astype(np.int64) * W
                + (gx[inside] - 0.5).astype(np.int64))
        z = tri_depth[t]
        closer = depth_buf[flat] > z
        if closer.any():
            depth_buf[flat[closer]] = z
            color_buf[flat[closer]] = tri_col[t]

    covered = np.isfinite(depth_buf)
    return color_buf.reshape(H, W, 3), depth_buf.reshape(H, W), covered.mean()


def fill_holes(rgb, depth, rounds=2):
    """A shell sampled at vertex density leaves single-pixel gaps; close them
    with a neighbour median so the preview reads as a picture rather than as
    noise.  Purely cosmetic, and it never invents geometry beyond one pixel."""
    out = rgb.copy()
    hole = ~np.isfinite(depth)
    for _ in range(rounds):
        if not hole.any():
            break
        pad = np.pad(out, ((1, 1), (1, 1), (0, 0)))
        padm = np.pad((~hole).astype(np.float32), 1)
        acc = np.zeros_like(out)
        cnt = np.zeros(out.shape[:2], dtype=np.float32)
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                if dy == 1 and dx == 1:
                    continue
                w = padm[dy:dy + out.shape[0], dx:dx + out.shape[1]]
                acc += pad[dy:dy + out.shape[0], dx:dx + out.shape[1]] * w[:, :, None]
                cnt += w
        fillable = hole & (cnt >= 3)
        out[fillable] = acc[fillable] / cnt[fillable][:, None]
        hole = hole & ~fillable
    return out


class Equirect(object):
    """A full 360x180 view from one point -- the projection that answers
    'where in this shell IS the castle city' in a single image."""

    wrap_guard = True

    def __init__(self, pos, look, width, height):
        self.pos = np.array(pos, dtype=np.float64)
        f = np.array(look, dtype=np.float64) - self.pos
        f[2] = 0.0
        n = np.linalg.norm(f)
        self.forward = (f / n) if n > 1e-9 else np.array([1.0, 0.0, 0.0])
        self.right = np.cross(np.array([0.0, 0.0, 1.0]), self.forward)
        self.right /= np.linalg.norm(self.right)
        self.up = np.array([0.0, 0.0, 1.0])
        self.width, self.height = int(width), int(height)

    def project(self, pts):
        rel = pts - self.pos
        dist = np.linalg.norm(rel, axis=1)
        safe = np.where(dist > 1e-6, dist, 1e-6)
        az = np.arctan2(rel @ self.right, rel @ self.forward)
        el = np.arcsin(np.clip(rel[:, 2] / safe, -1.0, 1.0))
        sx = (az / math.pi + 1.0) * 0.5 * self.width
        sy = (0.5 - el / math.pi) * self.height
        return sx, sy, dist


def orientation_report(cam, world, tris):
    """Where the shell's SKYLINE is, and whether the hero camera can see it.

    The question this exists to answer is not "is the castle city ahead" in the
    abstract -- it is whether the 1,580 credits of castle city land inside the
    frame the world opens on. Those are different questions, and a circular
    mean answers neither: the towers here ring the viewpoint in two clusters,
    and the mean of two clusters points at the gap between them.

    So this reports the frustum directly, in both axes. Elevation is the one
    that gets forgotten, and it is the one that decides this frame.
    """
    centroid = world[tris].mean(axis=1)
    rel = centroid - cam.pos
    dist = np.linalg.norm(rel, axis=1)
    fwd = np.array([cam.forward[0], cam.forward[1], 0.0])
    fwd /= max(np.linalg.norm(fwd), 1e-9)
    right = np.cross(np.array([0.0, 0.0, 1.0]), fwd)
    az = np.degrees(np.arctan2(rel @ right, rel @ fwd))
    el = np.degrees(np.arcsin(np.clip(rel[:, 2] / np.maximum(dist, 1e-6), -1.0, 1.0)))

    half_h = math.degrees(math.atan(cam.tan_h))
    half_v = math.degrees(math.atan(cam.tan_v))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, cam.forward[2]))))
    lo, hi = pitch - half_v, pitch + half_v

    far = dist > np.percentile(dist, 75)
    sky = far & (el > 5.0)
    in_az = np.abs(az) <= half_h
    in_el = (el >= lo) & (el <= hi)

    lines = [
        "TRIANGLES                  %d" % len(tris),
        "camera pitch               %+.1f deg, frame covers elevation %+.1f .. %+.1f deg"
        % (pitch, lo, hi),
        "                           and azimuth %+.1f .. %+.1f deg" % (-half_h, half_h),
        "geometry elevation         p50 %+.1f  p90 %+.1f  p99 %+.1f deg"
        % (np.percentile(el, 50), np.percentile(el, 90), np.percentile(el, 99)),
        "SKYLINE (far + above the horizon): %d triangles, %.1f%% of the mesh"
        % (int(sky.sum()), 100.0 * sky.mean()),
    ]
    if sky.any():
        lines += [
            "  of the skyline, inside the frame's AZIMUTH   %.1f%%"
            % (100.0 * in_az[sky].mean()),
            "  of the skyline, inside the frame's ELEVATION %.1f%%"
            % (100.0 * in_el[sky].mean()),
            "  ACTUALLY IN FRAME                            %.1f%%"
            % (100.0 * (in_az & in_el)[sky].mean()),
            "  skyline elevation p50 %+.1f  p90 %+.1f deg"
            % (np.percentile(el[sky], 50), np.percentile(el[sky], 90)),
        ]
        # Which yaw would put the most skyline in frame. Reported as a fact
        # about the mesh, not applied: the hero camera also frames authored
        # gameplay geometry, and that is not this script's call to make.
        best, scores = None, []
        for yaw in range(-180, 180, 15):
            shifted = (az[sky] - yaw + 180.0) % 360.0 - 180.0
            score = float(((np.abs(shifted) <= half_h) & in_el[sky]).mean())
            scores.append((score, yaw))
            if best is None or score > best[0]:
                best = (score, yaw)
        lines.append("  best artistic yaw for the skyline: %+d deg -> %.1f%% in frame "
                     "(currently %.1f%%)"
                     % (best[1], 100.0 * best[0], 100.0 * (in_az & in_el)[sky].mean()))
        if best[0] < 0.10:
            lines.append("  NO yaw brings the skyline into this frame. The limit is "
                         "ELEVATION, not rotation -- the camera is pitched %+.1f deg "
                         "and the towers sit around %+.1f deg."
                         % (pitch, np.percentile(el[sky], 50)))
    hist, edges = np.histogram(az, bins=12, range=(-180, 180))
    lines.append("azimuth histogram of ALL geometry (12 x 30 deg, from forward):")
    peak = hist.max() or 1
    for h, edge in zip(hist, edges[:-1]):
        lines.append("  %+4.0f..%+4.0f  %-30s %5.1f%%"
                     % (edge, edge + 30, "#" * int(round(30.0 * h / peak)),
                        100.0 * h / len(tris)))
    return "\n".join(lines)


def save_png(path, rgb):
    from PIL import Image
    arr = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(path)
    log("wrote %s (%dx%d)" % (path, arr.shape[1], arr.shape[0]))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--world", default=os.path.join(HERE, "worlds", "royal-garden-backdrop"))
    ap.add_argument("--mesh", default=None, help="override the manifest's source mesh")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--camera", default="0,-1150,430")
    ap.add_argument("--look", default="0,120,170")
    ap.add_argument("--fov", type=float, default=62.0)
    ap.add_argument("--yaw", type=float, default=0.0,
                    help="extra artistic yaw to preview, degrees")
    ap.add_argument("--pano", action="store_true", help="also render a 360 equirectangular")
    args = ap.parse_args()

    manifest = json.load(open(os.path.join(args.world, "manifest.json")))
    mesh_rel = args.mesh or manifest["source_mesh"]["file"]
    mesh = mesh_rel if os.path.isabs(mesh_rel) else os.path.join(args.world, mesh_rel)
    if not os.path.exists(mesh):
        raise SystemExit("mesh not found: %s" % mesh)
    log("mesh %s (%.1f MB)" % (mesh, os.path.getsize(mesh) / 1e6))

    if args.yaw:
        manifest["transform"]["unreal_rotation_deg"] = [0.0, 0.0, args.yaw]
        log("previewing an artistic yaw of %+.1f deg" % args.yaw)

    doc, blob = parse_glb(mesh)
    log("glTF extensions: %s" % (doc.get("extensionsUsed") or []))
    prims = collect_primitives(doc, blob)
    log("%d primitive(s)" % len(prims))

    verts, tri_list, cols, base = [], [], [], 0
    texture = None
    for pos, uv, col, tri, mat in prims:
        if col is None:
            if texture is None:
                texture = load_texture(doc, blob, mat, mesh)
                if texture is not None:
                    log("base-colour texture %dx%d" % (texture.shape[1], texture.shape[0]))
            if texture is not None and uv is not None:
                th, tw = texture.shape[:2]
                u = np.clip((np.mod(uv[:, 0], 1.0) * tw).astype(np.int64), 0, tw - 1)
                v = np.clip((np.mod(uv[:, 1], 1.0) * th).astype(np.int64), 0, th - 1)
                col = texture[v, u].astype(np.float32) / 255.0
            else:
                col = np.full((len(pos), 3), 0.6, dtype=np.float32)
        verts.append(pos)
        cols.append(col)
        tri_list.append(tri + base)
        base += len(pos)
    raw = np.concatenate(verts)
    colors = np.concatenate(cols).astype(np.float32)
    tris = np.concatenate(tri_list)
    log("%d vertices, %d triangles" % (len(raw), len(tris)))

    world = to_unreal_cm(raw, manifest, manifest["transform"].get("placement_mode", ""))
    verify_extent(world, manifest)

    os.makedirs(args.out, exist_ok=True)
    cam = Camera([float(v) for v in args.camera.split(",")],
                 [float(v) for v in args.look.split(",")],
                 args.fov, args.width, args.height)
    report = orientation_report(cam, world, tris)
    print(report)
    with open(os.path.join(args.out, "orientation.txt"), "w") as fh:
        fh.write(report + "\n")

    tag = "yaw%+03d" % round(args.yaw)
    rgb, depth, covered = rasterise(cam, world, tris, colors)
    log("frustum coverage %.1f%%" % (covered * 100.0))
    save_png(os.path.join(args.out, "herocam0-%s.png" % tag), fill_holes(rgb, depth))

    if args.pano:
        pano = Equirect(cam.pos, [float(v) for v in args.look.split(",")], 2048, 1024)
        prgb, pdepth, pcov = rasterise(pano, world, tris, colors)
        log("panorama coverage %.1f%%" % (pcov * 100.0))
        save_png(os.path.join(args.out, "panorama-%s.png" % tag), fill_holes(prgb, pdepth))
    return 0


if __name__ == "__main__":
    sys.exit(main())
