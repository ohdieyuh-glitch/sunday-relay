"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect B: a cancel that loses the race REFUSES with a reason code (and cancels nothing). Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = "  const next: GauntletCommandRecord = { ...cancelled, activation: 'CANCELLED' };\n  await deps.store.save(next, current.version);\n"
new = ("  const next: GauntletCommandRecord = { ...cancelled, activation: 'CANCELLED' };\n"
       "  if (!(await deps.store.save(next, current.version))) {\n"
       "    return { advanced: false, reasonCode: 'GAUNTLET_CHANGED', safeMessage: 'The gauntlet changed while it was being cancelled; nothing was cancelled.' };\n"
       "  }\n")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix B (refuse) applied')
