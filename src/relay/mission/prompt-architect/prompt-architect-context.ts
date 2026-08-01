/**
 * THE DETERMINISTIC CONTEXT BUILDER.
 *
 * One place decides what the Prompt Architect is allowed to see. It is
 * deliberately boring and predictable: relevant blocks only, deduplicated,
 * size-bounded, secret-redacted, and — when the required material does not
 * fit — it BLOCKS rather than silently dropping the beginning of the Mission
 * Contract.
 */

export interface ContextBlock {
  /** Stable id, recorded on the run so Relay knows what was sent. */
  readonly id: string;
  readonly kind: 'mission_contract' | 'user_request' | 'project_brain' | 'architecture' | 'decision' | 'constraint' | 'repository_summary';
  readonly text: string;
  /** Required blocks are never dropped; the build fails instead. */
  readonly required: boolean;
}

export interface ContextBuildOptions {
  /** Hard ceiling on total characters across included blocks. */
  readonly maxChars: number;
}

export type ContextBuildResult =
  | {
    readonly ok: true;
    readonly blocks: readonly ContextBlock[];
    readonly refs: readonly string[];
    readonly totalChars: number;
    readonly droppedOptional: readonly string[];
  }
  | { readonly ok: false; readonly reason: string };

/** Secret-shaped keys and values are removed before anything leaves Relay. */
export const CONTEXT_SECRET_KEY_RE =
  /password|passwd|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|secret|authorization|cookie|bearer|credential|token|env(ironment)?[-_]?values?/i;
export const CONTEXT_SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9]{8,})|(AKIA[0-9A-Z]{12,})|(-----BEGIN [A-Z ]*PRIVATE KEY)|(gh[pousr]_[A-Za-z0-9]{20,})|(xox[baprs]-[A-Za-z0-9-]{10,})|(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;

/** Redact secret-shaped material from a context block's text. */
export function redactContextText(text: string): string {
  const lines = text.split('\n').map((line) => {
    // Drop whole `KEY=value` / `key: value` lines whose key looks secret.
    const assignment = /^\s*([A-Za-z0-9_.-]+)\s*[:=]\s*(.+)$/.exec(line);
    if (assignment !== null && CONTEXT_SECRET_KEY_RE.test(assignment[1])) {
      return `${assignment[1]}=[REDACTED]`;
    }
    return line.replace(CONTEXT_SECRET_VALUE_RE, '[REDACTED]');
  });
  return lines.join('\n');
}

/**
 * Build the bounded context. Required blocks are included first and never
 * truncated; optional blocks fill the remaining budget in order and are
 * reported when dropped.
 */
export function buildArchitectContext(
  blocks: readonly ContextBlock[],
  options: ContextBuildOptions,
): ContextBuildResult {
  const seen = new Set<string>();
  const deduped: ContextBlock[] = [];
  for (const block of blocks) {
    const safe = { ...block, text: redactContextText(block.text) };
    // Deduplicate by id AND by exact content, so the same paragraph pasted
    // under two ids cannot be billed twice.
    const contentKey = `${safe.kind}::${safe.text}`;
    if (seen.has(safe.id) || seen.has(contentKey)) continue;
    seen.add(safe.id);
    seen.add(contentKey);
    deduped.push(safe);
  }

  const required = deduped.filter((b) => b.required);
  const optional = deduped.filter((b) => !b.required);
  const requiredChars = required.reduce((sum, b) => sum + b.text.length, 0);

  if (requiredChars > options.maxChars) {
    // NEVER silently truncate the Mission Contract. Block truthfully.
    return {
      ok: false,
      reason: 'Prompt Architect blocked — relevant context exceeds the configured limit.',
    };
  }

  const included = [...required];
  const droppedOptional: string[] = [];
  let total = requiredChars;
  for (const block of optional) {
    if (total + block.text.length <= options.maxChars) {
      included.push(block);
      total += block.text.length;
    } else {
      droppedOptional.push(block.id);
    }
  }

  return {
    ok: true,
    blocks: included,
    refs: included.map((b) => b.id),
    totalChars: total,
    droppedOptional,
  };
}

/** Render the bounded blocks into the user-level input text. */
export function renderContextInput(blocks: readonly ContextBlock[]): string {
  return blocks
    .filter((b) => b.kind !== 'mission_contract')
    .map((b) => `## ${b.kind} (${b.id})\n${b.text}`)
    .join('\n\n');
}

/** The Mission Contract stays the developer/system-level authority. */
export function renderContractInstruction(blocks: readonly ContextBlock[]): string {
  return blocks
    .filter((b) => b.kind === 'mission_contract')
    .map((b) => b.text)
    .join('\n\n');
}
