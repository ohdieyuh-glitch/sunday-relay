import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RelayEntryHome } from './RelayEntryHome';
import {
  DEFAULT_CONNECTION_STATUSES,
  PRIMARY_PROJECT_ROUTES,
  SECONDARY_PROJECT_ROUTES,
  buildEvidenceRecommendation,
  buildResearchRecommendation,
  buildWorkforceRecommendation,
} from './recommendations';
import {
  buildProjectBriefDraft,
  computeHomeReadiness,
  createEmptyProjectBriefDraft,
  formatProjectBriefDraft,
} from './project-brief';
import { FIXTURE_GUIDE_MESSAGES, FIXTURE_RECENT_PROJECTS, SUGGESTED_QUESTIONS } from './fixtures';
import type { RelayEntryHomeProps } from './contracts';

/**
 * Relay Entry Home — focused render + logic tests (DOM-less SSR, repo
 * convention). The Entry Home is the in-product screen between Sunday
 * Alcatraz and Project Settings: no marketing site, no execution, no
 * provider call, truthful statuses only.
 */

const noop = () => undefined;

function baseProps(overrides: Partial<RelayEntryHomeProps> = {}): RelayEntryHomeProps {
  return {
    productState: 'unconfigured',
    currentProject: null,
    recentProjects: [],
    projectIdeaDraft: '',
    projectBriefDraft: null,
    selectedRoute: null,
    workforceRecommendation: buildWorkforceRecommendation(null),
    researchRecommendation: buildResearchRecommendation(null),
    evidenceRecommendation: buildEvidenceRecommendation(null),
    guideMessages: [],
    guideStatus: 'idle',
    suggestedQuestions: SUGGESTED_QUESTIONS,
    dogState: 'wandering',
    handoffNetworkState: 'standby',
    entitlement: 'pro',
    connectionStatuses: DEFAULT_CONNECTION_STATUSES,
    onReturnToSunday: noop,
    onSelectProjectRoute: noop,
    onUpdateProjectIdea: noop,
    onBuildProjectBrief: noop,
    onConnectExistingProject: noop,
    onAskRelay: noop,
    onSelectSuggestedQuestion: noop,
    onUpdateProjectBriefDraft: noop,
    onCopyProjectBrief: noop,
    onClearProjectBrief: noop,
    onContinueToProjectSettings: noop,
    onOpenRecentProject: noop,
    onOpenProjectSettings: noop,
    onOpenTerminal: noop,
    ...overrides,
  };
}

const render = (overrides: Partial<RelayEntryHomeProps> = {}) =>
  renderToStaticMarkup(createElement(RelayEntryHome, baseProps(overrides)));

/* ------------------------------------------------------ product identity */

describe('product identity', () => {
  it('shows Relay as the active product with a Sunday Alcatraz return control', () => {
    const html = render();
    expect(html).toContain('SUNDAY RELAY');
    expect(html).toContain('RELAY');
    expect(html).toContain('ALCATRAZ');
    expect(html).toContain('aria-current="page"');
  });

  it('shows RLY / HOME, unconfigured project state, and standby handoff network', () => {
    const html = render();
    expect(html).toContain('RLY');
    expect(html).toContain('HOME');
    expect(html).toContain('UNCONFIGURED');
    expect(html).toContain('HANDOFF NETWORK');
    expect(html).toContain('STANDBY');
  });

  it('contains no marketing navigation', () => {
    const html = render();
    for (const label of ['Pricing', 'Join Waitlist', 'Sign Up', 'About Us', 'Contact Us', 'Features</a>']) {
      expect(html).not.toContain(label);
    }
  });
});

/* --------------------------------------------------------- project start */

describe('project start', () => {
  it('renders the objective input, brief action, connect action, and settings action', () => {
    const html = render();
    expect(html).toContain('PROJECT OBJECTIVE');
    expect(html).toContain('Describe the product, feature, system, or result');
    expect(html).toContain('BUILD PROJECT BRIEF');
    expect(html).toContain('CONNECT EXISTING PROJECT');
    expect(html).toContain('OPEN PROJECT SETTINGS');
    expect(html).toContain('What are we building?');
    expect(html).toContain('RELAY HOME / ROUTE 000');
  });

  it('never claims ready-to-execute; readiness stops at Project Settings', () => {
    const draft = buildProjectBriefDraft('Build a dashboard', null);
    const html = render({ projectIdeaDraft: 'Build a dashboard', projectBriefDraft: draft });
    expect(html).not.toContain('READY TO EXECUTE');
    expect(html).toContain('READY FOR PROJECT SETTINGS');
    expect(html).toContain('Execution readiness is determined only after Project Settings');
  });

  it('readiness states are idea_required → project_brief_ready → ready_for_project_settings', () => {
    expect(computeHomeReadiness('', null)).toBe('idea_required');
    expect(computeHomeReadiness('an idea', null)).toBe('project_brief_ready');
    expect(computeHomeReadiness('an idea', buildProjectBriefDraft('an idea', null))).toBe(
      'ready_for_project_settings',
    );
  });

  it('shows the Relay Dog in a pre-mission state with the initial guidance message', () => {
    const html = render({ dogState: 'ready' });
    expect(html).toContain('Relay Dog: READY');
    expect(html).toContain('Tell me what you want to build');
  });
});

/* -------------------------------------------------------- project routes */

describe('project routes', () => {
  it('renders exactly six primary routes with numbers 01–06', () => {
    expect(PRIMARY_PROJECT_ROUTES).toHaveLength(6);
    const html = render();
    for (const route of PRIMARY_PROJECT_ROUTES) {
      expect(html).toContain(route.title);
      expect(html).toContain(route.routeNumber);
    }
    expect(html).toContain('BUILD A PRODUCT FEATURE');
    expect(html).toContain('FIX A BUG OR FAILING BUILD');
    expect(html).toContain('VIEW MORE PROJECT ROUTES');
  });

  it('offers the secondary routes behind view-more', () => {
    expect(SECONDARY_PROJECT_ROUTES.length).toBeGreaterThanOrEqual(10);
    expect(SECONDARY_PROJECT_ROUTES.every((r) => r.secondary)).toBe(true);
  });

  it('route selection prefills the objective and drives category-specific recommendations', () => {
    const bugfix = PRIMARY_PROJECT_ROUTES.find((r) => r.routeId === 'route-bugfix')!;
    expect(bugfix.objectiveTemplate).toContain('Fix a bug');
    expect(bugfix.category).toBe('bug_fix');

    const wf = buildWorkforceRecommendation(bugfix.category);
    expect(wf.rationale).toContain('bug fix');
    const research = buildResearchRecommendation(bugfix.category);
    expect(research.topics.length).toBeGreaterThan(0);
    const evidence = buildEvidenceRecommendation(bugfix.category);
    expect(evidence.requirements.join(' ')).toContain('Failing test written before the fix');
  });

  it('marks the selected route active without starting anything', () => {
    const html = render({ selectedRoute: PRIMARY_PROJECT_ROUTES[0] });
    expect(html).toContain('is-active');
    expect(html).not.toMatch(/mission (started|running)/i);
  });
});

/* ------------------------------------------------------------- ask relay */

describe('ask relay guide chat', () => {
  it('renders the chat with suggested Relay + project-development questions', () => {
    const html = render();
    expect(html).toContain('ASK RELAY');
    expect(html).toContain('How does Relay coordinate agents?');
    expect(html).toContain('What is the difference between Guided, Semi, and Autonomous?');
    expect(html).toContain('Help me describe my project.');
    expect(html).toContain('Ask how Relay works, explore a project idea');
  });

  it('states its guidance-only scope: no execution, no file edits, no missions', () => {
    const html = render();
    expect(html).toContain('never runs agents, edits files, or starts a mission');
  });

  it('renders fixture messages with a visible FIXTURE label', () => {
    const html = render({ guideMessages: FIXTURE_GUIDE_MESSAGES });
    expect(html).toContain('FIXTURE');
    expect(html).toContain('How does Relay coordinate agents?');
  });

  it('shows no fake terminal events inside the chat', () => {
    const html = render({ guideMessages: FIXTURE_GUIDE_MESSAGES });
    expect(html).not.toMatch(/\$\s+npm|stdout|stderr|exit code/i);
  });
});

/* ---------------------------------------------------------- project brief */

describe('project brief draft', () => {
  const draft = buildProjectBriefDraft(
    'Build a secure dashboard that monitors model usage',
    PRIMARY_PROJECT_ROUTES.find((r) => r.routeId === 'route-interface')!,
  );

  it('includes every required field group', () => {
    const html = render({ projectBriefDraft: draft });
    for (const label of [
      'WORKING TITLE', 'PROJECT TYPE', 'PROBLEM', 'INTENDED USERS', 'DESIRED RESULT',
      'CORE FUNCTIONALITY', 'TECHNICAL CONTEXT', 'CONSTRAINTS', 'RESEARCH TOPICS',
      'KNOWLEDGE GAPS', 'EVIDENCE REQUIREMENTS', 'COMPLETION CRITERIA', 'OPEN QUESTIONS',
      'UNKNOWNS REQUIRING INVESTIGATION', 'SUGGESTED ARCHITECT', 'SUGGESTED CODING AGENT',
      'SUGGESTED REVIEWER', 'SUGGESTED MODE',
    ]) {
      expect(html, `missing ${label}`).toContain(label);
    }
  });

  it('is explicitly not a Mission Contract', () => {
    const html = render({ projectBriefDraft: draft });
    expect(html).toContain('NOT A MISSION CONTRACT');
    expect(html).toContain('The Mission Contract is created later');
  });

  it('exposes copy, clear, and send-to-Project-Settings actions', () => {
    const html = render({ projectBriefDraft: draft });
    expect(html).toContain('SEND TO PROJECT SETTINGS');
    expect(html).toContain('COPY DRAFT');
    expect(html).toContain('CLEAR DRAFT');
  });

  it('builds a structured draft deterministically from objective + route', () => {
    expect(draft.category).toBe('interface');
    expect(draft.problem).toContain('secure dashboard');
    expect(draft.workingTitle.length).toBeGreaterThan(0);
    expect(draft.researchTopics).toContain('Accessibility standards');
    expect(draft.evidenceRequirements.join(' ')).toContain('320px');
    expect(draft.suggestedCodingAgent).toBe('Claude Code');
    const again = buildProjectBriefDraft(
      'Build a secure dashboard that monitors model usage',
      PRIMARY_PROJECT_ROUTES.find((r) => r.routeId === 'route-interface')!,
    );
    expect(again).toEqual(draft);
  });

  it('formats a complete plain-text export and labels it a draft', () => {
    const text = formatProjectBriefDraft(draft);
    expect(text).toContain('PROJECT BRIEF DRAFT');
    expect(text).toContain('Not a Mission Contract');
    expect(text).toContain('Suggested Relay mode');
    expect(text).toContain('Open questions');
  });

  it('empty draft factory covers all fields with safe defaults', () => {
    const empty = createEmptyProjectBriefDraft();
    expect(empty.category).toBeNull();
    expect(empty.suggestedMode).toBe('semi');
    expect(empty.securitySensitivity).toContain('confirm in Project Settings');
  });
});

/* --------------------------------------------------- calm composition */

describe('simplified composition (founder feedback)', () => {
  it('offers exactly the three primary entry paths without workforce/research panels', () => {
    const html = render();
    expect(html).toContain('BUILD PROJECT BRIEF');
    expect(html).toContain('CONNECT EXISTING PROJECT');
    expect(html).toContain('OPEN PROJECT SETTINGS');
    // Workforce and research configuration now live in Project Settings.
    expect(html).not.toContain('RECOMMENDED WORKFORCE');
    expect(html).not.toContain('PROJECT RESEARCH');
    expect(html).not.toContain('NEXT STEP');
  });

  it('Ask Relay is available but does not dominate — no draft panel before a draft exists', () => {
    const html = render();
    expect(html).toContain('ASK RELAY');
    expect(html).not.toContain('PROJECT BRIEF DRAFT');
  });

  it('recommendation logic stays deterministic for Project Settings to consume', () => {
    const wf = buildWorkforceRecommendation(null);
    const architect = wf.roles.find((r) => r.role === 'prompt_architect')!;
    expect(architect.responsibilities).toContain('Prompt generation');
    expect(architect.responsibilities).toContain('Project Brain development');
    expect(buildResearchRecommendation(null).status).toBe('not_configured');
    expect(buildResearchRecommendation('authentication').updateSensitivity).toBe('high');
    // Truthful statuses remain typed data, never fabricated connections.
    expect(DEFAULT_CONNECTION_STATUSES.codingAgent).toBe('connected');
    expect(DEFAULT_CONNECTION_STATUSES.reviewer).toBe('available');
  });
});

/* -------------------------------------------------------- recent projects */

describe('recent projects', () => {
  it('renders the empty state', () => {
    const html = render({ recentProjects: [] });
    expect(html).toContain('NO RELAY PROJECTS YET');
    expect(html).toContain('Start with an idea, connect an existing project');
  });

  it('renders populated fixture projects with safe state labels and research status', () => {
    const html = render({ recentProjects: FIXTURE_RECENT_PROJECTS });
    expect(html).toContain('Usage guardrail dashboard');
    expect(html).toContain('REVIEW REQUIRED');
    expect(html).toContain('VERIFIED COMPLETE');
    expect(html).toContain('DRAFT');
    expect(html).toContain('CONTINUE');
    expect(html).toContain('RESEARCH MONITORING');
    expect(html).toContain('RESEARCH NOT CONFIGURED');
    // No fake analytics/usage/earnings.
    expect(html).not.toMatch(/earnings|productivity score|usage chart/i);
  });
});

/* --------------------------------------------------------------- terminal */

describe('live terminal control', () => {
  it('exposes the terminal control without fabricating execution events', () => {
    const html = render();
    expect(html).toContain('OPEN LIVE TERMINAL');
    expect(html).not.toMatch(/tests? passed|review (started|complete)|implementation (started|complete)/i);
  });
});

/* ------------------------------------------------- responsive + a11y (css) */

describe('responsive + accessibility conventions (source-level)', () => {
  const css = readFileSync(join(process.cwd(), 'src/relay/ui/entry-home/relay-entry-home.css'), 'utf8');

  it('has mobile breakpoints, 320px handling, and no permanent sidebar', () => {
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (max-width: 360px)');
    expect(css).toContain('overflow-x: hidden');
    expect(css).not.toContain('position: sticky; left');
    expect(css).not.toMatch(/\.reh-sidebar/);
  });

  it('honors reduced motion and keeps visible focus styles', () => {
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
  });

  it('uses semantic labels and no color-only status (status squares + text)', () => {
    const html = render();
    expect(html).toContain('<label');
    expect(html).toContain('aria-label');
    // Statuses always carry text labels, not just colored dots.
    expect(html).toContain('STANDBY');
  });

  it('touch targets have min-height rules', () => {
    expect(css).toMatch(/min-height: (28|32|34|40)px/);
  });
});

/* ----------------------------------------------- security and boundaries */

describe('security and boundaries (source-level)', () => {
  const dir = join(process.cwd(), 'src/relay/ui/entry-home');
  const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));

  it('no credential fields, no provider imports, no Node imports in browser components', () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, `${f} must not use node built-ins`).not.toMatch(/from\s+['"]node:/);
      expect(src, `${f} must not import provider adapters`).not.toMatch(
        /from\s+['"].*(connectors|cli|fusion-engine|server)\//,
      );
      expect(src, `${f} must not import Relay Core mutation surfaces`).not.toMatch(
        /from\s+['"].*(\.\.\/)+(core|coordination|handoff|verification|recovery|ledger|storage)\//,
      );
      expect(src, `${f} must not render credential fields`).not.toMatch(
        /type=["']password["']|apiKey|api_key|secretValue|credentialValue|document\.cookie/,
      );
      expect(src, `${f} must not call providers`).not.toMatch(/api\.anthropic\.com|api\.openai\.com|fetch\(/);
    }
    expect(files.length).toBeGreaterThan(10);
  });

  it('renders no password/token/key inputs', () => {
    const html = render({ projectBriefDraft: buildProjectBriefDraft('x', null) });
    expect(html).not.toMatch(/type="password"|API key|api-key|access token/i);
  });
});
