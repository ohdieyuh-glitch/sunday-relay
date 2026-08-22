#!/usr/bin/env python3
"""Prove the C++ that is supposed to run can actually be reached.

THE FAILURE THIS EXISTS FOR. AWonderlandPlayerController was written, compiled,
shipped in the packaged binary — its log format strings are in there, verbatim —
and never executed once. With no AGameModeBase subclass in the project and no
GlobalDefaultGameMode in DefaultEngine.ini, a packaged Unreal game uses stock
APlayerController. BeginPlay never ran, `-CinematicView` and `-HeroCam=N` were
never parsed, and every hero-shot capture returned the same view no matter which
camera was requested. Measured on the L4 2026-08-22: HeroCam0, HeroCam3 (1,300 uu
away) and HeroCam6 produced three frames of identical composition, and the whole
premise of comparing two arrival cameras was a comparison of one.

Nothing failed. The class was simply unreachable, which no compiler, cooker or
gate could see, because being compiled and being reachable are different facts.

So this asserts the chain that makes it reachable, from the config through to
the class:

    DefaultEngine.ini names a GlobalDefaultGameMode
      -> that GameMode is a real class in Source/Wonderland
        -> and it sets PlayerControllerClass
          -> to a PlayerController that is also a real class here

It does NOT prove BeginPlay ran. Only a frame does that, and the capture
comparison refuses any frame whose camera did not identify itself.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WL = os.path.dirname(os.path.dirname(HERE))
SOURCE = os.path.join(WL, "Source", "Wonderland")
ENGINE_INI = os.path.join(WL, "Config", "DefaultEngine.ini")


def fail(msg):
    sys.stderr.write("verify-gameplay-classes: %s\n" % msg)
    sys.exit(1)


def strip_comments(text):
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith(";"))


def read(path):
    with io.open(path, encoding="utf8") as handle:
        return handle.read()


def class_declared(name):
    """Is `name` declared as a UCLASS in this module's headers?"""
    for entry in os.listdir(SOURCE):
        if not entry.endswith(".h"):
            continue
        body = read(os.path.join(SOURCE, entry))
        if re.search(r"\bclass\s+(?:\w+_API\s+)?%s\s*:" % re.escape(name), body):
            return entry
    return None


def main():
    if not os.path.exists(ENGINE_INI):
        fail("no %s — a packaged build with no engine config opens the ENGINE's "
             "default map, which is how this project once streamed a template "
             "world while every other stage reported success." % ENGINE_INI)

    ini = strip_comments(read(ENGINE_INI))
    match = re.search(r"^GlobalDefaultGameMode\s*=\s*(\S+)\s*$", ini, re.M)
    if not match:
        fail("DefaultEngine.ini sets no GlobalDefaultGameMode. Without one a "
             "packaged build uses stock APlayerController, so "
             "AWonderlandPlayerController::BeginPlay never runs and -CinematicView "
             "/ -HeroCam=N are never read. Every hero capture then returns the "
             "same view and looks like a working comparison.")
    path = match.group(1)

    gm = path.rsplit(".", 1)[-1]
    header = class_declared("A" + gm) or class_declared(gm)
    if header is None:
        fail("GlobalDefaultGameMode names %s, and no class A%s is declared in %s. "
             "A setting that resolves to nothing is worse than no setting: the "
             "engine falls back silently to its own default."
             % (path, gm, SOURCE))

    module = path.split(".", 1)[0].rsplit("/", 1)[-1]
    if module != "Wonderland":
        fail("GlobalDefaultGameMode points at module '%s', not Wonderland. The "
             "class would have to be cooked from somewhere this project does not "
             "build." % module)

    impl = os.path.join(SOURCE, header[:-2] + ".cpp")
    if not os.path.exists(impl):
        fail("%s declares the GameMode and there is no %s to set anything in it."
             % (header, os.path.basename(impl)))
    body = read(impl)
    pc = re.search(r"PlayerControllerClass\s*=\s*(A\w+)::StaticClass", body)
    if not pc:
        fail("%s never sets PlayerControllerClass. The GameMode exists and "
             "changes nothing, which is the same outcome as having none."
             % os.path.basename(impl))
    controller = pc.group(1)
    if class_declared(controller) is None:
        fail("%s sets PlayerControllerClass to %s, which is not declared in %s."
             % (os.path.basename(impl), controller, SOURCE))

    # The controller has to be the one that reads the cinematic flags, or the
    # chain is intact and still points somewhere useless.
    ctrl_impl = os.path.join(SOURCE, class_declared(controller)[:-2] + ".cpp")
    if os.path.exists(ctrl_impl):
        ctrl = read(ctrl_impl)
        for flag in ("CinematicView", "HeroCam="):
            if flag not in ctrl:
                fail("%s does not read -%s. The GameMode routes to a controller "
                     "that cannot select a hero camera."
                     % (os.path.basename(ctrl_impl), flag.rstrip("=")))
        if "HERO_CAM_SERVED" not in ctrl:
            fail("%s selects a hero camera without reporting which one answered. "
                 "A frame that cannot name its own camera is not evidence."
                 % os.path.basename(ctrl_impl))

    print("verify-gameplay-classes: ok — GlobalDefaultGameMode=%s -> A%s (%s) -> "
          "%s, which reads -CinematicView/-HeroCam and reports HERO_CAM_SERVED."
          % (path, gm, header, controller))
    return 0


if __name__ == "__main__":
    sys.exit(main())
