"""DRY-RUN ONLY (never part of a mission): the reference fix for defect B (usage bar tone). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/usage/usage-projection.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  if (parts.length === 0) {\n    const updating",
     "  const tones = [windowTone(fiveHour), windowTone(snapshot.weekly), contractsTone(missionContracts)];\n  const tone = tones.includes('critical') ? 'critical' : tones.includes('warning') ? 'warning' : 'idle';\n\n  if (parts.length === 0) {\n    const updating")
swap("      tone: 'idle',\n      provenance: snapshot.provenance,\n    };\n  }\n\n  const tones = [windowTone(fiveHour), windowTone(snapshot.weekly), contractsTone(missionContracts)];\n  const tone = tones.includes('critical') ? 'critical' : tones.includes('warning') ? 'warning' : 'idle';\n  return",
     "      tone,\n      provenance: snapshot.provenance,\n    };\n  }\n\n  return")
path.write_text(text, encoding='utf-8', newline='')
print('fix B applied')
