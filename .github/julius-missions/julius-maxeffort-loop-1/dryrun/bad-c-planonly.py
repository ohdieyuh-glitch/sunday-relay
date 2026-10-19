"""DRY-RUN ONLY: a WRONG fix for defect C: the calendar check is added to `planLoopPass`'s own `parseAdvancedAt` instead of the shared reader, so the
plan excludes the stamp but every other caller (approvals, missed runs, windows) still reads an impossible date. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/runtime/loop-scheduler.ts')
text = path.read_text(encoding='utf-8')
old = """  if (value === null) return Number.NEGATIVE_INFINITY;
  return readIsoInstantWithOffset(value) ?? Number.NaN;
"""
new = """  if (value === null) return Number.NEGATIVE_INFINITY;
  const ms = readIsoInstantWithOffset(value);
  if (ms === null) return Number.NaN;
  // The stamp must name a real calendar day: its own date must come back from the instant at its own offset.
  const offset = value.endsWith('Z') ? 0 : (value.slice(-6, -5) === '-' ? -1 : 1) * (Number(value.slice(-5, -3)) * 60 + Number(value.slice(-2)));
  return new Date(ms + offset * 60_000).toISOString().slice(0, 10) === value.slice(0, 10) ? ms : Number.NaN;
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix C (planLoopPass only) applied')
