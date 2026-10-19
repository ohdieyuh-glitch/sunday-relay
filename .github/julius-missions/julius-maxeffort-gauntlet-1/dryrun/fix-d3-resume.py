"""DRY-RUN ONLY: the reference fix for defect D (a crash loses nothing), ONE entry point: resume whose first review was never requested. Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("    // the second one RESUMES rather than forking.\n    return {",
     "    // the second one RESUMES rather than forking.\n"
     "    if (existing.activation === 'ACTIVE' && existing.state === 'RUNNING') await schedule(existing, 'REVIEW', deps);\n"
     "    return {")
path.write_text(text, encoding='utf-8', newline='')
print('fix-d3-resume.py applied')
