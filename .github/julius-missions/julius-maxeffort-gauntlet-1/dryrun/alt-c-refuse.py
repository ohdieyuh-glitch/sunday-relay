"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect C: an activation that loses the race REFUSES with a reason code (and requests nothing). Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = "  await deps.store.save(started, created.record.version);\n\n  // THE FIRST STEP IS A REVIEW"
new = ("  if (!(await deps.store.save(started, created.record.version))) {\n"
       "    return { activated: false, reasonCode: 'GAUNTLET_CHANGED', safeMessage: 'The gauntlet was started by another writer first.' };\n"
       "  }\n\n  // THE FIRST STEP IS A REVIEW")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix C (refuse) applied')
