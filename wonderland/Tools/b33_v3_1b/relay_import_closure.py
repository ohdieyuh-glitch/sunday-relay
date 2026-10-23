"""relay_import_closure.py -- read-only check of what a relay entry file imports at a pinned commit (W2DEV). DIAGNOSTIC tool, not evidence by itself.
Run: python -I -B relay_import_closure.py <sunday-relay repo> <commit> <entry, e.g. relay-bridge/dev-social-server.ts> <node_modules dir> [archive paths ...]
It walks the entry's static imports (import/export ... from '...', import('...'), require('...')) through `git show <commit>:<path>` only (no
checkout, nothing built or run), resolving relative imports the way esbuild does for .ts/.js/index files. It prints every repo file in the
closure, every bare package and whether <node_modules>/<package> exists, and exits 1 if a relative import does not resolve at the commit, a
file falls outside the archive paths (default: relay-bridge src package.json), or a bare package is missing (node: built-ins are fine).
"""
import os, posixpath, re, subprocess, sys

IMPORT = re.compile(r"""(?:^|[\s;])(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;(=])require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s+['"]([^'"]+)['"]""", re.M)
EXTS = ("", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.js")


def git(repo, *args):
    return subprocess.run(["git", "-c", "safe.directory=*", "-C", repo] + list(args), capture_output=True, text=True, encoding="utf-8", errors="replace")


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    repo, commit, entry, nm = argv[:4]
    roots = argv[4:] or ["relay-bridge", "src", "package.json"]
    files = set(git(repo, "ls-tree", "-r", "--name-only", commit).stdout.split())
    full = git(repo, "rev-parse", commit + "^{commit}").stdout.strip()
    todo, seen, bare, bad = [entry], set(), {}, []
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        src = git(repo, "show", "%s:%s" % (commit, f)).stdout
        # strip comments (line and block) so documentation examples are not taken for imports
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
        src = re.sub(r"(^|[^:])//[^\n]*", r"\1", src)
        for m in IMPORT.finditer(src):
            spec = next(g for g in m.groups() if g)
            if spec.startswith("node:") or spec in ("fs", "path", "os", "http", "https", "crypto", "url", "module", "util", "events", "stream", "net", "child_process", "zlib", "buffer", "assert", "timers", "worker_threads", "readline", "dns", "tls"):
                continue
            if spec.startswith("."):
                base = posixpath.normpath(posixpath.join(posixpath.dirname(f), spec))
                hit = next((base + e for e in EXTS if (base + e) in files), None)
                if hit is None and base.endswith(".js"):
                    hit = next((base[:-3] + e for e in (".ts", ".tsx") if (base[:-3] + e) in files), None)
                if hit is None:
                    bad.append("unresolved relative import %r in %s" % (spec, f))
                    continue
                todo.append(hit)
            else:
                pkg = "/".join(spec.split("/")[:2]) if spec.startswith("@") else spec.split("/")[0]
                bare.setdefault(pkg, set()).add(f)
    print("repo %s commit %s (%s) entry %s" % (repo, commit, full, entry))
    print("archive paths: %s" % " ".join(roots))
    for f in sorted(seen):
        inside = any(f == r or f.startswith(r.rstrip("/") + "/") for r in roots)
        print("  %s %s" % ("in-archive " if inside else "OUTSIDE    ", f))
        if not inside:
            bad.append("%s is outside the archive paths" % f)
    for pkg in sorted(bare):
        ok = os.path.isdir(os.path.join(nm, *pkg.split("/")))
        print("  package %-28s %s (imported by %d file(s))" % (pkg, "present" if ok else "MISSING", len(bare[pkg])))
        if not ok:
            bad.append("package %s missing in %s" % (pkg, nm))
    print("files in closure: %d; bare packages: %d" % (len(seen), len(bare)))
    for b in bad:
        print("PROBLEM: " + b)
    print("RESULT: %s" % ("OK" if not bad else "NOT OK"))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
