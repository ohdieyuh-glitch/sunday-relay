import type {
  CommandStatus,
  EvidenceEntry,
  FindingSeverity,
  ImplementationReport,
  IsoTimestamp,
  RelayResult,
  RepairReport,
  ReviewFinding,
  ReviewReport,
  ReviewVerdict,
  TestEvidence,
} from './types';

/**
 * Artifact ingestion — parses what a real agent session pasted back.
 * Extraction order for the expected `relay:<label>` block:
 *   1. the fenced block labeled ```json relay:<label>
 *   2. a single unlabeled ```json block (agent forgot the label)
 *   3. the whole text as raw JSON
 * Validation is strict and error messages are written for the demo operator:
 * they say exactly which field is wrong so the fix is a quick re-paste.
 */

export function extractLabeledJson(text: string, label: string): RelayResult<unknown> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, errors: ['Nothing pasted.'] };

  const labeled = new RegExp('```json\\s+relay:' + label + '\\s*\\n([\\s\\S]*?)```').exec(trimmed);
  if (labeled) return parseJson(labeled[1], `relay:${label} block`);

  const anyJsonBlocks = [...trimmed.matchAll(/```json[^\n]*\n([\s\S]*?)```/g)];
  if (anyJsonBlocks.length === 1) return parseJson(anyJsonBlocks[0][1], 'json block');
  if (anyJsonBlocks.length > 1) {
    return {
      ok: false,
      errors: [
        `Found ${anyJsonBlocks.length} json blocks but none labeled \`relay:${label}\`. ` +
          'Paste the agent reply containing the labeled block.',
      ],
    };
  }

  if (trimmed.startsWith('{')) return parseJson(trimmed, 'pasted JSON');

  return {
    ok: false,
    errors: [
      `No \`relay:${label}\` block found. Expected a fenced block: \`\`\`json relay:${label} … \`\`\``,
    ],
  };
}

function parseJson(raw: string, what: string): RelayResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return {
      ok: false,
      errors: [`Could not parse ${what} as JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Field validators — hand-rolled, no schema dependency.               */
/* ------------------------------------------------------------------ */

class FieldErrors {
  readonly errors: string[] = [];
  add(path: string, message: string) {
    this.errors.push(`\`${path}\` ${message}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The briefs' example blocks use `<angle-bracket>` placeholders; an unfilled
 * placeholder pasted back means the agent (or operator) skipped the real
 * value — reject it instead of recording template text as fact. */
function looksLikePlaceholder(s: string): boolean {
  return s.startsWith('<') && s.endsWith('>');
}

function readString(
  e: FieldErrors,
  obj: Record<string, unknown>,
  key: string,
  opts: { required: boolean },
): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) e.add(key, 'is required and must be a non-empty string.');
    return undefined;
  }
  if (typeof v !== 'string') {
    e.add(key, 'must be a string.');
    return undefined;
  }
  const trimmed = v.trim();
  if (looksLikePlaceholder(trimmed)) {
    e.add(key, `looks like an unfilled template placeholder (${trimmed}) — replace it with the real value.`);
    return undefined;
  }
  return trimmed;
}

function readStringArray(
  e: FieldErrors,
  obj: Record<string, unknown>,
  key: string,
  opts: { required: boolean },
): string[] {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (opts.required) e.add(key, 'is required (an array of strings; may be empty).');
    return [];
  }
  if (!Array.isArray(v)) {
    e.add(key, 'must be an array of strings.');
    return [];
  }
  const out: string[] = [];
  v.forEach((item, i) => {
    if (typeof item !== 'string' || item.trim() === '') {
      e.add(`${key}[${i}]`, 'must be a non-empty string.');
    } else if (looksLikePlaceholder(item.trim())) {
      e.add(`${key}[${i}]`, 'looks like an unfilled template placeholder — replace it with the real value.');
    } else {
      out.push(item.trim());
    }
  });
  return out;
}

const COMMAND_STATUSES: CommandStatus[] = ['pass', 'fail'];

function readEvidenceEntries(
  e: FieldErrors,
  obj: Record<string, unknown>,
  key: string,
  opts: { required: boolean },
): EvidenceEntry[] {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (opts.required) e.add(key, 'is required (an array of command runs).');
    return [];
  }
  if (!Array.isArray(v)) {
    e.add(key, 'must be an array of { command, status, output } entries.');
    return [];
  }
  const out: EvidenceEntry[] = [];
  v.forEach((item, i) => {
    if (!isRecord(item)) {
      e.add(`${key}[${i}]`, 'must be an object { command, status, output }.');
      return;
    }
    const entry = new FieldErrors();
    const command = readString(entry, item, 'command', { required: true });
    const status = readString(entry, item, 'status', { required: true });
    const output = typeof item.output === 'string' ? item.output : undefined;
    if (status !== undefined && !COMMAND_STATUSES.includes(status as CommandStatus)) {
      entry.add('status', `must be one of: ${COMMAND_STATUSES.join(', ')}.`);
    }
    if (output === undefined) entry.add('output', 'is required (a real output excerpt).');
    else if (looksLikePlaceholder(output.trim())) {
      entry.add('output', 'looks like an unfilled template placeholder — paste the real output excerpt.');
    }
    if (entry.errors.length > 0) {
      entry.errors.forEach((msg) => e.add(`${key}[${i}]`, `→ ${msg}`));
      return;
    }
    out.push({ command: command!, status: status as CommandStatus, output: output! });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Artifact parsers                                                    */
/* ------------------------------------------------------------------ */

export function parseImplementationReport(
  text: string,
  at: IsoTimestamp,
): RelayResult<ImplementationReport> {
  const extracted = extractLabeledJson(text, 'implementation-report');
  if (!extracted.ok) return extracted;
  if (!isRecord(extracted.value)) return { ok: false, errors: ['Report must be a JSON object.'] };
  const obj = extracted.value;
  const e = new FieldErrors();
  const agent = readString(e, obj, 'agent', { required: true });
  const summary = readString(e, obj, 'summary', { required: true });
  const changedFiles = readStringArray(e, obj, 'changedFiles', { required: true });
  const commands = obj.commands === undefined ? undefined : readEvidenceEntries(e, obj, 'commands', { required: false });
  const notes = readString(e, obj, 'notes', { required: false });
  if (e.errors.length > 0) return { ok: false, errors: e.errors };
  return {
    ok: true,
    value: { receivedAt: at, agent: agent!, summary: summary!, changedFiles, commands, notes },
  };
}

const SEVERITIES: FindingSeverity[] = ['critical', 'major', 'minor'];
const VERDICTS: ReviewVerdict[] = ['approved', 'changes-requested'];

export function parseReview(text: string, at: IsoTimestamp): RelayResult<ReviewReport> {
  const extracted = extractLabeledJson(text, 'review');
  if (!extracted.ok) return extracted;
  if (!isRecord(extracted.value)) return { ok: false, errors: ['Review must be a JSON object.'] };
  const obj = extracted.value;
  const e = new FieldErrors();
  const reviewer = readString(e, obj, 'reviewer', { required: true });
  const verdict = readString(e, obj, 'verdict', { required: true });
  if (verdict !== undefined && !VERDICTS.includes(verdict as ReviewVerdict)) {
    e.add('verdict', `must be one of: ${VERDICTS.join(', ')}.`);
  }
  const findings: ReviewFinding[] = [];
  const rawFindings = obj.findings;
  if (rawFindings === undefined || rawFindings === null) {
    e.add('findings', 'is required (an array; empty means no defects found).');
  } else if (!Array.isArray(rawFindings)) {
    e.add('findings', 'must be an array.');
  } else {
    const seen = new Set<string>();
    rawFindings.forEach((item, i) => {
      if (!isRecord(item)) {
        e.add(`findings[${i}]`, 'must be an object { id, severity, title, detail }.');
        return;
      }
      const f = new FieldErrors();
      const id = readString(f, item, 'id', { required: true });
      const severity = readString(f, item, 'severity', { required: true });
      const title = readString(f, item, 'title', { required: true });
      const detail = readString(f, item, 'detail', { required: true });
      const recommendation = readString(f, item, 'recommendation', { required: false });
      if (severity !== undefined && !SEVERITIES.includes(severity as FindingSeverity)) {
        f.add('severity', `must be one of: ${SEVERITIES.join(', ')}.`);
      }
      if (id !== undefined) {
        if (seen.has(id)) f.add('id', `"${id}" is duplicated — finding ids must be unique.`);
        seen.add(id);
      }
      if (f.errors.length > 0) {
        f.errors.forEach((msg) => e.add(`findings[${i}]`, `→ ${msg}`));
        return;
      }
      findings.push({
        id: id!,
        severity: severity as FindingSeverity,
        title: title!,
        detail: detail!,
        recommendation,
      });
    });
  }
  if (e.errors.length > 0) return { ok: false, errors: e.errors };
  return {
    ok: true,
    value: { receivedAt: at, reviewer: reviewer!, verdict: verdict as ReviewVerdict, findings },
  };
}

export function parseRepairReport(text: string, at: IsoTimestamp): RelayResult<RepairReport> {
  const extracted = extractLabeledJson(text, 'repair-report');
  if (!extracted.ok) return extracted;
  if (!isRecord(extracted.value)) return { ok: false, errors: ['Repair report must be a JSON object.'] };
  const obj = extracted.value;
  const e = new FieldErrors();
  const agent = readString(e, obj, 'agent', { required: true });
  const summary = readString(e, obj, 'summary', { required: true });
  const changedFiles = readStringArray(e, obj, 'changedFiles', { required: true });
  const resolvedFindings: RepairReport['resolvedFindings'] = [];
  const raw = obj.resolvedFindings;
  if (raw === undefined || raw === null) {
    e.add('resolvedFindings', 'is required (an array of { id, resolution }).');
  } else if (!Array.isArray(raw)) {
    e.add('resolvedFindings', 'must be an array of { id, resolution }.');
  } else {
    raw.forEach((item, i) => {
      if (!isRecord(item)) {
        e.add(`resolvedFindings[${i}]`, 'must be an object { id, resolution }.');
        return;
      }
      const f = new FieldErrors();
      const id = readString(f, item, 'id', { required: true });
      const resolution = readString(f, item, 'resolution', { required: true });
      if (f.errors.length > 0) {
        f.errors.forEach((msg) => e.add(`resolvedFindings[${i}]`, `→ ${msg}`));
        return;
      }
      resolvedFindings.push({ id: id!, resolution: resolution! });
    });
  }
  if (e.errors.length > 0) return { ok: false, errors: e.errors };
  return {
    ok: true,
    value: { receivedAt: at, agent: agent!, summary: summary!, resolvedFindings, changedFiles },
  };
}

export function parseTestEvidence(text: string, at: IsoTimestamp): RelayResult<TestEvidence> {
  const extracted = extractLabeledJson(text, 'test-evidence');
  if (!extracted.ok) return extracted;
  if (!isRecord(extracted.value)) return { ok: false, errors: ['Test evidence must be a JSON object.'] };
  const obj = extracted.value;
  const e = new FieldErrors();
  const entries = readEvidenceEntries(e, obj, 'entries', { required: true });
  if (entries.length === 0 && e.errors.length === 0) {
    e.add('entries', 'must contain at least one command run.');
  }
  const note = readString(e, obj, 'note', { required: false });
  if (e.errors.length > 0) return { ok: false, errors: e.errors };
  return { ok: true, value: { receivedAt: at, entries, note } };
}
