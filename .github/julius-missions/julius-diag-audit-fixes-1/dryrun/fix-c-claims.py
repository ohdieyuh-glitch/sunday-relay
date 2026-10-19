"""DRY-RUN ONLY (never part of a mission): the reference fix for defect C (resource claim mode). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/coordination/claims.ts')
text = path.read_text(encoding='utf-8')
old = (
    "    (c) => c.taskId === input.taskId && c.resource === input.resource && c.status === 'active' && c.expiresAt > input.now,\n"
    "  );\n"
    "  if (own) return ok({ claim: own, idempotent: true });\n"
)
assert text.count(old) == 1, 'anchor not found exactly once'
new = (
    "    // Only a claim that already satisfies the request (same mode, or exclusive) is handed back, wherever it sits in the list; a shared claim asked to become\n"
    "    // exclusive falls through to the conflict check and, if it is clear, gets a NEW exclusive claim.\n"
    "    (c) => c.taskId === input.taskId && c.resource === input.resource && c.status === 'active' && c.expiresAt > input.now &&\n"
    "      (c.mode === input.mode || c.mode === 'exclusive'),\n"
    "  );\n"
    "  if (own) return ok({ claim: own, idempotent: true });\n"
)
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('fix C applied')
