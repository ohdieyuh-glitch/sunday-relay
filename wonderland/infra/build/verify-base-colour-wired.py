#!/usr/bin/env python3
"""The BaseColor parameter must actually reach the master's base-colour output.

WHY THIS EXISTS

Wonderland renders grey, and a long list of explanations has been refuted by
the rendered frame that tested each one: specular, fog, the sky's colour,
bloom, the ACES shoulder, ambient wash, the batch material path, and the
metal/dielectric split. The material INSTANCES were probed in a real editor and
are correct -- MI_mush_red is parent M_WLMaster with BaseColor
(0.740,0.160,0.260) and AlbedoTex T_cap_a.

The measurement that says where to look next is the palette test. Every
material's albedo was pushed away from its own luma -- mean palette saturation
0.427 -> 0.615, mush_red to a pure red -- and the delivered frame moved by
about TWO VALUES PER CHANNEL. A surface that answers the LIGHT but not its own
ALBEDO is a surface whose albedo is not connected to anything.

So this walks the master material's graph, offline, and asks the one question
none of the other gates ask: is the BaseColor parameter UPSTREAM of whatever is
plugged into MP_BASE_COLOR?

It is deliberately about REACHABILITY, not about the presence of a node. The
master has 68 expressions and a parameter named BaseColor; that was already
confirmed in a live editor and it is not the question. A parameter can exist,
be set on every instance, and drive nothing at all.
"""
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")


def main():
    spec = importlib.util.spec_from_file_location(
        "wl_dryrun_bc", os.path.join(HERE, "verify-generator-dryrun.py"))
    dry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dry)
    stub = dry.make_unreal()

    # id(expression) -> readable name, plus the edges between them.
    names = {}
    edges = {}          # dst id -> set of src ids
    prop_src = {}       # property name -> src id
    made = []

    mel = stub.MaterialEditingLibrary

    def note_expr(mat, cls, *a, **kw):
        e = dry.Any("expr")
        cn = str(getattr(cls, "_name", cls))
        names[id(e)] = cn
        made.append(e)
        return e

    def note_param_name(e, key, val):
        # The generator sets parameter_name right after creating the node.
        if key == "parameter_name":
            names[id(e)] = "param:" + str(val)

    real_setattr = dry.Any.__setattr__

    def note_connect_expr(src, out, dst, inp):
        edges.setdefault(id(dst), set()).add(id(src))

    def note_connect_prop(src, out, prop):
        prop_src[str(getattr(prop, "_name", prop))] = id(src)

    mel.create_material_expression = note_expr
    mel.connect_material_expressions = note_connect_expr
    mel.connect_material_property = note_connect_prop

    # set_editor_property is how parameter_name is assigned; wrap it so a node
    # can be identified by the parameter it carries.
    orig_call = dry.Any.__call__

    def spy_call(self, *a, **kw):
        nm = getattr(self, "_name", "")
        if nm.endswith("set_editor_property") and len(a) >= 2 and a[0] == "parameter_name":
            owner = getattr(self, "_owner", None)
            if owner is not None:
                names[id(owner)] = "param:" + str(a[1])
        return orig_call(self, *a, **kw)

    # Attribute access has to remember WHICH object it came from, or
    # set_editor_property cannot say whose parameter it is naming.
    orig_getattr = dry.Any.__getattr__

    def spy_getattr(self, k):
        out = orig_getattr(self, k)
        try:
            object.__setattr__(out, "_owner", self)
        except Exception:
            pass
        return out

    dry.Any.__getattr__ = spy_getattr
    dry.Any.__call__ = spy_call
    sys.modules["unreal"] = stub
    ns = {"__name__": "__wl_bcwired__", "__file__": GEN}
    try:
        exec(compile(io.open(GEN, encoding="utf8").read(), GEN, "exec"), ns)
    finally:
        dry.Any.__call__ = orig_call
        dry.Any.__getattr__ = orig_getattr

    print("material expressions created : %d" % len(made))
    print("edges recorded               : %d" % sum(len(v) for v in edges.values()))
    print("material properties driven   : %s"
          % ", ".join(sorted(prop_src.keys())[:8]))
    print()

    base_keys = [k for k in prop_src if "BASE_COLOR" in k.upper()]
    if not base_keys:
        print("FAIL: nothing at all is connected to MP_BASE_COLOR. Every surface "
              "in Wonderland would render with the master's default colour, "
              "whatever its palette entry says.")
        return 1

    root = prop_src[base_keys[0]]

    # Walk upstream from whatever drives base colour.
    seen, stack, found = set(), [root], None
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        if names.get(cur, "").startswith("param:BaseColor"):
            found = cur
            break
        stack.extend(edges.get(cur, ()))

    print("base colour is driven by     : %s" % names.get(root, "?"))
    print("upstream nodes reachable     : %d" % len(seen))
    print("BaseColor parameter upstream : %s" % ("YES" if found else "NO"))
    print()

    if found is None:
        print("FAIL: the BaseColor parameter is NOT upstream of MP_BASE_COLOR.")
        print("      Every material instance sets it, every instance probes")
        print("      correct, and it drives nothing -- which is exactly a world")
        print("      that answers the light and ignores its own palette.")
        return 1
    print("PASS: the palette reaches the master's base colour output.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
