import type { CliCaps } from './contracts';
import { paint } from './theme';
import { divider } from './layout';
import { safeText } from './safety';
import {
  clearPspImportFlow,
  confirmPspAgentImport,
  containsPspAgentId,
  initialPspImportState,
  maskPspAgentId,
  redactPspAgentIds,
  submitPspAgentId,
  type PSPAgentImportPreview,
  type PSPEntitlementServicePort,
  type PSPImportFlowState,
  type PSPImportPhase,
  type PSPWorkspaceContext,
} from '../../psp';

/**
 * Relay CLI — `relay agent import` (PSP Agent ID).
 *
 * FUNCTIONAL PARITY with the website's Import PSP Agent flow: the same shared
 * domain decides everything. This module owns only the terminal presentation
 * and the secure-entry sequencing; it re-implements no validation, no
 * entitlement rule and no error meaning.
 *
 * CREDENTIAL HANDLING RULES ENFORCED HERE:
 *   - the credential is NEVER accepted as a command-line argument, because
 *     arguments land in shell history and in the process table;
 *   - interactive entry is read with terminal echo DISABLED (the IO port owns
 *     that; this module never writes the value back);
 *   - the raw credential is never printed — not in the preview, not in an
 *     error, not in the completion line, not in a debug path;
 *   - every line leaving this module passes through a final redaction pass, so
 *     even an unexpected string cannot carry a credential to the terminal;
 *   - the credential is cleared from local state as soon as the flow ends,
 *     whether it succeeded or failed.
 */

/* --------------------------------- IO ---------------------------------- */

export interface PspImportIo {
  out(line: string): void;
  /**
   * Read the PSP Agent ID WITHOUT echoing it. Returns null when this terminal
   * cannot suppress echo — in that case the flow refuses rather than asking
   * the user to type a credential onto a visible screen.
   */
  readSecret(prompt: string): Promise<string | null>;
  /** Explicit confirmation. Anything other than an explicit yes is a no. */
  confirm(prompt: string): Promise<boolean>;
}

/** How a non-interactive run supplies the credential. A positional argument is
 *  deliberately NOT one of these options. */
export type PspCredentialSource =
  | { kind: 'interactive' }
  /** Piped on stdin: `cat secret.txt | relay agent import --stdin` */
  | { kind: 'stdin'; read: () => Promise<string> }
  /** Named environment reference: `relay agent import --credential-env NAME` */
  | { kind: 'env'; name: string; read: (name: string) => string | undefined };

export interface PspImportCommandOptions {
  caps: CliCaps;
  workspace: PSPWorkspaceContext;
  service: PSPEntitlementServicePort;
  now: () => string;
  importId: () => string;
  io: PspImportIo;
  source: PspCredentialSource;
  /** Skips the interactive confirmation prompt — still an EXPLICIT approval. */
  assumeYes?: boolean;
}

export interface PspImportCommandResult {
  phase: PSPImportPhase;
  imported: boolean;
  /** PUBLIC agent identity of a successful import — never the credential. */
  pspAgentId: string | null;
  displayName: string | null;
  lines: string[];
}

/* ------------------------------ rendering ------------------------------- */

/** The safe preview, in terminal form. Same facts the website panel shows. */
export function renderPspPreview(preview: PSPAgentImportPreview, caps: CliCaps): string[] {
  const p = paint(caps);
  const row = (label: string, value: string): string =>
    `  ${p.dim(label.padEnd(22))}${p.tone('cream', safeText(value, { maxLength: 120 }))}`;

  const lines: string[] = [
    '',
    p.boldTone('gold', 'PSP AGENT — IMPORT PREVIEW'),
    divider(caps, 60),
    row('PSP AGENT', preview.name),
    row('CREATOR', preview.creator),
    row('PSP', preview.pspId),
    row('VERSION', `${preview.version}  (${preview.pspVersionId})`),
    row('AGENT ID', preview.maskedAgentId),
    row('FINGERPRINT', preview.credentialFingerprint),
    row('ROLES', preview.agentRoles.join(' · ')),
    row('MODELS', preview.supportedModels.join(' · ')),
    row('PERMISSIONS', preview.requiredPermissions.join(' · ')),
    row('TOOLS', preview.requiredTools.join(' · ')),
    row('REVIEW POLICY', preview.reviewPolicy),
    row('BUDGET POLICY', preview.defaultBudgetPolicy),
    row('RELAY DOG', `${preview.relayDogColorway} (official Relay Dog identity)`),
    row('PROVENANCE', provenanceLabel(preview)),
    row('COMPATIBILITY', preview.compatible ? 'COMPATIBLE' : 'NOT COMPATIBLE'),
    row('ON CONFIRM', preview.redemptionEffect === 'redeem_one_time'
      ? 'This PSP Agent ID is redeemed once and bound to this workspace.'
      : 'This PSP Agent ID is bound to this workspace.'),
  ];
  for (const warning of preview.warnings) {
    lines.push(`  ${p.tone('amber', `! ${safeText(warning, { maxLength: 120 })}`)}`);
  }
  lines.push(divider(caps, 60));
  return lines;
}

function provenanceLabel(preview: PSPAgentImportPreview): string {
  const source = preview.acquisitionType.replace(/_/g, ' ').toUpperCase();
  if (preview.marketplaceTransactionId) return `${source} · ${preview.marketplaceTransactionId}`;
  if (preview.tradeTransactionId) return `${source} · ${preview.tradeTransactionId}`;
  return source;
}

/** A failed flow, in terminal form. Never echoes what the user typed. */
export function renderPspFailure(state: PSPImportFlowState, caps: CliCaps): string[] {
  const p = paint(caps);
  return [
    '',
    p.boldTone('coral', `PSP AGENT IMPORT — ${state.phase.replace(/_/g, ' ').toUpperCase()}`),
    `  ${p.tone('cream', safeText(state.message ?? 'The import did not complete.', { maxLength: 160 }))}`,
    `  ${p.dim(safeText(state.nextAction ?? '', { maxLength: 160 }))}`,
    ...(state.maskedAgentId ? [`  ${p.dim('AGENT ID')}  ${p.tone('gray', state.maskedAgentId)}`] : []),
    '',
  ];
}

/* ------------------------------- command -------------------------------- */

const ENTRY_PROMPT = 'Enter your PSP Agent ID (input is hidden): ';

export async function runPspAgentImportCommand(
  options: PspImportCommandOptions,
): Promise<PspImportCommandResult> {
  const { caps, io } = options;
  const p = paint(caps);
  const emitted: string[] = [];
  /** The single exit for text: redact, then print. */
  const say = (line: string): void => {
    const safe = redactPspAgentIds(line);
    emitted.push(safe);
    io.out(safe);
  };

  let state: PSPImportFlowState = initialPspImportState(options.workspace.userId);
  // The ONE variable that ever holds the credential in this process. It is
  // cleared in the `finally` below on every exit path.
  let credential = '';

  try {
    say('');
    say(p.boldTone('gold', 'IMPORT PSP AGENT'));
    say(p.dim('  A PSP Agent ID is a credential. It is never shown, stored, or logged.'));

    /* ---------------------------- 1. secure entry --------------------- */
    if (options.source.kind === 'env') {
      const value = options.source.read(options.source.name);
      if (value === undefined || value.trim() === '') {
        say(p.tone('coral', `  ${options.source.name} is not set — nothing was read.`));
        return result(state, emitted, 'invalid');
      }
      credential = value;
      say(p.dim(`  Read from the ${options.source.name} environment reference.`));
    } else if (options.source.kind === 'stdin') {
      credential = (await options.source.read()).trim();
      if (credential === '') {
        say(p.tone('coral', '  Nothing was read from stdin.'));
        return result(state, emitted, 'empty');
      }
      say(p.dim('  Read from stdin.'));
    } else {
      const typed = await io.readSecret(ENTRY_PROMPT);
      if (typed === null) {
        say(p.tone('coral', '  This terminal cannot hide typed input, so the ID was not requested.'));
        say(p.dim('  Pipe it instead:  cat id.txt | relay agent import --stdin'));
        return result(state, emitted, 'invalid');
      }
      credential = typed.trim();
    }

    /* ---------------------------- 2. validate ------------------------- */
    say(p.dim('  Validating…'));
    state = submitPspAgentId(state, {
      credential,
      workspace: options.workspace,
      service: options.service,
      now: options.now(),
    });

    if (state.phase !== 'valid' || !state.preview) {
      renderPspFailure(state, caps).forEach(say);
      return result(state, emitted, state.phase);
    }

    /* ---------------------------- 3. preview -------------------------- */
    renderPspPreview(state.preview, caps).forEach(say);

    /* -------------------------- 4. confirmation ----------------------- */
    const confirmed = options.assumeYes === true
      ? true
      : await io.confirm('  Import this PSP agent into the workspace? [y/N] ');
    if (!confirmed) {
      say(p.tone('amber', '  Import cancelled. Nothing was imported and nothing was redeemed.'));
      return result(state, emitted, 'confirmation_required');
    }

    /* ---------------------------- 5. import --------------------------- */
    state = confirmPspAgentImport(state, {
      credential,
      workspace: options.workspace,
      service: options.service,
      now: options.now(),
      importId: options.importId(),
      confirmed: true,
    });

    if (state.phase !== 'imported' || !state.record) {
      renderPspFailure(state, caps).forEach(say);
      return result(state, emitted, state.phase);
    }

    // Report the IDENTITY of what was imported — never the credential.
    const record = state.record;
    say('');
    say(p.boldTone('green', 'PSP AGENT IMPORTED'));
    say(`  ${p.dim('AGENT')}       ${p.tone('cream', safeText(record.displayName, { maxLength: 80 }))}`);
    say(`  ${p.dim('PSP AGENT ID')} ${p.tone('cream', record.pspAgentId)}`);
    say(`  ${p.dim('PSP')}         ${p.tone('cream', `${record.pspId} · ${record.pspVersionId}`)}`);
    say(`  ${p.dim('WORKSPACE')}   ${p.tone('cream', record.workspaceId)}`);
    say(`  ${p.dim('ROLES')}       ${p.tone('cream', record.agentRoleSummary.join(' · '))}`);
    say(`  ${p.dim('SOURCE')}      ${p.tone('cream', record.source.replace(/_/g, ' ').toUpperCase())}`);
    say(p.dim('  The PSP Agent ID was redeemed and is no longer displayable.'));
    say('');
    return result(state, emitted, 'imported');
  } finally {
    // Clear the credential from controlled state on EVERY exit path.
    credential = '';
    state = clearPspImportFlow(state);
    void credential;
  }
}

function result(
  state: PSPImportFlowState,
  lines: string[],
  phase: PSPImportPhase,
): PspImportCommandResult {
  return {
    phase,
    imported: phase === 'imported',
    pspAgentId: state.record?.pspAgentId ?? null,
    displayName: state.record?.displayName ?? null,
    lines,
  };
}

/* ------------------------------ guardrails ------------------------------ */

/**
 * Guidance shown when someone tries to pass a credential as an argument. The
 * CLI refuses rather than accepting it, because a bearer credential in argv is
 * a bearer credential in shell history and in the process table.
 */
export const PSP_ARGUMENT_REFUSAL = [
  'A PSP Agent ID is never accepted as a command argument — it would be written',
  'to your shell history and be visible in the process list.',
  '',
  'Use one of these instead:',
  '  relay agent import                          (prompts with hidden input)',
  '  cat id.txt | relay agent import --stdin     (secure stdin)',
  '  relay agent import --credential-env NAME    (named environment reference)',
];

/** True when an argv value looks like someone pasted a credential. */
export function looksLikePspCredentialArgument(value: string): boolean {
  return containsPspAgentId(value) || /^PSP-AGENT-/i.test(value.trim());
}

/** Mask helper re-exported so callers never reach for the raw value. */
export { maskPspAgentId };
