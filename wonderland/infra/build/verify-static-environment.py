#!/usr/bin/env python3
"""Static world geometry must be static. This proves it without an engine.

THE REPORT THIS CAME FROM

    "The founder is seeing the Wonderland environment move/pulse globally like
     a heartbeat. STOP THIS. STATIC WORLD GEOMETRY SHOULD BE STATIC."

It was real, and it was one material graph. `M_WLMaster` wired a Time->Sine
straight into world-position-offset for the WHOLE world, and the amplitude
table named ten VEGETATION materials alongside the Dogs: 22,794 instances --
16.5% of the world, 15.2% of the hero frame -- swelling and shrinking on a
single sine with no per-instance phase. Every hedge, rose, petal and leaf
reached its widest on the same frame. `M_WLLeaf` did it a second time by
carrying a BreatheAmp DEFAULT of 4.5, so leaf cards swayed without being
named in any table at all.

WHY A ZERO AMPLITUDE IS NOT THE FIX, AND WHY THIS GATE CHECKS THE SWITCH

A material with a connected WPO output is not just doing a little vertex
maths. The renderer must treat every primitive wearing it as MOVING:

  * its virtual-shadow-map pages cannot stay cached and are re-rasterised
    every frame -- page caching is most of what makes a static world cheap;
  * Nanite must take the programmable-raster path instead of the fixed one;
  * distance-field and Lumen representations keep being invalidated.

An amplitude of 0 leaves the output CONNECTED. The primitive pays all of that
to move by zero. Only a STATIC SWITCH removes the cost: with `Animated` false
the branch folds at compile time and the shader permutation has no WPO output
at all. So "is the amplitude 0" is the wrong question and this gate does not
ask it. It asks whether the switch exists, whether it defaults to off, and who
is on the allow-list.

WHAT IT ENFORCES

  1. Every MP_WORLD_POSITION_OFFSET connection comes from a
     StaticSwitchParameter named `Animated` that defaults to False.
  2. No WPO amplitude parameter has a non-zero DEFAULT -- the inherited-motion
     trap that made the first version of the motion budget report a clean
     world while every leaf card was swaying.
  3. Everything on the allow-list is a character or is airborne/liquid.
     Anything ROOTED in the ground is refused by name.

Point 3 is a hand-maintained list, deliberately. Adding a rooted material to
the world's motion budget should cost somebody a decision and a line in this
file, not happen because a table was convenient to extend.

    python3 verify-static-environment.py     # 0 clean, 1 with findings
"""
import ast
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")

# Things whose whole character is movement. A Dog that does not breathe looks
# stuffed; a petal hanging motionless in mid-air or a still fountain looks
# broken. Everything else in Wonderland is scenery and holds still.
ALLOWED = {
    "dog_body": "character", "dog_pink": "character", "dog_gray": "character",
    "dog_tan": "character", "dog_brown": "character",
    "petal_air": "airborne", "float_glow": "airborne", "magic_cyan": "airborne",
    "water": "liquid", "spray": "liquid",
}
# Named so the refusal can say WHY rather than "not on the list". These are the
# ten that produced the heartbeat.
ROOTED = {
    "foliage", "foliage_hi", "foliage_deep", "foliage_spr", "leaf", "leaf_hi",
    "petal_pink", "petal_violet", "rose", "rose_pink",
    "leafcard", "leafcard_hi", "leafcard_deep",
    "stone", "cobble", "ground", "gold", "roof_pink", "roof_rose", "spire",
}


def main():
    src = io.open(GEN, encoding="utf8").read()
    findings = []

    # ---- 1. every WPO connection is gated ---------------------------------
    wpo = [m for m in re.finditer(
        r"mel\.connect_material_property\(\s*(\w+),\s*\"\",\s*"
        r"unreal\.MaterialProperty\.MP_WORLD_POSITION_OFFSET\s*\)", src)]
    if not wpo:
        findings.append("no MP_WORLD_POSITION_OFFSET connection found at all — "
                        "this gate reads the generator by shape and the shape "
                        "has changed; it cannot prove anything until updated")
    for m in wpo:
        node = m.group(1)
        # the node feeding WPO must have been created as a static switch named
        # Animated, defaulting to False, within the same function body
        decl = re.search(
            re.escape(node) + r"\s*=\s*mel\.create_material_expression\(\s*\w+,\s*"
            r"unreal\.MaterialExpressionStaticSwitchParameter", src)
        if not decl:
            findings.append(
                "WPO is driven by `%s`, which is not a StaticSwitchParameter. "
                "Every primitive wearing this master becomes a moving primitive "
                "for shadows and raster, whatever the amplitude says." % node)
            continue
        after = src[decl.end():decl.end() + 600]
        if 'set_editor_property("parameter_name", "Animated")' not in after:
            findings.append("the switch feeding WPO via `%s` is not named "
                            "`Animated`; nothing can turn it on per material" % node)
        if not re.search(r'set_editor_property\("default_value", False\)', after):
            findings.append("the `Animated` switch feeding WPO via `%s` does not "
                            "default to False, so materials inherit motion" % node)

    # ---- 2. no non-zero amplitude DEFAULTS --------------------------------
    for pname, default in re.findall(
            r'set_editor_property\("parameter_name", "(BreatheAmp|BobAmp)"\)\s*\n'
            r'\s*\w+\.set_editor_property\("default_value", ([0-9.]+)\)', src):
        if float(default) != 0.0:
            findings.append(
                "%s has a DEFAULT of %s. A material inherits motion without being "
                "named in any table — this is exactly how the leaf cards swayed "
                "for a whole sprint with nothing in the source saying so."
                % (pname, default))
    for pname, default in re.findall(
            r'param\(unreal\.MaterialExpressionScalarParameter,\s*'
            r'"(BreatheAmp|BobAmp)",\s*\d+,\s*([0-9.]+)\)', src):
        if float(default) != 0.0:
            findings.append("%s has a DEFAULT of %s on the main master (see above)"
                            % (pname, default))

    # ---- 3. who is on the allow-list --------------------------------------
    tables = {}
    for node in ast.walk(ast.parse(src, GEN)):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Dict):
            continue
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in ("breathe", "bob"):
                try:
                    tables[t.id] = ast.literal_eval(node.value)
                except (ValueError, SyntaxError):
                    findings.append("the `%s` table is not a literal, so this gate "
                                    "cannot read what moves" % t.id)
    if "breathe" not in tables or "bob" not in tables:
        findings.append("no `breathe`/`bob` motion tables in the generator — the "
                        "allow-list this gate checks has moved or gone")
    named = set(tables.get("breathe", {})) | set(tables.get("bob", {}))
    for mat in sorted(named):
        if mat in ROOTED:
            findings.append(
                "`%s` is ROOTED IN THE GROUND and is named in the motion tables. "
                "Static environment stays static: a hedge that inflates is the "
                "heartbeat the founder reported." % mat)
        elif mat not in ALLOWED:
            findings.append(
                "`%s` moves but is not on this gate's allow-list. If motion is "
                "genuinely intentional, add it to ALLOWED with the reason; the "
                "list exists so that costs a decision." % mat)

    # ---- 4. the Dogs must stay locked to themselves -----------------------
    spread = {}
    for node in ast.walk(ast.parse(src, GEN)):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "phase_spread":
                    try:
                        spread = ast.literal_eval(node.value)
                    except (ValueError, SyntaxError):
                        pass
    for mat in sorted(named):
        if ALLOWED.get(mat) == "character" and spread.get(mat, None) != 0.0:
            findings.append(
                "`%s` is a character material without PhaseSpread 0. A Dog is many "
                "instanced parts of ONE body; per-instance phase would make its "
                "parts disagree, which reads as a broken object, not a breath." % mat)

    for f in findings:
        sys.stderr.write("  FINDING: %s\n" % f)
    if findings:
        sys.stderr.write("verify-static-environment: %d finding(s)\n" % len(findings))
        return 1
    print("verify-static-environment OK — %d material(s) move (%s); "
          "every WPO output is behind an `Animated` static switch defaulting off, "
          "and no amplitude carries a non-zero default"
          % (len(named), ", ".join(sorted(named))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
