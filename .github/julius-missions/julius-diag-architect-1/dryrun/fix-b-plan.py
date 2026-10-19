"""DRY-RUN ONLY (never part of a mission): the reference fix for defect B (every plan array element is checked). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/prompt-architect/prompt-architect-plan.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  for (const key of ['acceptanceCriteria', 'testPlan', 'prohibitedActions',\n    'proposedContractAmendments', 'contextRefs']) {",
     "  for (const key of ['unresolvedQuestions', 'requirements', 'implementationSteps', 'risks']) {\n    for (const element of v[key] as unknown[]) {\n      if (element === null || typeof element !== 'object' || Array.isArray(element)) {\n        return { ok: false, reason: `${key} contains a non-object`, reasonCode: 'required_array_invalid', reasonField: key };\n      }\n    }\n  }\n  for (const key of ['acceptanceCriteria', 'testPlan', 'prohibitedActions',\n    'proposedContractAmendments', 'contextRefs']) {")
path.write_text(text, encoding='utf-8', newline='')
print('fix B applied')
