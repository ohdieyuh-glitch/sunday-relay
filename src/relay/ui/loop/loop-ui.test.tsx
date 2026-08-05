import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayLoopComposer } from './RelayLoopComposer';
import { RelayLoopOverview, RELAY_LOOP_OVERVIEW_SECTIONS } from './RelayLoopOverview';
import { RelayLoopTargetPicker, targetChoiceCommand, targetChoiceExpression } from './RelayLoopTargetPicker';
import {
  EXECUTION_IMPLYING_STATUSES,
  RELAY_LOOP_PRESENTATION_STATUSES,
  RELAY_LOOP_STATUS_DESCRIPTION,
  RELAY_LOOP_STATUS_LABEL,
  deriveLoopPresentationStatus,
  statusImpliesExecution,
} from './loop-status';
import { projectLoopComposerView, projectSwarmGateView, type RelayLoopComposerInput } from './loop-view';
import {
  ALL_LOOP_FEATURES_DISABLED,
  DEFAULT_LOOP_LIMITS,
  RELAY_LOOP_STATES,
  evaluateLoopAvailability,
  parseSlashCommand,
  renderLoopPreviewLines,
  resolveLoopTarget,
  type RelayAgentRegistrySnapshot,
  type RelayLoopFeatureFlags,
} from '../../mission';
import { runLoopCli } from '../../cli/loop-cli';

const NOW = '2026-08-02T12:00:00.000Z';
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

const REGISTRY: RelayAgentRegistrySnapshot = {
  activeCompoundAgentRoles: ['prompt_architect', 'coding_agent'],
  eligibleRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
  availability: { prompt_architect: 'available', coding_agent: 'available', reviewer: 'available' },
  provenance: 'simulated',
  observedAt: NOW,
};

const ENABLED: RelayLoopFeatureFlags = { loop_engine: true };

function viewFor(
  input: string,
  options: {
    registry?: RelayAgentRegistrySnapshot | null;
    flags?: RelayLoopFeatureFlags;
    validationProblems?: readonly string[];
  } = {},
) {
  const parsed = parseSlashCommand(input);
  if (!parsed.ok) throw new Error(`could not parse ${input}`);
  const command = parsed.value.command;
  const registry = options.registry === undefined ? REGISTRY : options.registry;
  const availability = evaluateLoopAvailability({
    command,
    flags: options.flags ?? ALL_LOOP_FEATURES_DISABLED,
    unchain: null,
    assignableRoles: registry?.eligibleRoles ?? [],
    observedAt: NOW,
  });
  const target =
    registry !== null &&
    (command.kind === 'loop_create' ||
      command.kind === 'sloop_create' ||
      command.kind === 'loop_schedule_create' ||
      command.kind === 'loop_cron_create')
      ? resolveLoopTarget(command.target, registry)
      : null;

  const composerInput: RelayLoopComposerInput = {
    parsed: parsed.value,
    availability,
    target,
    limits: DEFAULT_LOOP_LIMITS,
    independentReviewRequired: true,
    loopType: 'execution',
    projectId: 'prj_1',
    workspaceId: null,
    acceptanceCriteria: [],
    stopConditions: ['completion_policy_satisfied', 'max_iterations_reached'],
    validationProblems: options.validationProblems ?? [],
  };
  return { view: projectLoopComposerView(composerInput), availability, parsed: parsed.value };
}

function renderComposer(input: string, options?: Parameters<typeof viewFor>[1]) {
  const { view, availability, parsed } = viewFor(input, options);
  return html(
    createElement(RelayLoopComposer, {
      view,
      swarmGate: parsed.family === 'sloop' ? projectSwarmGateView(availability) : undefined,
      onCancel: () => undefined,
      onSaveDraft: () => undefined,
      onContinueToPreflight: () => undefined,
    }),
  );
}

/* ------------------------------------------------------------- composer */

describe('the Loop Composer opens from a command and shows what was parsed', () => {
  it('/loop opens the composer without drafting a contract', () => {
    const markup = renderComposer('/loop');
    expect(markup).toContain('Open the Loop Composer');
    // Nothing to confirm, so no contract boundary and no limits.
    expect(markup).not.toContain('LOOP CONTRACT PREVIEW');
    expect(markup).not.toContain('Spending cap');
  });

  it('displays the parsed objective verbatim', () => {
    expect(renderComposer('/loop all repair the authentication tests')).toContain(
      'repair the authentication tests',
    );
  });

  it('displays the requested target', () => {
    expect(renderComposer('/loop all fix it')).toContain('all');
    expect(renderComposer('/loop fix it')).toContain('no target was named');
  });

  it('shows whole-team roles truthfully from the registry', () => {
    const markup = renderComposer('/loop all fix it');
    expect(markup).toContain('architect');
    expect(markup).toContain('coding');
    expect(markup).toContain('reviewer');
  });

  it('renders a multi-role target', () => {
    const markup = renderComposer('/loop architect,coding ship it');
    expect(markup).toContain('architect,coding');
    expect(markup).toContain('Resolved roles');
  });

  it('shows unavailable roles and why', () => {
    const partial: RelayAgentRegistrySnapshot = {
      ...REGISTRY,
      availability: { prompt_architect: 'available', coding_agent: 'entitlement_locked' },
    };
    const markup = renderComposer('/loop architect,coding fix it', { registry: partial });
    expect(markup).toContain('Unavailable roles');
    expect(markup).toContain('not included in the current plan');
  });

  it('says Unknown rather than showing an empty agent list when it cannot read the registry', () => {
    const markup = renderComposer('/loop all fix it', { registry: null });
    expect(markup).toContain('Unknown');
    expect(markup).toContain('has not been able to read the agent registry');
  });

  it('separates requested, resolved, unavailable and ACTUAL assigned agents', () => {
    const markup = renderComposer('/loop all fix it');
    expect(markup).toContain('Requested');
    expect(markup).toContain('Resolved roles');
    expect(markup).toContain('Assigned agents');
    // The distinction that matters most: nothing is assigned, and it says so.
    expect(markup).toContain('No agent has been assigned');
    expect(markup).toContain('no Loop has run');
  });
});

/* --------------------------------------------------- confirmation boundary */

describe('the confirmation boundary is visible and honest', () => {
  it('states that nothing has started and nothing was called', () => {
    const markup = renderComposer('/loop all fix it');
    expect(markup).toContain('LOOP CONTRACT PREVIEW');
    expect(markup).toContain('No work has started.');
    expect(markup).toContain('No provider call has been made.');
    expect(markup).toContain('Review the limits and agents before activation.');
  });

  it('offers Save draft, Cancel and Continue to preflight', () => {
    const { view } = viewFor('/loop all fix it', { flags: ENABLED });
    const controls = Object.fromEntries(view.controls.map((c) => [c.control, c]));
    expect(controls.save_draft.enabled).toBe(true);
    expect(controls.cancel.enabled).toBe(true);
    expect(controls.continue_to_preflight.enabled).toBe(true);
  });

  it('NEVER enables Start Loop before a runtime exists', () => {
    for (const command of ['/loop all fix it', '/loop coding fix it', '/sloop fix it']) {
      for (const flags of [ALL_LOOP_FEATURES_DISABLED, ENABLED, { loop_engine: true, unchain: true, sloop: true }]) {
        const { view } = viewFor(command, { flags });
        const start = view.controls.find((c) => c.control === 'start_loop');
        expect(start?.enabled, `${command} must not enable Start`).toBe(false);
        expect(start?.disabledReason).toContain('not implemented');
      }
    }
  });

  it('renders the reason a control is disabled, not just a tooltip', () => {
    const markup = renderComposer('/loop all fix it');
    expect(markup).toContain('Loop execution is not implemented in this build');
  });

  it('blocks Continue to preflight while anything blocks', () => {
    const { view } = viewFor('/loop all fix it'); // engine disabled
    const proceed = view.controls.find((c) => c.control === 'continue_to_preflight');
    expect(proceed?.enabled).toBe(false);
    expect(proceed?.disabledReason).toContain('Resolve the blockers');
  });

  it('no rendered control claims a Loop is running', () => {
    const markup = renderComposer('/loop all fix it', { flags: ENABLED });
    for (const forbidden of ['Loop is running', 'Running…', 'Now running', 'Started']) {
      expect(markup).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------ validation */

describe('validation problems are surfaced accessibly', () => {
  it('lists problems and announces them in a live region', () => {
    const markup = renderComposer('/loop all fix it', {
      flags: ENABLED,
      validationProblems: ['A Loop needs an objective.', 'maxIterations must be a positive number or null (unbounded).'],
    });
    expect(markup).toContain('PROBLEMS');
    expect(markup).toContain('A Loop needs an objective.');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('2 problems must be resolved');
  });

  it('reports the status as NEEDS CHANGES rather than a generic failure', () => {
    const { view } = viewFor('/loop all fix it', { flags: ENABLED, validationProblems: ['bad'] });
    expect(view.status).toBe('invalid');
    expect(RELAY_LOOP_STATUS_LABEL[view.status]).toBe('NEEDS CHANGES');
  });

  it('distinguishes a disabled feature from a user mistake', () => {
    const { view } = viewFor('/loop all fix it'); // engine off, nothing wrong with the request
    expect(view.status).toBe('feature_disabled');
    expect(RELAY_LOOP_STATUS_DESCRIPTION[view.status]).toContain('not enabled in this build');
  });
});

/* --------------------------------------------------------------- S-Loop */

describe('the S-Loop gate is truthful', () => {
  it('states that Unchain is required and not enabled, and grants nothing', () => {
    const markup = renderComposer('/sloop explore three repairs', { flags: ENABLED });
    expect(markup).toContain('S-LOOPS REQUIRE UNCHAIN');
    expect(markup).toContain('Unchain expands agent capacity and unlocks Swarm Loops.');
    expect(markup).toContain('Unchain runtime is not yet enabled in this build.');
    expect(markup).toContain('no temporary slots have been created');
  });

  it('never reports an activation as successful', () => {
    const { availability } = viewFor('/sloop fix it', { flags: { loop_engine: true, unchain: true, sloop: true } });
    const gate = projectSwarmGateView(availability);
    expect(gate.unchainActive).toBe(false);
    expect(gate.temporarySlotsGranted).toBe(0);
  });

  it('takes its slot count from server-evaluated availability, never a constant', () => {
    const source = readFileSync(join(__dirname, 'loop-view.ts'), 'utf8');
    // The gate must read availability.grantedTemporarySlots, not hardcode 2.
    expect(source).toContain('availability.grantedTemporarySlots');
    expect(/temporarySlotsGranted:\s*2\b/.test(source)).toBe(false);
  });

  it('no UI module can mint or assert an Unchain session', () => {
    for (const file of ['loop-view.ts', 'RelayLoopComposer.tsx', 'RelayLoopOverview.tsx', 'RelayLoopTargetPicker.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(/grantedToOperator/.test(source), `${file} touches the operator-grant flag`).toBe(false);
      expect(/UnchainSessionRecord\s*=/.test(source), `${file} constructs a session`).toBe(false);
    }
  });
});

/* ----------------------------------------------------------- cron preview */

describe('the scheduled Loop preview claims no persistence', () => {
  it('shows the raw expression, an unparsed schedule, and a not-scheduled status', () => {
    const markup = renderComposer('/loop cron "0 8 * * 1-5" inspect dependency alerts', { flags: ENABLED });
    expect(markup).toContain('0 8 * * 1-5');
    expect(markup).toContain('Parsed schedule');
    expect(markup).toContain('Runtime status');
    expect(markup).toContain('Not scheduled');
    expect(markup).toContain('Timezone');
  });

  it('shows the default overlap and missed-run policies as not yet applied', () => {
    const markup = renderComposer('/loop schedule every weekday at 8am inspect the repo', { flags: ENABLED });
    expect(markup).toContain('queue_one');
    expect(markup).toContain('run_latest');
    expect(markup).toContain('not yet applied');
  });

  it('never says the schedule was saved, armed or activated', () => {
    const markup = renderComposer('/loop cron "0 8 * * 1-5" do a thing', { flags: ENABLED });
    for (const forbidden of ['Scheduled successfully', 'Schedule saved', 'Armed', 'Next run']) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it('does not use a browser timer anywhere in the Loop surface', () => {
    for (const file of ['loop-view.ts', 'loop-status.ts', 'RelayLoopComposer.tsx', 'RelayLoopOverview.tsx', 'RelayLoopTargetPicker.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(/setInterval|setTimeout/.test(source), `${file} uses a browser timer`).toBe(false);
    }
  });
});

/* -------------------------------------------------------------- overview */

describe('the /loops overview is truthfully empty', () => {
  const markup = html(
    createElement(RelayLoopOverview, { onClose: () => undefined, onStartComposer: () => undefined }),
  );

  it('renders all five sections', () => {
    for (const title of ['DRAFT LOOPS', 'ACTIVE LOOPS', 'SCHEDULED LOOPS', 'TEMPLATES', 'RECENT LOOP HISTORY']) {
      expect(markup).toContain(title);
    }
  });

  it('explains WHY each section is empty rather than showing a zero', () => {
    // Was `No Loop has ever run`. That stopped being the honest sentence when
    // the runtime landed: the truthful facts are that this SURFACE has no
    // server to ask, and that no Loop has run outside a test.
    expect(markup).toContain('no server to ask');
    expect(markup).toContain('No Loop has run outside a test');
    expect(markup).toContain('the scheduler is not enabled');
    expect(markup).toContain('not implemented yet');
    expect(markup).toContain('NOT AVAILABLE YET');
  });

  it('inserts no fixture Loops into the production path', () => {
    for (const section of RELAY_LOOP_OVERVIEW_SECTIONS) {
      expect(section.items).toEqual([]);
      expect(section.fixtureLabel).toBeUndefined();
    }
  });

  it('labels fixture data explicitly when a development surface supplies it', () => {
    const withFixture = html(
      createElement(RelayLoopOverview, {
        onClose: () => undefined,
        onStartComposer: () => undefined,
        sections: [
          {
            id: 'draft',
            title: 'DRAFT LOOPS',
            items: [{ id: 'a', primary: 'Example', secondary: 'demo' }],
            emptyReason: '',
            unavailable: false,
            fixtureLabel: 'DEVELOPMENT FIXTURE — not real Loop data',
          },
        ],
      }),
    );
    expect(withFixture).toContain('DEVELOPMENT FIXTURE');
  });

  it('says what exists now and what does not', () => {
    // Was `Persistent execution is not implemented`, which the runtime made
    // false. What is still true, and is what a user needs, is that this surface
    // cannot start one.
    expect(markup).toContain('single-Loop runtime');
    expect(markup).toContain('cannot start one');
    expect(markup).toContain('Nothing runs and nothing is spent');
  });
});

/* ---------------------------------------------------------------- picker */

describe('target selection emits canonical command text', () => {
  it('produces expressions the parser accepts', () => {
    expect(targetChoiceExpression({ kind: 'active_compound_agent' })).toBeNull();
    expect(targetChoiceExpression({ kind: 'all_eligible_agents' })).toBe('all');
    expect(targetChoiceExpression({ kind: 'exact_roles', roles: ['prompt_architect', 'coding_agent'] })).toBe(
      'architect,coding',
    );
  });

  it('round-trips every choice back through the ONE parser', () => {
    const cases = [
      { choice: { kind: 'active_compound_agent' } as const, roles: [] },
      { choice: { kind: 'all_eligible_agents' } as const, roles: [] },
      { choice: { kind: 'exact_roles', roles: ['prompt_architect'] } as const, roles: ['prompt_architect'] },
      {
        choice: { kind: 'exact_roles', roles: ['prompt_architect', 'coding_agent', 'reviewer'] } as const,
        roles: ['prompt_architect', 'coding_agent', 'reviewer'],
      },
    ];
    for (const { choice, roles } of cases) {
      const text = targetChoiceCommand(choice, 'fix the parser');
      const parsed = parseSlashCommand(text);
      expect(parsed.ok, `${text} must parse`).toBe(true);
      if (!parsed.ok || parsed.value.command.kind !== 'loop_create') throw new Error('unreachable');
      expect(parsed.value.command.target.requestedRoles).toEqual(roles);
      expect(parsed.value.command.objective).toBe('fix the parser');
    }
  });

  it('renders every role, including ones that cannot work, with the reason', () => {
    const markup = html(
      createElement(RelayLoopTargetPicker, {
        choice: { kind: 'exact_roles', roles: ['coding_agent'] },
        availability: { prompt_architect: 'available', coding_agent: 'not_connected' },
        activeCompoundAgentRoles: ['prompt_architect', 'coding_agent'],
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain('architect');
    expect(markup).toContain('coding');
    expect(markup).toContain('not connected');
    // A role with no observation is Unknown, never hidden.
    expect(markup).toContain('availability unknown');
    expect(markup).toContain('will report a blocker rather than run');
  });

  it('shows which roles the compound agent currently resolves to', () => {
    const markup = html(
      createElement(RelayLoopTargetPicker, {
        choice: { kind: 'active_compound_agent' },
        availability: REGISTRY.availability,
        activeCompoundAgentRoles: ['prompt_architect', 'coding_agent'],
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain('Currently architect, coding.');
  });

  it('defines no UI-only role semantics', () => {
    const source = readFileSync(join(__dirname, 'RelayLoopTargetPicker.tsx'), 'utf8');
    // Roles come from the canonical list; the picker must not declare its own.
    expect(source).toContain('RELAY_LOOP_TARGETABLE_ROLES');
    expect(/const\s+ROLES\s*=\s*\[/.test(source)).toBe(false);
  });
});

/* --------------------------------------------------------------- status */

describe('status presentation cannot claim execution', () => {
  it('declares no execution-implying status while there is no runtime', () => {
    expect(EXECUTION_IMPLYING_STATUSES).toEqual([]);
    for (const status of RELAY_LOOP_PRESENTATION_STATUSES) {
      expect(statusImpliesExecution(status)).toBe(false);
    }
  });

  it('offers no word for running, reviewing, repairing or completed', () => {
    for (const forbidden of ['running', 'reviewing', 'repairing', 'completed']) {
      expect(RELAY_LOOP_PRESENTATION_STATUSES as readonly string[]).not.toContain(forbidden);
    }
  });

  it('every status carries a label AND a sentence, so colour is never the only signal', () => {
    for (const status of RELAY_LOOP_PRESENTATION_STATUSES) {
      expect(RELAY_LOOP_STATUS_LABEL[status].length).toBeGreaterThan(0);
      expect(RELAY_LOOP_STATUS_DESCRIPTION[status].length).toBeGreaterThan(20);
    }
  });

  it('reports a feature flag before a validation problem', () => {
    expect(
      deriveLoopPresentationStatus({
        state: 'draft',
        available: false,
        blockedOnlyByFeatureFlags: true,
        validationProblems: ['something'],
        confirmed: false,
      }),
    ).toBe('feature_disabled');
  });

  it('does not duplicate the domain state model', () => {
    const source = readFileSync(join(__dirname, 'loop-status.ts'), 'utf8');
    // It imports the canonical state type rather than re-declaring one.
    expect(source).toContain("import type { RelayLoopState }");
    expect(/export const RELAY_LOOP_STATES\b/.test(source)).toBe(false);
    // And the canonical set still has its own values, untouched.
    expect(RELAY_LOOP_STATES).toContain('running');
  });
});

/* -------------------------------------------------------- CLI ↔ UI parity */

describe('the website and the CLI mean the same thing', () => {
  const COMMANDS: Array<[string, string[]]> = [
    ['/loop all fix it', ['loop', 'all', 'fix', 'it']],
    ['/loop architect plan it', ['loop', 'architect', 'plan', 'it']],
    ['/loop coding repair it', ['loop', 'coding', 'repair', 'it']],
    ['/loop reviewer inspect it', ['loop', 'reviewer', 'inspect', 'it']],
    ['/loop architect,coding ship it', ['loop', 'architect,coding', 'ship', 'it']],
    ['/loop architect,coding,reviewer ship it', ['loop', 'architect,coding,reviewer', 'ship', 'it']],
    ['/loop schedule every weekday at 8am inspect', ['loop', 'schedule', 'every', 'weekday', 'at', '8am', 'inspect']],
    ['/loop cron "0 8 * * 1-5" inspect', ['loop', 'cron', '0', '8', '*', '*', '1-5', 'inspect']],
    ['/sloop explore repairs', ['sloop', 'explore', 'repairs']],
  ];

  for (const [slash, argv] of COMMANDS) {
    it(`${slash} — identical preview on both surfaces`, () => {
      const { view } = viewFor(slash);
      const cli = runLoopCli({ positionals: argv, registry: REGISTRY, observedAt: NOW });
      expect(cli.lines).toEqual(renderLoopPreviewLines(view.preview));
    });
  }

  it('a malformed command fails identically on both surfaces', () => {
    const slash = parseSlashCommand('/loop architect,qa fix it');
    const cli = runLoopCli({ positionals: ['loop', 'architect,qa', 'fix', 'it'], observedAt: NOW });
    expect(slash.ok).toBe(false);
    expect(cli.invalid).toBe(true);
    if (slash.ok) throw new Error('unreachable');
    expect(cli.lines.join(' ')).toContain(slash.error.message);
  });

  it('UI defaults never alter command meaning', () => {
    // The composer takes a parsed command and renders it. It has no default
    // that could change the target, objective or action.
    const { view } = viewFor('/loop coder fix it');
    expect(view.preview.rows.find((r) => r.label === 'Target')?.value).toBe('coder');
    expect(view.preview.rows.find((r) => r.label === 'Objective')?.value).toBe('fix it');
  });
});

/* -------------------------------------------------------- boundaries */

describe('the browser Loop surface reaches nothing it should not', () => {
  const FILES = [
    'loop-view.ts',
    'loop-status.ts',
    'index.ts',
    'RelayLoopComposer.tsx',
    'RelayLoopOverview.tsx',
    'RelayLoopSurface.tsx',
    'RelayLoopTargetPicker.tsx',
  ];

  it('imports no Node builtin, adapter, persistence or CLI module', () => {
    for (const file of FILES) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(/from\s+['"]node:/.test(source), `${file} imports a node builtin`).toBe(false);
      expect(
        /from\s+['"]\.\.\/\.\.\/(persistence|workspace|connectors|cli)/.test(source),
        `${file} reaches a server module`,
      ).toBe(false);
    }
  });

  it('makes no network request and reads no credential or environment value', () => {
    for (const file of FILES) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      for (const [pattern, what] of [
        [/\bfetch\s*\(/, 'the network'],
        [/XMLHttpRequest|WebSocket/, 'a socket'],
        [/process\.env|import\.meta\.env/, 'the environment'],
        [/\b(apiKey|accessToken|bearer|clientSecret|password)\b/i, 'a credential name'],
        [/localStorage|sessionStorage|document\.cookie/, 'browser storage'],
      ] as Array<[RegExp, string]>) {
        expect(pattern.test(source), `${file} reaches ${what}`).toBe(false);
      }
    }
  });

  it('renders no executable or credential-shaped data into markup', () => {
    const markup = renderComposer('/loop all fix it', { flags: ENABLED });
    expect(/sk-[A-Za-z0-9]{8,}/.test(markup)).toBe(false);
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('javascript:');
  });
});

/* ------------------------------------------------------------- a11y */

describe('accessibility', () => {
  const markup = renderComposer('/loop all fix it', { flags: ENABLED });

  it('is a labelled dialog with a focusable heading', () => {
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-labelledby="rlc-heading"');
    expect(markup).toContain('id="rlc-heading"');
    expect(markup).toContain('tabindex="-1"');
  });

  it('describes itself by the confirmation boundary', () => {
    expect(markup).toContain('aria-describedby="rlc-boundary"');
    expect(markup).toContain('id="rlc-boundary"');
  });

  it('labels every section', () => {
    for (const id of ['rlc-target-heading', 'rlc-contract-heading']) {
      expect(markup).toContain(id);
    }
  });

  it('ties each disabled control to its rendered reason', () => {
    expect(markup).toContain('aria-describedby="rlc-why-start_loop"');
    expect(markup).toContain('id="rlc-why-start_loop"');
  });

  it('announces validation through a live region', () => {
    expect(markup).toContain('aria-live="polite"');
  });

  it('carries status by shape and word, not colour alone', () => {
    const source = readFileSync(join(__dirname, 'RelayLoopComposer.tsx'), 'utf8');
    expect(source).toContain('TONE_MARK');
    expect(source).toContain('aria-hidden="true"');
  });

  it('supports mobile, focus visibility and reduced motion in the stylesheet', () => {
    const css = readFileSync(join(__dirname, 'relay-loop.css'), 'utf8');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
    // Relay's palette, not a generic AI card.
    expect(css).toContain('var(--gold-400)');
    expect(css).toContain('var(--surface-solid)');
    expect(css).not.toContain('box-shadow: 0 0 20px');
  });

  it('returns focus to a heading on open rather than a control', () => {
    const source = readFileSync(join(__dirname, 'RelayLoopComposer.tsx'), 'utf8');
    expect(source).toContain('headingRef.current?.focus()');
  });

  it('closes on Escape', () => {
    const source = readFileSync(join(__dirname, 'RelayLoopComposer.tsx'), 'utf8');
    expect(source).toContain("event.key === 'Escape'");
  });
});

/* ----------------------------------------------- no side effects at all */

describe('the composer performs no work', () => {
  it('creates no mission, no run, and consumes no entitlement', () => {
    for (const file of ['loop-view.ts', 'RelayLoopComposer.tsx', 'RelayLoopOverview.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      for (const [pattern, what] of [
        [/buildMissionContract|createMission/, 'a mission'],
        [/redeemEntitlement|issueEntitlement/, 'an entitlement'],
        [/sealLoopRecord|createRelayLoopStore/, 'a persisted Loop record'],
      ] as Array<[RegExp, string]>) {
        expect(pattern.test(source), `${file} creates ${what}`).toBe(false);
      }
    }
  });

  it('rendering is pure — the same input twice yields the same markup', () => {
    expect(renderComposer('/loop all fix it')).toBe(renderComposer('/loop all fix it'));
  });
});
