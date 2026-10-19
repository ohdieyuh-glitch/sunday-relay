"""DRY-RUN ONLY: the reference fix for defect B (cancel honours its compare-and-set). Reloads and reports the stored truth, like its siblings."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = "  const next: GauntletCommandRecord = { ...cancelled, activation: 'CANCELLED' };\n  await deps.store.save(next, current.version);\n"
new = ("  const next: GauntletCommandRecord = { ...cancelled, activation: 'CANCELLED' };\n"
       "  if (!(await deps.store.save(next, current.version))) {\n"
       "    const reloaded = await deps.store.load(input.runId, input.gauntletId);\n"
       "    return {\n"
       "      advanced: true, state: reloaded?.state ?? current.state,\n"
       "      activation: reloaded?.activation ?? current.activation,\n"
       "      round: reloaded?.round ?? current.round, nextWorkId: null, haltReason: reloaded?.haltReason ?? null,\n"
       "    };\n"
       "  }\n")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('fix B applied')
