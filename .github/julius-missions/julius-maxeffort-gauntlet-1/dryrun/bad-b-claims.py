"""DRY-RUN ONLY: a WRONG fix for defect B: it notices the lost race and skips cancelling the work, but still REPORTS CANCELLED. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = "  const next: GauntletCommandRecord = { ...cancelled, activation: 'CANCELLED' };\n  await deps.store.save(next, current.version);\n"
new = ("  const next: GauntletCommandRecord = { ...cancelled, activation: 'CANCELLED' };\n"
       "  if (!(await deps.store.save(next, current.version))) {\n"
       "    return { advanced: true, state: next.state, activation: 'CANCELLED', round: next.round, nextWorkId: null, haltReason: next.haltReason };\n"
       "  }\n")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix B (still claims CANCELLED) applied')
