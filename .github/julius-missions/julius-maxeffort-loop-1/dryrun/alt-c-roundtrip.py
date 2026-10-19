"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect C by a different mechanism: rebuild the literal's own wall-clock fields with Date.UTC (setUTCFullYear,
so years 0-99 are not read as 19xx) and refuse the text when they do not come back unchanged. Refuses T24:00 as a side effect. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/runtime/loop-scheduler.ts')
text = path.read_text(encoding='utf-8')
old = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const ms = Date.parse(value);
"""
new = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  // A wall-clock reading that does not survive a round trip names no instant: Date.parse would roll it forward.
  const fields = [0, 5, 8, 11, 14].map((at) => Number(value.slice(at, at === 0 ? 4 : at + 2)));
  const [year, month, day, hour, minute] = fields as [number, number, number, number, number];
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, 0, 0);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day
    || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute) return null;
  const ms = Date.parse(value);
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative C (round-trip of the wall-clock fields) applied')
