import { describe, expect, it } from 'vitest';

import {
  COMPOUND_AGENT_SLOTS,
} from '../compound-agent';
import {
  JULIUS_AUTONOMY_LEVELS,
  OPERATION_REQUEST_BOUNDS,
  RELAY_JULIUS_COMMANDS,
  RELAY_JULIUS_OPERATIONS,
  RELAY_JULIUS_OPERATION_VERSION,
  parseJuliusCommand,
  requestedAutonomyIsCoherent,
  unwiredJuliusOperationPort,
  type CommandContext,
} from './index';

/**
 * THE PARSER, ADVERSARIALLY.
 *
 * A control surface's worst failure is a command that silently becomes a
 * different command, so most of this file is about what the parser REFUSES.
 * The rest holds the shape/policy line: Relay refuses values that are not
 * values, and never refuses one on the grounds that a policy would.
 */

const CONTEXT: CommandContext = {
  runId: 'julius-run-42', requestId: 'req-1', issuedBy: 'ghu-1',
  issuedAt: '2026-08-27T02:00:00.000Z', executionMode: 'autonomous',
};

const parse = (line: string, over: Partial<CommandContext> = {}) =>
  parseJuliusCommand(line, { ...CONTEXT, ...over });

const reasons = (result: ReturnType<typeof parse>) =>
  (result.ok ? [] : result.problems.map((p) => p.reason));

const mustParse = (line: string, over: Partial<CommandContext> = {}) => {
  const result = parse(line, over);
  if (!result.ok) throw new Error(`${line} must parse: ${JSON.stringify(reasons(result))}`);
  return result.request;
};

/* ---------------------------------------------------------- the envelope */

describe('every command carries the same envelope', () => {
  it('stamps the operation version and the caller context', () => {
    for (const line of ['/resume', '/pause held for review', '/gauntletloop']) {
      const request = mustParse(line);
      expect(request.operationVersion).toBe(RELAY_JULIUS_OPERATION_VERSION);
      expect(request.runId).toBe('julius-run-42');
      expect(request.requestId).toBe('req-1');
      expect(request.issuedBy).toBe('ghu-1');
      expect(request.issuedAt).toBe('2026-08-27T02:00:00.000Z');
    }
  });

  it('produces only operations the contract declares', () => {
    for (const line of [
      '/gauntletloop', '/autonomy AUTONOMOUS', '/pause x', '/resume', '/cancel done',
      '/approve apr-1', '/deny apr-1 not yet',
      '/subagent --capability security-review --task check --parent-task tsk-1',
    ]) {
      expect(RELAY_JULIUS_OPERATIONS).toContain(mustParse(line).operation);
    }
  });

  it('refuses a command with no issuer, run id, or request id', () => {
    expect(reasons(parse('/resume', { runId: '' }))).toContain('invalid_run_id');
    expect(reasons(parse('/resume', { requestId: '' }))).toContain('invalid_request_id');
    expect(reasons(parse('/resume', { issuedBy: '   ' }))).toContain('invalid_issuer');
  });

  it('redacts a secret a user pasted into the command line', () => {
    const request = mustParse('/pause blocked on sk-abcdefghijklmnop1234');
    expect(request.sourceText).not.toContain('sk-abcdefghijklmnop1234');
    expect(request.sourceText).toContain('[redacted]');
    if (request.operation !== 'PAUSE_RUN') throw new Error('expected a pause');
    expect(request.reason).not.toContain('sk-abcdefghijklmnop1234');
  });
});

/* ---------------------------------------------------------- not a command */

describe('what is not a command', () => {
  it('refuses empty input', () => {
    for (const line of ['', '   ', '\t']) expect(reasons(parse(line))).toContain('empty_command');
  });

  it('refuses free text rather than interpreting it', () => {
    expect(reasons(parse('please run a gauntlet with five rounds'))).toContain('not_a_command');
  });

  it('refuses an unknown command and never a nearest match', () => {
    for (const line of ['/gauntletlop', '/gauntlet', '/unchained', '/start', '/gauntletloops']) {
      const result = parse(line);
      expect(result.ok, line).toBe(false);
      expect(reasons(result), line).toContain('unknown_command');
    }
  });

  it('lists the commands it does accept when refusing one it does not', () => {
    const result = parse('/nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const command of RELAY_JULIUS_COMMANDS) {
      expect(result.problems[0].safeMessage).toContain(`/${command}`);
    }
  });
});

/* -------------------------------------------------------------- quoting */

describe('quoting', () => {
  it('keeps a multi-word value together', () => {
    for (const line of [
      '/pause --reason="waiting on the founder"',
      "/pause --reason='waiting on the founder'",
      '/pause --reason "waiting on the founder"',
    ]) {
      const request = mustParse(line);
      if (request.operation !== 'PAUSE_RUN') throw new Error('expected a pause');
      expect(request.reason, line).toBe('waiting on the founder');
    }
  });

  it('treats a quoted flag-looking word as TEXT, never as a directive', () => {
    // The user quoted it, so they said it is a value. A tokenizer that forgets
    // the quotes turns a quoted word into a flag.
    const request = mustParse('/pause "--rounds 5 is not what I meant"');
    if (request.operation !== 'PAUSE_RUN') throw new Error('expected a pause');
    expect(request.reason).toBe('--rounds 5 is not what I meant');
  });

  it('refuses an unterminated quote rather than closing it', () => {
    for (const line of ['/pause --reason="never closed', "/cancel --reason='oops"]) {
      const result = parse(line);
      expect(result.ok, line).toBe(false);
      expect(reasons(result), line).toContain('unterminated_quote');
    }
  });

  it('separates an explicitly empty value from an absent one', () => {
    // `--reason=""` says "none" and is refused BY THE COMMAND, which names the
    // field. `--reason` with nothing after it is a different mistake.
    expect(reasons(parse('/cancel --reason=""'))).toContain('missing_required_flag');
    expect(reasons(parse('/cancel --reason'))).toContain('missing_flag_value');
  });

  it('still refuses a whitespace-only reason once the quotes are stripped', () => {
    expect(reasons(parse('/cancel --reason="   "'))).toContain('missing_required_flag');
  });

  it('parses a quoted value that itself contains the other quote character', () => {
    const request = mustParse(`/cancel --reason="the founder's call"`);
    if (request.operation !== 'CANCEL_RUN') throw new Error('expected a cancel');
    expect(request.reason).toBe("the founder's call");
  });
});

/* ------------------------------------------------------------- gauntlet */

describe('/gauntletloop', () => {
  it('requests a gauntlet with no ceiling when none is named', () => {
    const request = mustParse('/gauntletloop');
    expect(request.operation).toBe('START_GAUNTLET');
    if (request.operation !== 'START_GAUNTLET') return;
    // ABSENT IS NOT ZERO and never a substituted default.
    expect(request.requestedLimits.maxRounds).toBeNull();
  });

  it('carries the requested ceiling in both flag forms', () => {
    for (const line of ['/gauntletloop --rounds 5', '/gauntletloop --rounds=5']) {
      const request = mustParse(line);
      if (request.operation !== 'START_GAUNTLET') throw new Error('expected a gauntlet');
      expect(request.requestedLimits.maxRounds, line).toBe(5);
    }
  });

  it('refuses a value that is not a whole number of rounds', () => {
    for (const raw of ['banana', '5.5', '-3', '1e3', '0x10', '', ' ']) {
      const result = parse(`/gauntletloop --rounds=${raw}`);
      expect(result.ok, `--rounds=${raw}`).toBe(false);
      expect(reasons(result)).toEqual(
        expect.arrayContaining([expect.stringMatching(/invalid_flag_value|missing_flag_value/)]),
      );
    }
  });

  it('refuses zero rounds — a gauntlet of none is not a gauntlet', () => {
    expect(reasons(parse('/gauntletloop --rounds 0'))).toContain('value_out_of_range');
  });

  it('refuses a value past the request-shape bound', () => {
    const over = OPERATION_REQUEST_BOUNDS.maxGauntletRounds + 1;
    const result = parse(`/gauntletloop --rounds ${over}`);
    expect(reasons(result)).toContain('value_out_of_range');
    if (result.ok) return;
    // And says plainly that the ceiling is not a policy claim.
    expect(result.problems[0].safeMessage).toContain('not a policy limit');
  });

  it('accepts the bound itself, because Relay does not decide policy', () => {
    const request = mustParse(`/gauntletloop --rounds ${OPERATION_REQUEST_BOUNDS.maxGauntletRounds}`);
    if (request.operation !== 'START_GAUNTLET') throw new Error('expected a gauntlet');
    expect(request.requestedLimits.maxRounds).toBe(OPERATION_REQUEST_BOUNDS.maxGauntletRounds);
  });

  it('refuses an unknown flag rather than dropping half the request', () => {
    const result = parse('/gauntletloop --rounds 5 --unchained yes');
    expect(result.ok).toBe(false);
    expect(reasons(result)).toContain('unknown_flag');
  });

  it('refuses a duplicated flag rather than choosing one', () => {
    expect(reasons(parse('/gauntletloop --rounds 3 --rounds 9'))).toContain('duplicate_flag');
  });

  it('refuses stray positional text', () => {
    expect(reasons(parse('/gauntletloop please'))).toContain('unexpected_argument');
  });

  it('refuses a flag whose value was swallowed by the next flag', () => {
    expect(reasons(parse('/gauntletloop --rounds --reason x'))).toContain('missing_flag_value');
  });
});

/* -------------------------------------------------------------- autonomy */

describe('/autonomy', () => {
  it('accepts each declared level, positionally or by flag', () => {
    for (const level of JULIUS_AUTONOMY_LEVELS) {
      for (const line of [`/autonomy ${level}`, `/autonomy --mode ${level}`, `/autonomy ${level.toLowerCase()}`]) {
        const request = mustParse(line);
        if (request.operation !== 'SET_AUTONOMY_MODE') throw new Error('expected an autonomy request');
        expect(request.requestedMode, line).toBe(level);
      }
    }
  });

  it('refuses a level it does not declare', () => {
    for (const raw of ['FERAL', 'unchained!', 'super', '']) {
      const result = parse(`/autonomy --mode=${raw}`);
      expect(result.ok, raw).toBe(false);
    }
  });

  it('refuses UNCHAINED from guided mode as an incoherent request', () => {
    const result = parse('/autonomy UNCHAINED', { executionMode: 'guided' });
    expect(result.ok).toBe(false);
    expect(reasons(result)).toContain('autonomy_conflicts_with_execution_mode');
  });

  it('composes UNCHAINED from semi and autonomous, and never claims it was granted', () => {
    for (const executionMode of ['semi', 'autonomous'] as const) {
      const request = mustParse('/autonomy UNCHAINED', { executionMode });
      if (request.operation !== 'SET_AUTONOMY_MODE') throw new Error('expected an autonomy request');
      expect(request.requestedMode).toBe('UNCHAINED');
      // The field is REQUESTED. Nothing in the type says it took effect.
      expect(Object.keys(request)).not.toContain('autonomyMode');
      expect(Object.keys(request)).not.toContain('granted');
    }
  });

  it('states the coherence rule exactly, and nothing beyond it', () => {
    expect(requestedAutonomyIsCoherent('UNCHAINED', 'guided')).toBe(false);
    expect(requestedAutonomyIsCoherent('UNCHAINED', 'semi')).toBe(true);
    expect(requestedAutonomyIsCoherent('UNCHAINED', 'autonomous')).toBe(true);
    // Every other combination is permitted to be COMPOSED. Julius decides
    // whether it is permitted to happen.
    for (const mode of ['guided', 'semi', 'autonomous'] as const) {
      expect(requestedAutonomyIsCoherent('SUPERVISED', mode)).toBe(true);
      expect(requestedAutonomyIsCoherent('AUTONOMOUS', mode)).toBe(true);
    }
  });

  it('refuses a missing mode', () => {
    expect(reasons(parse('/autonomy'))).toContain('missing_required_flag');
  });
});

/* -------------------------------------------------------------- subagent */

describe('/subagent', () => {
  const LINE = '/subagent --capability security-review --task="Audit the boundary" --parent-task tsk-7';

  it('requests a child and creates none', () => {
    const request = mustParse(LINE);
    expect(request.operation).toBe('REQUEST_SUBAGENT');
    if (request.operation !== 'REQUEST_SUBAGENT') return;
    expect(request.requestedCapability).toBe('security-review');
    expect(request.requestedTask).toBe('Audit the boundary');
    expect(request.parentTaskId).toBe('tsk-7');
    expect(request.rolePreference).toBeNull();
    expect(request.requestedBounds).toEqual({ maxDepth: null, maxChildren: null });
  });

  it('carries a role PREFERENCE, only for a permanent worker role', () => {
    for (const role of COMPOUND_AGENT_SLOTS) {
      const request = mustParse(`${LINE} --role ${role}`);
      if (request.operation !== 'REQUEST_SUBAGENT') throw new Error('expected a subagent request');
      expect(request.rolePreference).toBe(role);
    }
  });

  it('refuses a specialist role by name — Julius assigns those', () => {
    for (const role of ['SPECIALIST:security', 'JULIUS', 'RELAY', 'anything']) {
      const result = parse(`${LINE} --role ${role}`);
      expect(result.ok, role).toBe(false);
      expect(reasons(result)).toContain('unsupported_role_preference');
    }
  });

  it('refuses a request missing any required flag', () => {
    for (const line of [
      '/subagent --task x --parent-task tsk-1',
      '/subagent --capability c --parent-task tsk-1',
      '/subagent --capability c --task x',
      '/subagent',
    ]) {
      const result = parse(line);
      expect(result.ok, line).toBe(false);
      expect(reasons(result), line).toContain('missing_required_flag');
    }
  });

  it('bounds the requested depth and child count', () => {
    const depth = OPERATION_REQUEST_BOUNDS.maxSubagentDepth + 1;
    const children = OPERATION_REQUEST_BOUNDS.maxSubagentCount + 1;
    expect(reasons(parse(`${LINE} --max-depth ${depth}`))).toContain('value_out_of_range');
    expect(reasons(parse(`${LINE} --max-children ${children}`))).toContain('value_out_of_range');
    expect(reasons(parse(`${LINE} --max-depth 0`))).toContain('value_out_of_range');
  });

  it('carries requested bounds as a CEILING the caller accepts, never a grant', () => {
    const request = mustParse(`${LINE} --max-depth 2 --max-children 4`);
    if (request.operation !== 'REQUEST_SUBAGENT') throw new Error('expected a subagent request');
    expect(request.requestedBounds).toEqual({ maxDepth: 2, maxChildren: 4 });
    // No field asserts what was authorized; Julius owns authorization.
    expect(Object.keys(request)).not.toContain('grantedBounds');
    expect(Object.keys(request)).not.toContain('permissions');
  });
});

/* ------------------------------------------------------------- lifecycle */

describe('pause, resume and cancel', () => {
  it('accepts a pause with a free-text reason', () => {
    const request = mustParse('/pause waiting on the founder');
    if (request.operation !== 'PAUSE_RUN') throw new Error('expected a pause');
    expect(request.reason).toBe('waiting on the founder');
  });

  it('accepts a bare resume and refuses arguments to it', () => {
    expect(mustParse('/resume').operation).toBe('RESUME_RUN');
    expect(reasons(parse('/resume now'))).toContain('unexpected_argument');
    expect(reasons(parse('/resume --force yes'))).toContain('unknown_flag');
  });

  it('refuses a cancel with no reason', () => {
    for (const line of ['/cancel', '/cancel   ', '/cancel --reason=" "']) {
      const result = parse(line);
      expect(result.ok, line).toBe(false);
    }
  });

  it('accepts a cancel with a reason, in either form', () => {
    for (const line of ['/cancel superseded by #170', '/cancel --reason superseded']) {
      const request = mustParse(line);
      if (request.operation !== 'CANCEL_RUN') throw new Error('expected a cancel');
      expect(request.reason.length, line).toBeGreaterThan(0);
    }
  });

  it('refuses free text longer than the wire bound', () => {
    const long = 'x'.repeat(OPERATION_REQUEST_BOUNDS.maxTextLength + 1);
    expect(reasons(parse(`/pause --reason=${long}`))).toContain('text_too_long');
  });
});

/* -------------------------------------------------------------- approval */

describe('/approve and /deny', () => {
  it('answers an approval by id', () => {
    const approve = mustParse('/approve apr-1');
    if (approve.operation !== 'SUBMIT_APPROVAL') throw new Error('expected an approval');
    expect(approve.approvalId).toBe('apr-1');
    expect(approve.decision).toBe('APPROVE');

    const deny = mustParse('/deny apr-1 the scope grew');
    if (deny.operation !== 'SUBMIT_APPROVAL') throw new Error('expected an approval');
    expect(deny.decision).toBe('DENY');
    expect(deny.reason).toBe('the scope grew');
  });

  it('refuses an approval that names nothing', () => {
    expect(reasons(parse('/approve'))).toContain('missing_required_flag');
    expect(reasons(parse('/deny'))).toContain('missing_required_flag');
  });

  it('refuses a denial with no reason and permits an approval without one', () => {
    expect(reasons(parse('/deny apr-1'))).toContain('missing_required_flag');
    expect(parse('/approve apr-1').ok).toBe(true);
  });

  it('refuses an approval id longer than the wire bound', () => {
    const long = 'a'.repeat(OPERATION_REQUEST_BOUNDS.maxIdentifierLength + 1);
    expect(reasons(parse(`/approve --approval=${long}`))).toContain('invalid_flag_value');
  });
});

/* ------------------------------------------------------------- the port */

describe('the unwired operation port', () => {
  it('refuses honestly rather than acknowledging a command it did not deliver', async () => {
    const port = unwiredJuliusOperationPort();
    const outcome = await port.submit(mustParse('/gauntletloop --rounds 3'));
    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) return;
    expect(outcome.reasonCode).toBe('julius_runtime_not_wired');
    expect(outcome.safeMessage).toContain('not submitted anywhere');
    expect(outcome.retryable).toBe(false);
  });

  it('names acceptance an ACKNOWLEDGEMENT and carries no result', () => {
    const accepted = {
      accepted: true as const, acknowledgedAt: '2026-08-27T02:00:01.000Z',
      safeSummary: 'Gauntlet requested.',
    };
    expect(Object.keys(accepted)).not.toContain('rounds');
    expect(Object.keys(accepted)).not.toContain('cleared');
  });
});

/* --------------------------------------------------------- no policy here */

describe('the parser holds the shape/policy line', () => {
  it('accepts every round count inside the wire bound, deciding nothing about permission', () => {
    for (const rounds of [1, 2, 3, 5, 13, 99, 500]) {
      const request = mustParse(`/gauntletloop --rounds ${rounds}`);
      if (request.operation !== 'START_GAUNTLET') throw new Error('expected a gauntlet');
      expect(request.requestedLimits.maxRounds).toBe(rounds);
    }
  });

  it('exposes no gauntlet, repair, budget or verification behaviour to duplicate', () => {
    const request = mustParse('/gauntletloop --rounds 3');
    expect(Object.keys(request).sort()).toEqual([
      'issuedAt', 'issuedBy', 'operation', 'operationVersion',
      'requestId', 'requestedLimits', 'runId', 'sourceText',
    ]);
  });
});
