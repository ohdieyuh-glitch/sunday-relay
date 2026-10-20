"""DRY-RUN ONLY: the reference fix for defect C (activate honours the compare-and-set that records the first round). Reports a resume of the stored gauntlet."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = "  await deps.store.save(started, created.record.version);\n\n  // THE FIRST STEP IS A REVIEW"
new = ("  if (!(await deps.store.save(started, created.record.version))) {\n"
       "    const winner = (await deps.store.load(command.runId, command.gauntletId)) ?? created.record;\n"
       "    return {\n"
       "      activated: true, resumed: true, record: winner,\n"
       "      firstWorkId: gauntletWorkId(winner.gauntletId, Math.max(winner.round, 1), 'REVIEW'),\n"
       "    };\n"
       "  }\n\n  // THE FIRST STEP IS A REVIEW")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('fix C applied')
