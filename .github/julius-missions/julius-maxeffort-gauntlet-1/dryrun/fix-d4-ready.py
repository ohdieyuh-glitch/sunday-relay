"""DRY-RUN ONLY: the reference fix for defect D at the create-then-save gap: a gauntlet that was CREATED but never started (READY, round 0, active) is started by the next activation."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  if (existing !== null) {\n",
     "  const neverStarted = existing !== null && existing.activation === 'ACTIVE' && existing.state === 'READY' && existing.round === 0;\n"
     "  if (existing !== null && !neverStarted) {\n")
swap("  const created = await deps.store.create(initial);\n",
     "  // A gauntlet created by an activation that died before recording its first round is started here, not merely reported.\n"
     "  const created = existing !== null ? { created: true, record: existing } : await deps.store.create(initial);\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix D4 applied')
