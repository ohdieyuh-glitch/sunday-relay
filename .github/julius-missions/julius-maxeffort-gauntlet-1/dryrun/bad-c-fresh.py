"""DRY-RUN ONLY: a WRONG fix for defect C: it skips the work request after a lost race but still REPORTS a freshly started round 1. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = "  await deps.store.save(started, created.record.version);\n\n  // THE FIRST STEP IS A REVIEW"
new = ("  if (!(await deps.store.save(started, created.record.version))) {\n"
       "    return { activated: true, resumed: false, record: started, firstWorkId: gauntletWorkId(started.gauntletId, started.round, 'REVIEW') };\n"
       "  }\n\n  // THE FIRST STEP IS A REVIEW")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix C (still claims a fresh round) applied')
