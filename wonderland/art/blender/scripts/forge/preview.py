"""Rendering the kit, so a claim about how it looks can be checked.

WHY THIS IS IN THE PIPELINE AND NOT A CONVENIENCE. The world session's own
handoff records the trap this avoids, twice: PASS 31 notes that the offline
mass model "over-fills so badly 411 new towers moved nothing", and
`WONDERLAND_WORLD_CURRENT.md` heads its numbers with "RENDERED THIS SESSION:
Nothing." A silhouette kit whose silhouettes nobody looked at is a folder of
plausible Python. Cycles on CPU renders one of these in a couple of seconds,
so there is no reason to ship an asset unseen.

WHAT THESE RENDERS ARE AND ARE NOT. They are Blender/Cycles, with the V2
palette's base colours on a Principled BSDF and a two-light rig. They show
form, proportion, silhouette and the stone/gold/roof balance -- which is what
the modelling decisions actually turn on. They are NOT a preview of the
Unreal frame: no V2 material graph, no Lumen, no sky, no fog, none of the
world's own lighting. `WONDERLAND_BLENDER_CURRENT.md` says so where it links
them, because a render captioned as something it is not is worse than none.
"""

import math
import os

import bpy
from mathutils import Vector


# --------------------------------------------------------------------------
# the rig
# --------------------------------------------------------------------------


def rig(sun_energy=3.2, sun_angle=(56.0, 0.0, 128.0), sky=0.45, ground=True):
    """A key sun, a soft sky, and a ground the shadow lands on.

    The sun's elevation is deliberately high-ish and its azimuth off-axis so
    every module gets one lit face, one half-lit face and one in shadow. A
    module that reads as a single flat mass under this rig will read as one in
    the world too, and that is the point of looking.
    """
    scene = bpy.context.scene
    world = bpy.data.worlds.get("ForgePreviewWorld") or bpy.data.worlds.new("ForgePreviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs[0].default_value = (0.62, 0.70, 0.88, 1.0)   # lavender sky
        bg.inputs[1].default_value = float(sky)
    scene.world = world

    sun_data = bpy.data.lights.new("ForgeSun", type="SUN")
    sun_data.energy = float(sun_energy)
    sun_data.angle = math.radians(2.5)
    sun = bpy.data.objects.new("ForgeSun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = tuple(math.radians(a) for a in sun_angle)

    fill_data = bpy.data.lights.new("ForgeFill", type="SUN")
    fill_data.energy = float(sun_energy) * 0.22
    fill = bpy.data.objects.new("ForgeFill", fill_data)
    scene.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(70.0), 0.0, math.radians(-40.0))

    if ground:
        me = bpy.data.meshes.new("ForgeGround")
        S = 4000.0
        me.from_pydata([(-S, -S, 0.0), (S, -S, 0.0), (S, S, 0.0), (-S, S, 0.0)],
                       [], [(0, 1, 2, 3)])
        me.update()
        mat = bpy.data.materials.new("ForgeGroundMat")
        mat.use_nodes = True
        b = mat.node_tree.nodes.get("Principled BSDF")
        if b is not None:
            b.inputs["Base Color"].default_value = (0.30, 0.33, 0.26, 1.0)
            b.inputs["Roughness"].default_value = 0.92
        me.materials.append(mat)
        obj = bpy.data.objects.new("ForgeGround", me)
        scene.collection.objects.link(obj)
    return scene


def bounds(objs):
    """World-space bbox of a list of objects, as (min Vector, max Vector).

    The `view_layer.update()` is load-bearing and cost a wrong render: setting
    `obj.location` does not refresh `obj.matrix_world` until the dependency
    graph is evaluated, so a bounds taken straight after a move reads every
    object as still at the origin -- and the camera then frames one module out
    of twenty-three, which is exactly what the first lineup did.
    """
    bpy.context.view_layer.update()
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for a in range(3):
                lo[a] = min(lo[a], w[a])
                hi[a] = max(hi[a], w[a])
    return lo, hi


def frame_camera(objs, res, azimuth=38.0, elevation=14.0, margin=1.06,
                 lens=52.0, target_bias=0.50):
    """Put a camera where the whole of `objs` fits, looking at it.

    Fits the PROJECTED extents, not a bounding sphere. The sphere version
    filled about a fifth of the frame on a contact sheet: a row of 23 modules
    is 200 m wide and 25 m tall, its diagonal is dominated by the width, and
    backing off far enough to contain that diagonal in the SHORT axis leaves
    most of the picture as sky. So the horizontal and vertical half-extents are
    measured in the camera's own basis and each is solved separately against
    its own field of view; the larger answer wins.
    """
    scene = bpy.context.scene
    lo, hi = bounds(objs)
    centre = (lo + hi) * 0.5

    cam_data = bpy.data.cameras.new("ForgeCam")
    cam_data.lens = float(lens)
    cam_data.sensor_fit = "HORIZONTAL"
    cam = bpy.data.objects.new("ForgeCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    az, el = math.radians(azimuth), math.radians(elevation)
    view = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el),
                   math.sin(el)))                       # camera -> subject is -view
    right = view.cross(Vector((0.0, 0.0, 1.0)))
    right = right.normalized() if right.length > 1e-6 else Vector((1.0, 0.0, 0.0))
    up = right.cross(-view).normalized()

    target = Vector((centre.x, centre.y, lo.z + (hi.z - lo.z) * target_bias))
    half_r = half_u = 0.0
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            d = (o.matrix_world @ v.co) - target
            half_r = max(half_r, abs(d.dot(right)))
            half_u = max(half_u, abs(d.dot(up)))
    half_r = max(half_r, 0.5)
    half_u = max(half_u, 0.5)

    sensor_w = cam_data.sensor_width
    sensor_h = sensor_w * float(res[1]) / float(res[0])
    hfov = 2.0 * math.atan(sensor_w * 0.5 / cam_data.lens)
    vfov = 2.0 * math.atan(sensor_h * 0.5 / cam_data.lens)
    dist = max(half_r / math.tan(hfov * 0.5),
               half_u / math.tan(vfov * 0.5)) * float(margin)

    cam.location = target + view * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    return cam


def render(path, res=(900, 700), samples=24, engine="CYCLES"):
    """Render the current scene. Cycles on CPU -- there is no GPU on this host,
    and Workbench/EEVEE need an EGL surface this container has no library for."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = engine
    scene.render.resolution_x, scene.render.resolution_y = int(res[0]), int(res[1])
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    if engine == "CYCLES":
        scene.cycles.samples = int(samples)
        scene.cycles.device = "CPU"
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 4
    bpy.ops.render.render(write_still=True)
    return path


def lineup(groups, gap=4.0, align="ground"):
    """Lay out already-built object groups in a row along +X.

    `groups` is a list of lists of objects, each group already sitting at the
    origin with its footing at z = 0. Returns every object, positioned. A row
    is a better contact sheet than a grid of separate renders: it puts every
    module at ONE scale in ONE frame, which is the only way to see whether a
    kit's proportions agree with each other.
    """
    placed = []
    cursor = 0.0
    for objs in groups:
        if not objs:
            continue
        lo, hi = bounds(objs)
        width = max(hi.x - lo.x, 0.1)
        cx = (lo.x + hi.x) * 0.5
        cy = (lo.y + hi.y) * 0.5
        dx = cursor + width * 0.5 - cx
        for o in objs:
            o.location = (o.location.x + dx, o.location.y - cy, o.location.z)
            placed.append(o)
        cursor += width + float(gap)
    bpy.context.view_layer.update()
    return placed


def clear_rig():
    """Remove cameras, lights and the ground so the next render starts clean."""
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT") or o.name.startswith("ForgeGround"):
            bpy.data.objects.remove(o, do_unlink=True)
