"""DRY-RUN ONLY (never part of a mission): the reference fix for defect A (exact accounting). Counts the usage of the settlement AS STORED, so a redelivered report cannot change the totals. Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
start = text.index("  // The ceilings see the ROUND'S total")
end = text.index("\n  let next: GauntletCommandRecord;", start)
new_block = (
    "  // Each settlement is counted exactly once, as it was first stored: a redelivered report with other numbers changes nothing.\n"
    "  const stored = (await deps.store.roundsFor(current.gauntletId))\n"
    "    .find((record) => record.round === current.round && record.phase === input.phase && record.completedAt !== null);\n"
    "  const counted = stored === undefined\n"
    "    ? input.usage\n"
    "    : { durationMs: stored.durationMs ?? 0, usdMicros: stored.usdMicros ?? 0 };\n"
)
text = text[:start] + new_block + text[end:]
old = "      durationMs: roundDurationMs, usdMicros: roundUsdMicros,\n"
assert text.count(old) == 1
text = text.replace(old, "      durationMs: counted.durationMs, usdMicros: counted.usdMicros,\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix A applied')
