"""DRY-RUN ONLY: the reference fix for defect D (a crash loses nothing), ONE entry point: redelivered settlement. Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  const outcome = input.phase === 'REVIEW'\n",
     "  const waitingForThisPhase = input.phase === 'REVIEW'\n"
     "    ? current.state === 'RUNNING' || current.state === 'VERIFYING'\n"
     "    : current.state === 'REPAIRING';\n"
     "  if (!waitingForThisPhase) {\n"
     "    // A REDELIVERED settlement (a retry after a crash): the usage was counted when the state moved. Absorb it, and make sure the successor was requested.\n"
     "    const nextWorkId = input.phase === 'REVIEW' && current.state === 'REPAIRING' ? await schedule(current, 'REPAIR', deps) : null;\n"
     "    return {\n"
     "      advanced: true, state: current.state, activation: current.activation,\n"
     "      round: current.round, nextWorkId, haltReason: current.haltReason,\n"
     "    };\n"
     "  }\n\n"
     "  const outcome = input.phase === 'REVIEW'\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix-d1-advance.py applied')
