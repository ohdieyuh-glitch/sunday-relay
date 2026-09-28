"""Find names LOADED but never BOUND anywhere in the file or by the job runner.

py_compile accepts `gz` where `ground_z` was meant; that NameError cost this lane a run. This is a
deliberately over-inclusive scan: it collects every binding in the module (assignments, for targets,
comprehension targets, function/class names, arguments, imports, with/except aliases, globals) and
reports Name loads that match none of them, no builtin, and none of the runner's injected globals.
Over-inclusive means it cannot prove correctness, only surface the obvious miss -- which is the one
that has actually happened.
"""
import ast
import builtins
import sys

INJECTED = {"unreal", "CHANNEL", "RESULT", "emit", "JOB", "ARGS"}


def bound_names(tree):
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            out.add(n.id)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(n.name)
            a = getattr(n, "args", None)
            if a:
                for arg in list(a.args) + list(a.posonlyargs) + list(a.kwonlyargs):
                    out.add(arg.arg)
                if a.vararg:
                    out.add(a.vararg.arg)
                if a.kwarg:
                    out.add(a.kwarg.arg)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for al in n.names:
                out.add((al.asname or al.name).split(".")[0])
        elif isinstance(n, ast.ExceptHandler) and n.name:
            out.add(n.name)
        elif isinstance(n, ast.Global):
            out.update(n.names)
    return out


def main(path):
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    known = bound_names(tree) | set(dir(builtins)) | INJECTED
    bad = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in known:
            bad.setdefault(n.id, []).append(n.lineno)
    if not bad:
        print("no unbound names in %s" % path)
        return 0
    for name, lines in sorted(bad.items()):
        print("UNBOUND  %-24s lines %s" % (name, lines))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
