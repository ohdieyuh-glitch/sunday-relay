"""DRY-RUN ONLY: a WRONG fix for defect C: it compares the literal's date with the date of the PARSED instant in UTC. That refuses every impossible
date, and also every real instant whose offset moves it across midnight (2026-03-01T02:00+05:30 is 2026-02-28 in UTC). Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/runtime/loop-scheduler.ts')
text = path.read_text(encoding='utf-8')
old = """  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
"""
new = """  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  // The parsed instant must name the date the text names.
  return new Date(ms).toISOString().slice(0, 10) === value.slice(0, 10) ? ms : null;
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix C (UTC date comparison) applied')
