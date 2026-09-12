#!/usr/bin/env python3
"""Read ONE field out of a GitHub JSON response, or say what GitHub answered.

A separate file rather than an inline program, because inline Python inside a
shell script is how this ceremony has failed twice:

  * PR #247's read-back used an f-string whose escaped quotes did not survive
    the surrounding single-quoted shell string, and died on a SyntaxError AFTER
    the pull request had already been created.
  * The first attempt at this helper used `python3 - <<'HEREDOC'`, where `-`
    means "read the PROGRAM from stdin" — so the heredoc became the program and
    the piped JSON was never read at all. It reported every input, valid or not,
    as "did not return JSON".

Usage:  <json on stdin> | github-field.py <field> <what we were doing>

`field` may be a dotted path — `head.sha`, `user.login` — so a nested value can
be read without a second program.

Exit 0 prints the field. Exit 1 prints, to stderr, whatever GitHub actually
said — "A JWT could not be decoded", "Integration not found", "Not Found" —
which is the difference between a diagnosis and a traceback.
"""
import json
import sys

field, doing = sys.argv[1], sys.argv[2]
raw = sys.stdin.read()

try:
    payload = json.loads(raw)
except ValueError:
    sys.stderr.write('%s: GitHub did not return JSON: %s\n' % (doing, raw[:200].strip() or '(empty)'))
    raise SystemExit(1)

cursor = payload
for step in field.split('.'):
    if isinstance(cursor, dict) and step in cursor:
        cursor = cursor[step]
    else:
        cursor = None
        break
else:
    print(cursor)
    raise SystemExit(0)

message = payload.get('message', payload) if isinstance(payload, dict) else payload
sys.stderr.write('%s: GitHub said: %s\n' % (doing, message))
raise SystemExit(1)
