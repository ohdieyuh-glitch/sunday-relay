"""DRY-RUN ONLY: a WRONG fix for defect D1: a plausible shortcut, `if the store refuses to settle the phase again, treat the call as a redelivery and absorb it`. It never advances a gauntlet whose process died between settling the phase and saving the state. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')
old = "  await deps.store.settleRound({\n"
assert text.count(old) == 1
text = text.replace(old, "  const firstSettlement = await deps.store.settleRound({\n")
old2 = "    findingIds: input.review?.findingIds ?? [], completedAt: deps.clock.now(),\n  });\n"
assert text.count(old2) == 1
text = text.replace(old2, old2 + (
    "  if (!firstSettlement) {\n"
    "    const nextWorkId = current.state === 'REPAIRING' ? await schedule(current, 'REPAIR', deps) : null;\n"
    "    return { advanced: true, state: current.state, activation: current.activation, round: current.round, nextWorkId, haltReason: current.haltReason };\n"
    "  }\n"))
path.write_text(text, encoding='utf-8', newline='')
print('wrong fix D1 (absorb on any repeated settle) applied')
