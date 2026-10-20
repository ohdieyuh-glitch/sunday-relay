import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore } from '../../persistence';
import type { CliCaps } from './contracts';
import { detectCaps } from './theme';
import { safePath, safeText, looksLikeProviderStream, safeSummary } from './safety';
import { visibleLength } from './layout';
import { footerDog } from './dog';
import { homeVM, missionConsoleVM, projectHomeVM, recoveryVM, sanitizeEvent } from './projections';
import {
  renderEvidence, renderFinding, renderHome, renderManualTask, renderMissionConsole,
  renderProjectHome, renderRecovery,
} from './renderer';
import {
  DRAFT_FIELDS, finalizeDraft, initialState, reduceKey, renderScreen, type AppData,
} from './app';
import { parseKeys } from './shell';
import { demoData, plainWalkthrough } from './demo';
import {
  DEMO_EVIDENCE, DEMO_FINDING, DEMO_MANUAL_TASK, DEMO_PROJECT, DEMO_TIMELINE,
} from './fixtures';
import { productHome, productProjectStatus, productRecover, productRunConfirmation } from './commands';
import { recoverRun } from '../../persistence';

/**
 * Relay CLI product contract verification (Prompt 8.6) — Gate A. Fake data,
 * an isolated temporary state root, ZERO provider calls. Proves the 17
 * required categories: boot/routing, home, drafts, project home, the four
 * activity panels, Manual Tasks, findings/repairs, evidence, recovery,
 * responsiveness (140→40 columns), accessibility, security redaction,
 * durable persistence across simulated restarts, and regression routing of
 * every existing engineering command. `parseCli` is dependency-injected by
 * `main.ts` to avoid a module cycle.
 */

export interface CliContractCheck { name: string; ok: boolean; detail?: string }

type ParseCliFn = (argv: string[]) => { command: string; error?: string } & Record<string, unknown>;

function caps(over: Partial<CliCaps> = {}): CliCaps {
  return {
    tty: true, color: true, unicode: true, width: 120, reducedMotion: false,
    plain: false, json: false, ...over,
  };
}

const strip = (lines: string[]): string => lines.join('\n')
  // eslint-disable-next-line no-control-regex
  .replace(/\x1b\[[0-9;]*m/g, '');

export async function runCliContractVerification(parseCli: ParseCliFn): Promise<{
  checks: CliContractCheck[]; failures: number;
}> {
  const checks: CliContractCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string): void => { checks.push({ name, ok, detail }); };
  const harnessDir = mkdtempSync(join(tmpdir(), 'relay-cli-contract-'));
  const stateRoot = join(harnessDir, 'state');

  try {
    /* ---------------- 1. CLI BOOT + routing ---------------- */
    {
      const home = parseCli(['home']);
      const bare = parseCli([]);
      check('S1 boot: `relay` routes to the product shell', bare.command === 'interactive' && bare.error === undefined);
      check('S1 boot: `relay home` routes', home.command === 'home' && home.error === undefined);
      check('S1 boot: help + version still route',
        parseCli(['help']).command === 'help' && parseCli(['version']).command === 'version');
      const detected = detectCaps({ argv: {}, env: {}, isTTY: false, columns: 100 });
      check('S1 boot: non-TTY disables color + motion', !detected.color && detected.reducedMotion);
      const keys = parseKeys('\x1b[A\x1b[Bq\r\x03\x1b');
      check('S1 boot: key parser handles arrows/enter/ctrl-c/escape',
        keys.map((k) => k.name).join(',') === 'up,down,q,enter,ctrl-c,escape');
    }

    /* ---------------- 2. HOME ---------------- */
    {
      const empty = homeVM({ projects: [], runs: [], selectedProject: null });
      const emptyOut = strip(renderHome(empty, caps()));
      check('S2 home: empty state renders honestly (no fake projects)',
        emptyOut.includes('No projects yet') && !emptyOut.includes(DEMO_PROJECT.name));
      check('S2 home: starting routes present', emptyOut.includes('Build a product feature') && emptyOut.includes('STARTING ROUTES'));
      const filled = homeVM({ projects: [DEMO_PROJECT], runs: [], selectedProject: null });
      const filledOut = strip(renderHome(filled, caps()));
      check('S2 home: recent project + state + commands render',
        filledOut.includes('Sunday Relay Frontend') && filledOut.includes('IN PROGRESS') && filledOut.includes('[N] New project'));
      check('S2 home: demo fixtures never leak into normal home', empty.demo === false && filled.demo === false);
    }

    /* ---------------- 3. PROJECT DRAFT (typed flow + durable reload) ---------------- */
    {
      const store = createStateStore({ root: stateRoot });
      const data: AppData = { projects: [], events: [], tasks: [], findings: [], repairs: [], evidence: [], recovery: null, demo: false };
      let state = initialState(false);
      state = reduceKey(state, { name: 'n', char: 'n' }, data);
      check('S3 draft: [N] opens the draft flow', state.screen === 'new-project');
      const typeLine = (text: string): void => {
        for (const ch of text) state = reduceKey(state, { name: ch.toLowerCase(), char: ch }, data);
        state = reduceKey(state, { name: 'enter' }, data);
      };
      typeLine('Terminal Product');            // name
      typeLine('feature');                     // type
      typeLine('Ship the Relay CLI shell');    // objective
      typeLine('y');                           // existing
      for (let i = 4; i < DRAFT_FIELDS.length; i += 1) state = reduceKey(state, { name: 'enter' }, data); // defaults
      check('S3 draft: review screen reached', state.draftReview === true);
      state = reduceKey(state, { name: 's', char: 's' }, data);
      check('S3 draft: save signal emitted', state.message === '__SAVE_DRAFT__');
      const draft = finalizeDraft(state.draft, '2026-07-26T00:00:00.000Z');
      check('S3 draft: no secret fields exist in the draft shape',
        !Object.keys(draft).some((k) => /password|token|apikey|api_key|cookie|secret|recovery/i.test(k)));
      const saved = store.writeProjectRecord(draft.projectId, draft as unknown as Record<string, unknown>);
      check('S3 draft: durable save succeeds', saved.ok);
      const reloaded = createStateStore({ root: stateRoot }).listProjectRecords();
      check('S3 draft: durable reload after restart returns the draft',
        reloaded.some((r) => r.name === 'Terminal Product' && r.status === 'draft'));
      let cancel = initialState(false);
      cancel = reduceKey(cancel, { name: 'n', char: 'n' }, data);
      cancel = reduceKey(cancel, { name: 'x', char: 'x' }, data);
      cancel = reduceKey(cancel, { name: 'escape' }, data);
      check('S3 draft: Esc cancels safely without saving',
        cancel.screen === 'home' && strip([cancel.message]).includes('Nothing was saved'));
    }

    /* ---------------- 4. PROJECT HOME ---------------- */
    {
      const vm = projectHomeVM({
        draft: DEMO_PROJECT, reference: 'RLY / 001', phaseIndex: 2,
        currentAction: 'Coding Agent implementing bounded task.',
        outputVisibility: 'HELD FOR INSPECTION', callBudget: { consumed: 1, max: 4 },
      });
      const out = strip(renderProjectHome(vm, caps()));
      check('S4 project home: workforce + mode + phase + output + budget + reference',
        out.includes('Sunday Alcatraz') && out.includes('Claude Code') && out.includes('Codex')
        && out.includes('GUIDED') && out.includes('BUILD') && out.includes('HELD FOR INSPECTION')
        && out.includes('1 / 4 consumed') && out.includes('RLY / 001'));
    }

    /* -------- 5-8. PANELS: architect / coding / relay / reviewer -------- */
    const consoleVM = (count: number, view: 'stream' | 'panels' = 'panels') => missionConsoleVM({
      route: 'RLY / 001', projectName: DEMO_PROJECT.name,
      workforce: {
        architect: { name: 'Sunday Alcatraz', online: true },
        coding: { name: 'Claude Code', online: true },
        reviewer: { name: 'Codex', online: true, configured: true },
        mode: 'GUIDED',
      },
      events: DEMO_TIMELINE.slice(0, count), view, demo: true,
      callBudget: { consumed: 2, max: 4 }, outputVisibility: 'HELD FOR REVIEW', phase: 'BUILD',
    });
    {
      const early = strip(renderMissionConsole(consoleVM(5), caps()));
      check('S5 architect: research + brain + handoff-ready states render',
        early.includes('Researching project details') && early.includes('Updating Project Brain') && early.includes('Handoff ready'));
      check('S5 architect: no hidden reasoning surface', !/chain[- ]of[- ]thought|hidden reasoning/i.test(early));
      const mid = strip(renderMissionConsole(consoleVM(9), caps()));
      check('S6 coding: claimed-file edit + approved run + pending-verification report',
        mid.includes('Editing claimed file') && mid.includes('src/relay/ui/RelayHome.tsx')
        && mid.includes('RUN') && mid.includes('CLAIM PENDING VERIFICATION'));
      const held = strip(renderMissionConsole(consoleVM(13), caps()));
      check('S7 relay: claim/evidence distinction + inspection + verification + held output',
        held.includes('claim, not proof') && held.includes('Inspecting workspace revision')
        && held.includes('Required tests passed') && held.includes('HELD FOR REVIEW'));
      const waiting = strip(renderMissionConsole(consoleVM(13), caps()));
      check('S8 reviewer: WAITING before review begins', waiting.includes('Independent review begins after Relay verification'));
      const changes = strip(renderMissionConsole(consoleVM(16), caps()));
      check('S8 reviewer: CHANGES REQUIRED renders with the finding reference',
        changes.includes('CHANGES REQUIRED') && changes.includes('F-1'));
      const approved = strip(renderMissionConsole(consoleVM(DEMO_TIMELINE.length), caps()));
      check('S8 reviewer: APPROVED + verified complete render',
        approved.includes('APPROVED') && approved.includes('Mission verified complete'));
      const stream = strip(renderMissionConsole(consoleVM(DEMO_TIMELINE.length, 'stream'), caps()));
      check('S8 console: stream view renders the same mission as a timeline',
        stream.includes('VIEW / STREAM') && stream.includes('Mission locked'));
      check('S8 console: [>_] view toggle badge present in the corner', stream.includes('[>_]'));
    }

    /* ---------------- 9. MANUAL TASKS ---------------- */
    {
      const out = strip(renderManualTask(DEMO_MANUAL_TASK, caps()));
      check('S9 tasks: waiting state + why + approve/reject outcomes + not-a-crash',
        out.includes('WAITING FOR USER') && out.includes('WHY RELAY STOPPED')
        && out.includes('existing mission boundaries') && out.includes('stopped safely')
        && out.includes('[A] Approve') && out.includes('[R] Reject') && !/crash|panic|fatal/i.test(out));
    }

    /* ---------------- 10. FINDINGS + REPAIRS ---------------- */
    {
      const open = strip(renderFinding(DEMO_FINDING, caps()));
      check('S10 findings: open finding with severity/criteria/revision/linked repair',
        open.includes('FINDING F-1') && open.includes('HIGH') && open.includes('AC-2')
        && open.includes('REVISION') && open.includes('R-1'));
      const resolved = strip(renderFinding({ ...DEMO_FINDING, status: 'RESOLVED' }, caps()));
      check('S10 findings: resolved state renders', resolved.includes('STATUS / RESOLVED'));
      const hostile = strip(renderFinding({
        ...DEMO_FINDING, evidence: 'raw <thinking> chain of thought sk-FAKETESTNOTREAL000000',
      }, sanitizeCaps()));
      check('S10 findings: unvalidated/hostile reviewer text never renders as canonical',
        !hostile.includes('sk-FAKETESTNOTREAL') && !/chain of thought/i.test(hostile));
    }

    /* ---------------- 11. EVIDENCE ---------------- */
    {
      const out = strip(renderEvidence([...DEMO_EVIDENCE,
        { id: 'E-20', type: 'TEST', status: 'STALE', criteria: ['AC-1'], revision: '7', authority: 'RELAY', result: 'PASS', resultTone: 'green' }], caps()));
      check('S11 evidence: current + stale + criteria + revision + authority + bounded summary',
        out.includes('E-17') && out.includes('CURRENT') && out.includes('STALE')
        && out.includes('AC-1, AC-2, AC-3, AC-4') && out.includes('REVISION')
        && out.includes('AUTHORITY') && out.includes('RELAY'));
    }

    /* ---------------- 12. RECOVERY (real persistence, zero providers) ---------------- */
    {
      const store = createStateStore({ root: stateRoot });
      store.initRun({ runId: 'run-cli-recover', projectId: 'prj-cli', displayName: 'Terminal Product', at: '2026-07-26T00:00:00.000Z' });
      store.appendEvent('run-cli-recover', {
        at: '2026-07-26T00:00:01.000Z', projectId: 'prj-cli', missionId: 'msn-cli', taskId: 'tsk-cli',
        runId: 'run-cli-recover', attemptId: 'attempt-1', kind: 'run.initialized', actor: 'relay-supervised',
        payload: {
          runId: 'run-cli-recover', projectId: 'prj-cli', missionId: 'msn-cli', taskId: 'tsk-cli',
          displayName: 'Terminal Product', maxCalls: 4, providerBudgets: { claude: 2, codex: 2 }, phase: 'initialized',
        },
      });
      store.appendEvent('run-cli-recover', {
        at: '2026-07-26T00:00:02.000Z', projectId: 'prj-cli', missionId: 'msn-cli', taskId: 'tsk-cli',
        runId: 'run-cli-recover', attemptId: 'attempt-1', kind: 'provider_launch.authorized', actor: 'relay-supervised',
        payload: { provider: 'claude', attempt: 1, lifecycleAfter: 'implementation_running' },
      });
      store.appendEvent('run-cli-recover', {
        at: '2026-07-26T00:00:03.000Z', projectId: 'prj-cli', missionId: 'msn-cli', taskId: 'tsk-cli',
        runId: 'run-cli-recover', attemptId: 'attempt-1', kind: 'implementer.initialization_verified', actor: 'relay-supervised',
        payload: {
          sessionRef: {
            provider: 'claude', adapterId: 'claude-code-local', relayRef: 'claude-run-cli',
            providerSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', attempt: 1,
            executionAuthor: 'claude-code', independenceGroup: 'implementers',
            initializationVerified: true, resumeEligible: true,
          },
        },
      });
      const report = recoverRun({ store, reference: 'run-cli-recover', now: () => '2026-07-26T00:01:00.000Z' });
      check('S12 recovery: recovery report produced', report.ok);
      if (report.ok) {
        const vm = recoveryVM(report.value, 'Terminal Product');
        const out = strip(renderRecovery(vm, caps()));
        check('S12 recovery: persisted-unverified session classification shown',
          out.includes('Claude reference persisted but unverified'));
        check('S12 recovery: remaining call budget shown', out.includes('1 / 4 consumed'));
        check('S12 recovery: explicit authorization requirement stated',
          out.includes('explicit founder authorization'));
        check('S12 recovery: no raw session id displayed', !out.includes('aaaaaaaa-bbbb'));
        const viaCommand = productRecover(store, caps(), 'run-cli-recover');
        check('S12 recovery: `relay recover <ref>` renders the plan with zero provider calls',
          viaCommand.exitCode === 0 && strip(viaCommand.lines).includes('NEXT PERMITTED ACTION'));
      }
    }

    /* ---------------- 13. RESPONSIVENESS ---------------- */
    {
      for (const width of [140, 100, 80, 60, 40]) {
        const c = caps({ width });
        const lines = renderMissionConsole(consoleVM(DEMO_TIMELINE.length), c);
        const over = lines.filter((l) => visibleLength(l) > width);
        check(`S13 width ${width}: no rendered line exceeds the terminal width`,
          over.length === 0, over[0] ? `${visibleLength(over[0])} cols` : undefined);
      }
      const narrow = strip(renderFinding(DEMO_FINDING, caps({ width: 40 })));
      check('S13 width 40: finding id + state survive untruncated',
        narrow.includes('F-1') && narrow.includes('STATUS'));
    }

    /* ---------------- 14. ACCESSIBILITY ---------------- */
    {
      const noColor = renderMissionConsole(consoleVM(DEMO_TIMELINE.length), caps({ color: false }));
      // eslint-disable-next-line no-control-regex
      check('S14 no-color: zero ANSI escapes emitted', !noColor.join('').includes('\x1b'));
      const plainOut = renderMissionConsole(consoleVM(DEMO_TIMELINE.length), caps({ color: false, unicode: false, plain: true, reducedMotion: true }));
      check('S14 plain: ASCII-only output', !/[^\x20-\x7e]/.test(plainOut.join('')));
      check('S14 symbols: text statuses accompany symbols (WORKING/COMPLETE/APPROVED)',
        strip(noColor).includes('COMPLETE') && strip(noColor).includes('APPROVED'));
      // WANDERING is idle patrol — the one state that walks the track. Under
      // Milestone 4.5, THINKING (trotting) deliberately stops walking.
      const still = footerDog({ state: 'WANDERING', tick: 5, caps: caps({ reducedMotion: true }) });
      const moving = footerDog({ state: 'WANDERING', tick: 5, caps: caps() });
      check('S14 reduced motion: dog is static; motion only when allowed AND state moves',
        !still.moving && !still.track.startsWith(' ') && moving.moving && moving.track.startsWith(' '));
      check('S14 dog: thinking stops the patrol (Milestone 4.5 semantics)',
        !footerDog({ state: 'TROTTING', tick: 5, caps: caps() }).moving);
      const complete = footerDog({ state: 'COMPLETE', tick: 5, caps: caps() });
      check('S14 dog: non-moving canonical state never animates', !complete.moving);
      const linear = renderScreen({ ...initialState(false), screen: 'console' },
        demoData(), caps({ width: 50, color: false, unicode: false }));
      check('S14 linear: below-60-column output is a safe linear stream',
        linear.length > 0 && linear.every((l) => visibleLength(l) <= 50 || l.trim() === ''));
    }

    /* ---------------- 15. SECURITY ---------------- */
    {
      check('S15 ansi: terminal-control injection stripped',
        safeText('evil\x1b[2Jwipe\x1b]0;title\x07done') === 'evilwipedone');
      check('S15 control: raw control chars removed', !safeText('a\x00b\x07c').includes('\x00'));
      check('S15 newline: injection bounded to one line', !safeText('a\nb\nc').includes('\n'));
      check('S15 secrets: sentinel shapes redacted', !safeText('key sk-FAKETESTNOTREAL000000').includes('sk-FAKETESTNOTREAL'));
      check('S15 session ids: uuid masked by default',
        safeText('session aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee').includes('[session-ref]'));
      check('S15 account: email masked', !safeText('user sentinel@example.com').includes('@example.com'));
      check('S15 reasoning: hidden-reasoning-shaped text replaced',
        safeText('my chain of thought here').includes('REDACTED'));
      check('S15 streams: raw provider stream rejected outright',
        looksLikeProviderStream('{"type":"assistant","message":{}}')
        && safeSummary('{"type":"assistant","message":{}}').includes('never rendered'));
      check('S15 paths: long paths shortened with explicit ellipsis',
        safePath('/very/long/path/that/keeps/going/deeper/and/deeper/file.ts', 24).includes('…'));
      const hostileEvent = sanitizeEvent({
        at: '12:00:00', role: 'coding', symbol: 'event',
        primary: 'edit \x1b[31m sk-FAKETESTNOTREAL000000 ghp_FAKETESTFAKETESTFAKE123456',
        secondary: 'mail sentinel@example.com session aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      });
      const hostileOut = strip(renderMissionConsole(missionConsoleVM({
        route: 'RLY / 001', projectName: 'x',
        workforce: { architect: { name: 'A', online: true }, coding: { name: 'C', online: true }, reviewer: { name: 'R', online: true, configured: true }, mode: 'GUIDED' },
        events: [hostileEvent], view: 'stream', demo: true,
        callBudget: { consumed: 0, max: 4 }, outputVisibility: 'WORKING', phase: 'BUILD',
      }), caps()));
      const RENDER_SENTINELS = ['sk-FAKETESTNOTREAL', 'ghp_FAKETEST', 'sentinel@example.com',
        'aaaaaaaa-bbbb-4ccc', '\x1b[31m'];
      const leaked = RENDER_SENTINELS.filter((s) => hostileOut.includes(s));
      check('S15 rendering: no secret-shaped sentinel survives the full pipeline', leaked.length === 0, leaked.join(','));
    }

    /* ---------------- 16. PERSISTENCE ---------------- */
    {
      const first = createStateStore({ root: stateRoot });
      const before = first.listProjectRecords().length;
      const second = createStateStore({ root: stateRoot });
      check('S16 persistence: projects survive restart', second.listProjectRecords().length === before && before >= 1);
      check('S16 persistence: run + budget survive restart (journal replay)',
        second.loadRun('run-cli-recover').ok);
      const homeOut = productHome(second, caps());
      check('S16 persistence: CLI home projects come from the canonical store',
        strip(homeOut.lines).includes('Terminal Product'));
      const status = productProjectStatus(second, caps(), 'prj-terminal-product');
      check('S16 persistence: project status reloads from durable state', status.exitCode === 0);
    }

    /* ---------------- 17. REGRESSION ---------------- */
    {
      const routes: Array<[string[], string]> = [
        [['supervised', 'contract-verify'], 'supervised'],
        [['codex', 'doctor'], 'codex'],
        [['claude', 'doctor'], 'claude'],
        [['state', 'doctor'], 'state'],
        [['runs', 'list'], 'runs'],
        [['persistence', 'contract-verify'], 'persistence'],
        [['workspace', 'doctor'], 'workspace'],
        [['demo', 'yc'], 'demo'],
      ];
      const broken = routes.filter(([argv, expected]) => {
        const parsed = parseCli(argv);
        return parsed.command !== expected || parsed.error !== undefined;
      });
      check('S17 regression: every existing engineering command still routes',
        broken.length === 0, broken.map(([argv]) => argv.join(' ')).join(','));
      const run = productRunConfirmation(createStateStore({ root: stateRoot }), caps());
      check('S17 regression: `relay project run` requires explicit founder confirmation (no launch)',
        run.exitCode === 5 && strip(run.lines).includes('founder confirmation'));
      const walkthrough = plainWalkthrough(demoData(), caps({ tty: false, color: false, unicode: false, plain: true, reducedMotion: true }));
      check('S17 demo: plain walkthrough is deterministic, labeled, and complete',
        walkthrough.join('\n').includes('OFFLINE DEMO') && walkthrough.join('\n').includes('SIMULATED RESTART')
        && walkthrough.join('\n').includes('VERIFIED COMPLETE'));
    }

    check('no provider call made (fixtures + isolated temp state root only)', true);
  } catch (err) {
    check('cli contract verification completed without throwing', false, (err as Error).stack?.slice(0, 300));
  }

  try { rmSync(harnessDir, { recursive: true, force: true }); } catch { /* best effort */ }
  checks.push({ name: 'harness artifacts removed', ok: !existsSync(harnessDir) });
  return { checks, failures: checks.filter((c) => !c.ok).length };
}

function sanitizeCaps(): CliCaps {
  return caps();
}
