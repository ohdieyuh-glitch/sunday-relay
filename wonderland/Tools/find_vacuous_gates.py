"""Find record() clauses that pass hardest when their data could not be built.

Three axes, because each alone has a blind spot:
  1. HOW the collection was built   -- filtered/appended can be empty; a comprehension over an ALL-CAPS
                                       module constant cannot.               (the other lane's addition)
  2. Does the CONDITION prove non-emptiness inline -- bool(x), len(x) > 0, len(a) == len(b), == len(.
  3. Does an EARLIER clause VOID the run on empty -- an early return before this line.
A clause is exposed only if the collection can be empty AND neither guard is present.

RUN IT FROM editor_jobs:  python ../find_vacuous_gates.py

KNOWN WEAKNESS, because a detector that overstates its own reach is the thing it exists to catch.
Axis 3 accepts ANY early return whose test mentions emptiness or None before the clause's line. That
includes "if start is None" and "if terr is None", which guard against a missing SUBJECT and not against
an empty RESULT -- a walk can begin from a valid start and still append nothing. So axis 3 produces FALSE
NEGATIVES, which for this purpose is worse than the false positives axis 1 removes. A clause this script
clears on axis 3 alone has been argued safe, not shown safe.

Axis 1 is the other lane's; axes 2 and 3 are this one's. Between them the tree went 90 flagged -> 18.
"""
import ast, re, sys, pathlib

def flat(node, text):
    try: return " ".join((ast.get_source_segment(text, node) or "").split())
    except Exception: return ""

INLINE = [r'\bbool\s*\(\s*\w+\s*\)', r'\blen\s*\([^()]*\)\s*>=?\s*\d',
          r'\blen\s*\([^()]*\)\s*==\s*len\s*\(', r'==\s*len\s*\(',
          r'\blen\s*\([^()]*\)\s*==\s*[1-9]', r'\bwanted\b']

def origin_map(tree, text):
    """name -> 'constant' | 'filtered' | 'appended' | 'unknown'"""
    how = {}
    for n in ast.walk(tree):
        if not isinstance(n, ast.Assign) or not n.targets: continue
        tgt = n.targets[0]
        if not isinstance(tgt, ast.Name): continue
        v = n.value
        if isinstance(v, (ast.List, ast.Dict, ast.Set)) and not getattr(v, "elts", None) \
                and not getattr(v, "keys", None):
            how[tgt.id] = "appended"; continue
        if isinstance(v, (ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp)):
            gen = v.generators[0]
            over = flat(gen.iter, text)
            if gen.ifs:
                how[tgt.id] = "filtered"
            elif re.match(r'^[A-Z][A-Z0-9_]*(\.\w+\(\))?$', over) or re.match(r'^[A-Z][A-Z0-9_]*\b', over):
                how[tgt.id] = "constant"
            else:
                how.setdefault(tgt.id, "unknown")
            continue
        how.setdefault(tgt.id, "unknown")
    return how

def early_voids(tree, text):
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.If):
            body = flat(n, text); test = flat(n.test, text)
            if "return" in body and re.search(r'not \w+|len\(|== 0|is None|voided', test):
                out.append(n.lineno)
    return out

rows = []
for fp in sorted(pathlib.Path('.').glob('zc_*.py')):
    text = fp.read_text(encoding='utf-8', errors='replace')
    try: tree = ast.parse(text)
    except SyntaxError: continue
    how, voids = origin_map(tree, text), early_voids(tree, text)
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "record"): continue
        if len(n.args) < 3: continue
        cond = flat(n.args[2], text); tid = flat(n.args[0], text).strip('"\'')
        if not (re.search(r'\ball\s*\(', cond) or re.search(r'\blen\s*\(\s*\w+\s*\)\s*==\s*0', cond)):
            continue
        if any(re.search(g, cond) for g in INLINE):            # axis 2
            continue
        if any(v < n.lineno for v in voids):                   # axis 3
            continue
        names = {x.id for x in ast.walk(n.args[2]) if isinstance(x, ast.Name)}
        kinds = {how.get(nm, "unknown") for nm in names if nm in how}
        if kinds and kinds <= {"constant"}:                    # axis 1
            continue
        rows.append((fp.name, tid, ",".join(sorted(kinds)) or "unknown", cond[:72]))

print("EXPOSED after all three axes: %d" % len(rows))
for f, tid, k, c in rows:
    print("  %-24s %-10s [%s]  %s" % (f, tid, k, c))
