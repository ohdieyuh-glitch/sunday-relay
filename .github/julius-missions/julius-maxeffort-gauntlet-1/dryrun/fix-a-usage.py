"""DRY-RUN ONLY (never part of a mission): the reference fix for defect A (exact accounting). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
start = text.index("  // The ceilings see the ROUND'S total")
end = text.index("\n  let next: GauntletCommandRecord;", start)
text = text[:start] + text[end + 1:]
old = "      durationMs: roundDurationMs, usdMicros: roundUsdMicros,\n"
assert text.count(old) == 1
text = text.replace(old, "      durationMs: input.usage.durationMs, usdMicros: input.usage.usdMicros,\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix A applied')
