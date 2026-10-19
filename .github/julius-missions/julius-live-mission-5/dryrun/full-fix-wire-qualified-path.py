"""DRY-RUN ONLY (Mission 5, restored 09-10 start state). The MINIMAL full fix:
the integrity layer is wired into compileJuliusContext ONLY for callers that
supply claims; the no-claims path stays byte-identical to 09-10 (REQ 13 BACKWARD COMPATIBILITY), so
its `break` and its inline redaction are untouched. The qualified path and its
types are taken from #288 (c833e268). Never landed: it proves satisfiability.
Every anchor is asserted, so a drifted base kills it."""
import sys
runtime_path, donor_path = sys.argv[1], sys.argv[2]
s = open(runtime_path, encoding='utf-8').read()
d = open(donor_path, encoding='utf-8').read()

# 1. imports, from the donor, before the 09-10 import line
imp_anchor = "import { effectivelyAcceptedTaskIds } from './julius-repair-lineage';\n"
assert s.count(imp_anchor) == 1, 'import anchor'
imports = d[d.index("import {\n  compileContextWithIntegrity"):d.index(imp_anchor)]
s = s.replace(imp_anchor, imports + imp_anchor, 1)

# 2. the packet gains an optional `integrity` field (absent for no-claims callers)
old_packet = "readonly truncated: boolean; }\nexport function compileJuliusContext("
assert s.count(old_packet) == 1, 'packet anchor'
s = s.replace(old_packet, "readonly truncated: boolean; readonly integrity?: JuliusContextSelection; }\nexport function compileJuliusContext(", 1)

# 3. the refusal type and the qualification type, from the donor, before compileJuliusContext
refusal = d[d.index("/**\n * A PACKET THAT CANNOT BE COMPILED HONESTLY"):d.index("export function compileJuliusContext(input: {\n")]
assert 'class JuliusContextIntegrityRefusal' in refusal and 'interface JuliusContextQualification' in refusal
fn_anchor = "export function compileJuliusContext(input: { missionId: string; task: JuliusTask; worker: JuliusWorker; entries: readonly JuliusBrainEntry[]; maxCharacters: number }): JuliusContextPacket {\n  if (input.maxCharacters < 1) throw new Error('invalid_context_budget');\n"
assert s.count(fn_anchor) == 1, 'compile anchor'
new_fn = ("export function compileJuliusContext(input: { missionId: string; task: JuliusTask; worker: JuliusWorker; entries: readonly JuliusBrainEntry[]; maxCharacters: number; qualification?: JuliusContextQualification }): JuliusContextPacket {\n"
          "  if (input.maxCharacters < 1) throw new Error('invalid_context_budget');\n"
          "  if (input.qualification !== undefined) return compileQualified(input, input.qualification, { missionId: input.missionId, taskId: input.task.taskId, workerId: input.worker.workerId });\n")
s = s.replace(fn_anchor, refusal + new_fn, 1)

# 4. the qualified path itself, from the donor, right after compileJuliusContext
end_marker = "truncated: sourceEntryIds.length < relevant.length };\n}\n"
assert s.count(end_marker) == 1, 'compile end anchor'
q = d[d.index("/**\n * THE AUTHORITY-RANKED PATH."):]
q = q[:q.index("    integrity: outcome.selection,\n  };\n}\n") + len("    integrity: outcome.selection,\n  };\n}\n")]
assert q.count('function compileQualified(') == 1
s = s.replace(end_marker, end_marker + "\n" + q, 1)
open(runtime_path, 'w', encoding='utf-8', newline='\n').write(s)
print('   runtime: qualified path wired; the no-claims path is byte-identical to 09-10')
