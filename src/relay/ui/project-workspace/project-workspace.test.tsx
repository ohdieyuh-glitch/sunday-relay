import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES, WORKSPACE_FIXTURE_KEYS, type WorkspaceFixtureKey } from './fixtures';
import type { RelayProjectWorkspaceProps } from './contracts';

/**
 * Active Project Workspace — focused render tests (DOM-less SSR, repo
 * convention). The workspace is the browser application projection of a
 * running Relay project: safe normalized events only, truthful states,
 * claims separated from evidence, completion gated, no CLI surface.
 */

const noop = () => undefined;

function props(
  key: WorkspaceFixtureKey,
  overrides: Partial<RelayProjectWorkspaceProps> = {},
): RelayProjectWorkspaceProps {
  return {
    ...WORKSPACE_FIXTURES[key],
    terminalOpen: false,
    onSendProjectMessage: noop,
    onApproveDecision: noop,
    onRejectDecision: noop,
    onOpenTerminal: noop,
    onCloseTerminal: noop,
    onOpenProjectSettings: noop,
    onOpenManualTask: noop,
    onApproveManualTask: noop,
    onRejectManualTask: noop,
    onRequestResearch: noop,
    onOpenFinding: noop,
    onOpenRepair: noop,
    onReturnHome: noop,
    ...overrides,
  };
}

const render = (key: WorkspaceFixtureKey, overrides: Partial<RelayProjectWorkspaceProps> = {}) =>
  renderToStaticMarkup(createElement(RelayProjectWorkspace, props(key, overrides)));

/* --------------------------------------------------------- product flow */

describe('product flow + application surface', () => {
  it('renders the active workspace with project identity — a browser app, not a CLI', () => {
    const html = render('implementing');
    expect(html).toContain('SUNDAY RELAY');
    expect(html).toContain('Sunday Relay Frontend');
    expect(html).toContain('RLY / 001');
    expect(html).toContain('RELAY HOME'); // return control
    expect(html).toContain('PROJECT SETTINGS');
    // The RELAY CONSOLE is the dominant main surface (screenshot-inspired).
    expect(html).toContain('RELAY CONSOLE');
    expect(html).toContain('Safe project activity and verified coordination');
    expect(html).toContain('rpw-console-feed');
    // Timeline rows, not chat bubbles, and the bracketed footer statement.
    expect(html).toContain('rpw-tev-icon');
    expect(html).toContain('PASS THE WORK.');
    expect(html).toContain('KEEP THE CONTEXT.');
    expect(html).toContain('HANDOFF NETWORK');
    // No CLI shell prompt anywhere.
    expect(html).not.toMatch(/\$\s|(^|\W)bash|#!\/|~\/\w+ \$/);
    // No marketing navigation.
    for (const label of ['Pricing', 'Join Waitlist', 'Sign Up']) {
      expect(html).not.toContain(label);
    }
  });

  it('every fixture state renders without throwing', () => {
    for (const key of WORKSPACE_FIXTURE_KEYS) {
      expect(render(key).length, key).toBeGreaterThan(1000);
    }
  });
});

/* ------------------------------------------------------------- workforce */

describe('workforce strip', () => {
  it('no longer carries the workforce strip (founder direction)', () => {
    const html = render('implementing');
    // The top band was removed from the workspace. The strip component and its
    // own tests still exist; the WORKSPACE simply does not render it.
    expect(html).not.toContain('rpw-strip-square');
    expect(html).not.toContain('rpw-strip-cell');
    expect(html).not.toContain('rpw-operating-rows');
    // The Reviewer is still named where it is actually acted on.
    expect(html).toContain('Codex');
  });
});

/* ---------------------------------------------------------- conversation */

describe('project conversation', () => {
  it('is project-specific, distinct from the terminal, with no provider call', () => {
    const html = render('implementing');
    expect(html).toContain('PROJECT CONVERSATION');
    expect(html).toContain('Ask Relay about this project…');
    expect(html).toContain('not the Live Terminal');
  });

  it('renders approval requests with approve/reject controls', () => {
    const html = render('waiting_for_user');
    expect(html).toContain('APPROVE');
    expect(html).toContain('REJECT');
    expect(html).toContain('Approve connecting the production deployment target?');
  });
});

/* -------------------------------------------------------------- terminal */

describe('live terminal', () => {
  it('opens Terminal Mode with role panels, safe normalized events, and truth labels', () => {
    const html = render('verifying', { terminalOpen: true });
    expect(html).toContain('LIVE TERMINAL');
    expect(html).toContain('Close Live Terminal');
    // Founder Terminal Mode structure: per-role panels + mission status row.
    expect(html).toContain('PROMPT ARCHITECT');
    expect(html).toContain('CODING AGENT');
    expect(html).toContain('RELAY SYSTEM');
    expect(html).toContain('MISSION IN PROGRESS');
    expect(html).toContain('CONTEXT ID: rly_001_20260722_115712');
    expect(html).toContain('RUN typecheck'); // safe summarized op, never a raw command
    // Truthfulness survives the restyle.
    expect(html).toContain('CLAIM — PENDING VERIFICATION');
    expect(html).toContain('VERIFIED EVIDENCE');
    expect(html).toContain('WORKSPACE INSPECTION');
    expect(html).toContain('Two claimed files changed. No protected files changed.');
  });

  it('labels reviewer verdicts and manual tasks distinctly', () => {
    const revision = render('revision_required', { terminalOpen: true });
    expect(revision).toContain('INDEPENDENT REVIEW');
    const waiting = render('waiting_for_user', { terminalOpen: true });
    expect(waiting).toContain('WAITING FOR USER');
  });

  it('shows the empty state without fabricating events', () => {
    const html = render('implementing', { terminalOpen: true, terminalEvents: [] });
    expect(html).toContain('No mission is running.');
    expect(html).toContain('after Project Settings is confirmed');
  });

  it('is closed when terminalOpen is false', () => {
    const html = render('implementing');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('rpw-terminal-feed');
  });

  it('never exposes raw output, shell prompts, streams, session IDs, reasoning, or credentials', () => {
    for (const key of WORKSPACE_FIXTURE_KEYS) {
      const html = render(key, { terminalOpen: true });
      expect(html, key).not.toMatch(
        /stdout|stderr|\$ npm|\$ node|ses_[a-z0-9]{6,}|session[-_ ]?id|chain of thought|system prompt|sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|Bearer\s|password|api[-_ ]?key/i,
      );
    }
  });

  it('supports the full-screen (mobile) presentation', () => {
    const html = render('implementing', { terminalOpen: true, terminalFullScreen: true });
    expect(html).toContain('rpw-terminal--full');
  });
});

/* ---------------------------------------------------------- phase rail */

describe('phase rail', () => {
  it('is no longer rendered in the status rail — the workforce strip PHASE cell carries the phase', () => {
    const html = render('revision_required');
    expect(html).not.toContain('rpw-phase-rail');
    expect(html).not.toContain('Expand Phase panel');
    // The live phase still reaches the user through the workforce strip.
    expect(html).toContain('rpw-strip-cell--phase');
  });
});

/* ----------------------------------------------------------- manual task */

describe('manual tasks', () => {
  it('presents need, reason, action, afterward, and safe-stop state — not an error', () => {
    const html = render('waiting_for_user');
    expect(html).toContain('MANUAL TASK / MT-1');
    expect(html).toContain('RELAY NEEDS');
    expect(html).toContain('WHY IT STOPPED');
    expect(html).toContain('YOUR ACTION');
    expect(html).toContain('AFTERWARD');
    expect(html).toContain('STOPPED SAFELY');
    expect(html).toContain('REVIEW REQUEST');
    expect(html).toContain('KEEP BLOCKED');
    expect(html).not.toMatch(/error|failure/i);
  });
});

/* -------------------------------------------------------------- reviewer */

describe('reviewer states, findings, repairs', () => {
  it('shows changes-required with validated finding evidence and its repair link', () => {
    const html = render('revision_required');
    expect(html).toContain('CHANGES REQUIRED');
    expect(html).toContain('FINDING / F-1');
    expect(html).toContain('HIGH');
    expect(html).toContain('CRITERION');
    expect(html).toContain('EVIDENCE');
    expect(html).toContain('REQUIRED ACTION');
    expect(html).toContain('REPAIR / R-1 → F-1');
    expect(html).toContain('Reviewer reasoning is never exposed');
  });

  it('shows reviewing (read-only) and approved states', () => {
    expect(render('reviewing')).toContain('read-only access to the held output');
    expect(render('verified_complete')).toContain('APPROVED');
  });
});

/* ------------------------------------------------------------ completion */

describe('completion', () => {
  it('VERIFIED COMPLETE renders only for the approved completion fixture, with evidence', () => {
    const html = render('verified_complete');
    expect(html).toContain('MISSION VERDICT');
    expect(html).toContain('VERIFIED COMPLETE');
    expect(html).toContain('Acceptance criteria passed');
    expect(html).toContain('Protected paths unchanged');
    expect(html).toContain('Source repository protected');
  });

  it('an agent finishing never shows the verdict — non-complete fixtures carry no verdict banner', () => {
    for (const key of WORKSPACE_FIXTURE_KEYS.filter((k) => k !== 'verified_complete')) {
      expect(render(key), key).not.toContain('MISSION VERDICT');
    }
  });

  it('footer claims ALL SYSTEMS GO only while genuinely progressing (review finding)', () => {
    expect(render('implementing')).toContain('ALL SYSTEMS GO');
    expect(render('verified_complete')).not.toContain('ALL SYSTEMS GO');
    expect(render('waiting_for_user')).not.toContain('ALL SYSTEMS GO');
    expect(render('revision_required')).not.toContain('ALL SYSTEMS GO');
  });

  it('a contradicted verdict is HELD, never displayed as complete', () => {
    const html = render('revision_required', {
      completionState: { verdict: 'verified_complete', evidence: [] },
    });
    expect(html).toContain('COMPLETION HELD');
    expect(html).not.toContain('MISSION VERDICT — <strong>VERIFIED COMPLETE');
  });
});

/* ------------------------------------------- prompt architect + research */

describe('prompt architect research + project brain', () => {
  it('represents continuous research with truthful statuses', () => {
    const html = render('researching');
    expect(html).toContain('PROJECT RESEARCH');
    expect(html).toContain('NEW KNOWLEDGE AWAITING APPROVAL');
    expect(html).toContain('RESEARCHING'); // architect strip status
    expect(html).toContain('Authentication library guidance may be outdated');
  });

  it('shows the Project Brain with pending approvals', () => {
    const html = render('researching');
    expect(html).toContain('PROJECT BRAIN');
    expect(html).toContain('PENDING APPROVALS');
  });

  it('research not_configured state renders truthfully', () => {
    const html = render('implementing', {
      researchState: { status: 'not_configured', approvedTopics: [], note: null },
    });
    expect(html).toContain('NOT CONFIGURED');
  });

  it('no fabricated live research — fixture events are labeled', () => {
    const html = render('researching', { terminalOpen: true });
    expect(html).toContain('FIXTURE');
  });
});

/* ------------------------------------------------------------- relay dog */

describe('relay dog', () => {
  const dogFor = (key: WorkspaceFixtureKey) => {
    const html = render(key);
    const m = html.match(/aria-label="Relay Dog: ([^"]+)"/);
    return m ? m[1] : null;
  };

  it('reflects the prop-driven state for every fixture', () => {
    expect(dogFor('implementing')).toBe('IMPLEMENTING');
    expect(dogFor('verifying')).toBe('VERIFYING');
    expect(dogFor('reviewing')).toBe('REVIEWING');
    expect(dogFor('revision_required')).toBe('CARRYING HANDOFF');
    expect(dogFor('waiting_for_user')).toBe('WAITING FOR USER');
    expect(dogFor('researching')).toBe('RESEARCHING');
  });

  it('COMPLETE appears only after verified completion', () => {
    expect(dogFor('verified_complete')).toBe('COMPLETE');
    for (const key of WORKSPACE_FIXTURE_KEYS.filter((k) => k !== 'verified_complete')) {
      expect(dogFor(key), key).not.toBe('COMPLETE');
    }
  });
});

/* -------------------------------------------------- verification summary */

describe('verification summary', () => {
  it('separates Relay evidence from agent claims', () => {
    const html = render('verifying');
    expect(html).toContain('RELAY VERIFICATION');
    expect(html).toContain('agent claims are labeled separately');
    expect(html).toContain('Typecheck');
  });

  it('renders truthfully when nothing has run', () => {
    const html = render('implementing', {
      verificationSummary: { checks: [], headline: null },
    });
    expect(html).toContain('No verification has run yet.');
  });
});

/* --------------------------------------------- responsive + a11y (source) */

describe('responsive + accessibility conventions (source-level)', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/relay/ui/project-workspace/relay-project-workspace.css'),
    'utf8',
  );

  it('mobile breakpoints, full-screen mobile terminal, 320px, no permanent sidebar', () => {
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (max-width: 360px)');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('.rpw-terminal--full');
    expect(css).not.toMatch(/\.rpw-sidebar/);
  });

  it('reduced motion + visible focus', () => {
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
  });

  it('semantic structure: dialog terminal, live regions, labels', () => {
    const html = render('verifying', { terminalOpen: true });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<label');
  });
});

/* ---------------------------------------------- security and boundaries */

describe('security and boundaries (source-level)', () => {
  const dir = join(process.cwd(), 'src/relay/ui/project-workspace');
  const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));

  it('no Node imports, no provider/adapters, no Relay Core mutation, no credential fields', () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, `${f} must not use node built-ins`).not.toMatch(/from\s+['"]node:/);
      expect(src, `${f} must not import adapters/CLI/server`).not.toMatch(
        /from\s+['"].*(connectors|cli|fusion-engine|server)\//,
      );
      expect(src, `${f} must not import Relay Core mutation surfaces`).not.toMatch(
        /from\s+['"].*(\.\.\/)+(core|coordination|handoff|verification|recovery|ledger|storage|workspace)\//,
      );
      expect(src, `${f} must not spawn processes`).not.toMatch(/child_process|execSync|spawn\(/);
      expect(src, `${f} must not render credential fields`).not.toMatch(
        /type=["']password["']|apiKey|api_key|secretValue|credentialValue|document\.cookie/,
      );
      expect(src, `${f} must not call providers`).not.toMatch(/api\.anthropic\.com|api\.openai\.com|fetch\(/);
    }
    expect(files.length).toBeGreaterThan(15);
  });

  it('renders no password/token/key inputs in any fixture', () => {
    for (const key of WORKSPACE_FIXTURE_KEYS) {
      const html = render(key, { terminalOpen: true });
      expect(html, key).not.toMatch(/type="password"|access token|api key/i);
    }
  });
});
