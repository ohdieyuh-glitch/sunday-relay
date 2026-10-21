"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect A: total every settled phase of the WHOLE gauntlet and hand the machine the DIFFERENCE from what it already holds. Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = ("  const settled = (await deps.store.roundsFor(current.gauntletId))\n"
       "    .filter((record) => record.round === current.round && record.completedAt !== null);\n"
       "  const roundDurationMs = settled.reduce((total, record) => total + (record.durationMs ?? 0), 0);\n"
       "  const roundUsdMicros = settled.reduce((total, record) => total + (record.usdMicros ?? 0), 0);\n")
new = ("  const settled = (await deps.store.roundsFor(current.gauntletId)).filter((record) => record.completedAt !== null);\n"
       "  const roundDurationMs = settled.reduce((total, record) => total + (record.durationMs ?? 0), 0) - current.usedDurationMs;\n"
       "  const roundUsdMicros = settled.reduce((total, record) => total + (record.usdMicros ?? 0), 0) - current.usedUsdMicros;\n")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix A (whole-gauntlet delta) applied')
