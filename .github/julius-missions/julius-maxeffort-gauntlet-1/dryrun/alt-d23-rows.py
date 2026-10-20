"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect D at the next-round and resume entry points: request the review only when its round row is MISSING (the redelivery-safe variant that does not rely on idempotent re-requesting). Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  if (current.activation !== 'ACTIVE' || current.state !== 'READY') {\n",
     "  if (current.activation === 'ACTIVE' && current.state === 'RUNNING') {\n"
     "    const rows = await deps.store.roundsFor(current.gauntletId);\n"
     "    const have = rows.some((row) => row.round === current.round && row.phase === 'REVIEW');\n"
     "    return {\n"
     "      advanced: true, state: current.state, activation: current.activation, round: current.round,\n"
     "      nextWorkId: have ? gauntletWorkId(current.gauntletId, current.round, 'REVIEW') : await schedule(current, 'REVIEW', deps),\n"
     "      haltReason: current.haltReason,\n"
     "    };\n"
     "  }\n"
     "  if (current.activation !== 'ACTIVE' || current.state !== 'READY') {\n")
swap("    // the second one RESUMES rather than forking.\n    return {",
     "    // the second one RESUMES rather than forking.\n"
     "    if (existing.activation === 'ACTIVE' && existing.state === 'RUNNING') {\n"
     "      const rows = await deps.store.roundsFor(existing.gauntletId);\n"
     "      if (!rows.some((row) => row.round === existing.round && row.phase === 'REVIEW')) await schedule(existing, 'REVIEW', deps);\n"
     "    }\n"
     "    return {")
path.write_text(text, encoding='utf-8', newline='')
print('alternative fix D (row-check) applied')
