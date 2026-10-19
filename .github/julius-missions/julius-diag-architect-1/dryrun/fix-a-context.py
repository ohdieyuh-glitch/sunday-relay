"""DRY-RUN ONLY (never part of a mission): the reference fix for defect A (required blocks survive de-duplication). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/prompt-architect/prompt-architect-context.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  for (const block of blocks) {\n    const safe = { ...block, text: redactContextText(block.text) };",
     "  // Required blocks are considered first, so an optional duplicate can never evict one.\n  for (const block of [...blocks.filter((b) => b.required), ...blocks.filter((b) => !b.required)]) {\n    const safe = { ...block, text: redactContextText(block.text) };")
path.write_text(text, encoding='utf-8', newline='')
print('fix A applied')
