import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RelayProjectSettings } from './RelayProjectSettings';
import { SettingsWorkforce } from './SettingsWorkforce';
import {
  SectionMemory,
  SectionMode,
  SectionPlatform,
  SectionProject,
  SectionProjectType,
  SectionResearch,
  SectionTechnology,
} from './SettingsSections';
import {
  SectionLimits,
  SectionNotifications,
  SectionPermissions,
  SectionScope,
  SectionVerification,
} from './SettingsPolicySections';
import { AGENT_OPTIONS, SELECTABLE_AVAILABILITY } from './options';
import { createDefaultSettingsDraft, suggestProjectNames } from './defaults';
import { reviewerIndependentFromCodingAgent, validateSettingsDraft } from './validation';
import { buildProjectBriefDraft } from '../entry-home/project-brief';
import type { RelayProjectSettingsProps } from './contracts';

/**
 * Project Settings — click-first configurator tests (DOM-less SSR + pure
 * logic). Normal configuration requires no typing; agent choices are
 * truthful; Gemini/Google never appear; START stays gated on blockers.
 */

const noop = () => undefined;
const brief = buildProjectBriefDraft('Build a usage dashboard for AI developers', null);
const draft = createDefaultSettingsDraft(brief);

function shell(overrides: Partial<RelayProjectSettingsProps> = {}) {
  return renderToStaticMarkup(
    createElement(RelayProjectSettings, {
      brief,
      agentOptions: AGENT_OPTIONS,
      entitlement: 'pro',
      onSaveDraft: noop,
      onStartProject: noop,
      onConnectRepository: noop,
      onBack: noop,
      ...overrides,
    }),
  );
}

const patchNoop = () => undefined;
const sectionHtml = {
  project: renderToStaticMarkup(
    createElement(SectionProject, { draft, brief, patch: patchNoop, onConnectRepository: noop }),
  ),
  type: renderToStaticMarkup(createElement(SectionProjectType, { draft, patch: patchNoop })),
  platform: renderToStaticMarkup(createElement(SectionPlatform, { draft, patch: patchNoop })),
  technology: renderToStaticMarkup(createElement(SectionTechnology, { draft, patch: patchNoop })),
  workforce: renderToStaticMarkup(
    createElement(SettingsWorkforce, {
      agentOptions: AGENT_OPTIONS,
      selection: draft.workforce,
      onChange: noop,
    }),
  ),
  mode: renderToStaticMarkup(createElement(SectionMode, { draft, patch: patchNoop })),
  research: renderToStaticMarkup(createElement(SectionResearch, { draft, patch: patchNoop })),
  memory: renderToStaticMarkup(createElement(SectionMemory, { draft, patch: patchNoop })),
  scope: renderToStaticMarkup(createElement(SectionScope, { draft, patch: patchNoop })),
  permissions: renderToStaticMarkup(createElement(SectionPermissions, { draft, patch: patchNoop })),
  verification: renderToStaticMarkup(createElement(SectionVerification, { draft, patch: patchNoop })),
  limits: renderToStaticMarkup(createElement(SectionLimits, { draft, patch: patchNoop })),
  notifications: renderToStaticMarkup(
    createElement(SectionNotifications, { draft, patch: patchNoop }),
  ),
};

/* -------------------------------------------------------------- shell */

describe('settings shell', () => {
  it('renders the numbered section rail 01–14 with the config identity', () => {
    const html = shell();
    expect(html).toContain('PROJECT SETTINGS');
    expect(html).toContain('RLY / CONFIG');
    for (const label of [
      '01', 'PROJECT', '02', 'PROJECT TYPE', '03', 'PLATFORM', '04', 'TECHNOLOGY',
      '05', 'WORKFORCE', '06', 'MODE', '07', 'RESEARCH', '08', 'PROJECT MEMORY',
      '09', 'SCOPE', '10', 'PERMISSIONS', '11', 'VERIFICATION', '12', 'LIMITS',
      '13', 'NOTIFICATIONS', '14', 'REVIEW AND START',
    ]) {
      expect(html, `missing ${label}`).toContain(label);
    }
    expect(html).toContain('CONFIGURATION'); // persistent compact summary
    expect(html).toContain('REVIEW SETUP');
  });
});

/* ------------------------------------------------------- typing policy */

describe('typing policy — click-first, no default freeform inputs', () => {
  it('no normal section renders a visible text input or textarea by default', () => {
    for (const [name, html] of Object.entries(sectionHtml)) {
      expect(html, `${name} must not render a textarea`).not.toContain('<textarea');
      expect(html, `${name} must not render a default text input`).not.toContain('type="text"');
    }
  });

  it('the settings shell (default section) exposes no visible freeform field', () => {
    const html = shell();
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('type="text"');
    expect(html).toContain('CUSTOM NAME'); // the reveal action exists instead
    expect(html).toContain('GENERATE MORE');
  });

  it('project names are selectable suggestions derived from the brief', () => {
    const names = suggestProjectNames(brief);
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names[0]).toBe(brief.workingTitle);
    // Deterministic.
    expect(suggestProjectNames(brief)).toEqual(names);
  });
});

/* ------------------------------------------------------------- agents */

describe('workforce options — truthful, clickable, no Gemini/Google', () => {
  it('gemini and google models appear nowhere', () => {
    const all = JSON.stringify(AGENT_OPTIONS) + Object.values(sectionHtml).join('') + shell();
    expect(all).not.toMatch(/gemini|google/i);
  });

  it('availability is truthful: only Claude Code is connected; Codex review ≠ Codex coding', () => {
    const byId = (id: string) => AGENT_OPTIONS.find((o) => o.id === id)!;
    const connected = AGENT_OPTIONS.filter((o) => o.availability === 'connected');
    expect(connected.map((o) => o.id)).toEqual(['coding-claude-code']);
    expect(byId('reviewer-codex').availability).toBe('available');
    expect(byId('coding-codex').availability).toBe('not_configured');
    for (const id of ['coding-hermes', 'coding-openclaw', 'coding-ophiuchus', 'reviewer-security', 'reviewer-specialist']) {
      expect(byId(id).availability, id).toBe('coming_later');
      expect(SELECTABLE_AVAILABILITY.has('coming_later')).toBe(false);
    }
  });

  it('each role renders selectable option rows with provider, status, description, strengths', () => {
    const html = sectionHtml.workforce;
    expect(html).toContain('CHOOSE PROMPT ARCHITECT');
    expect(html).toContain('CHOOSE CODING AGENT');
    expect(html).toContain('CHOOSE REVIEWER');
    expect(html).toContain('Sunday Alcatraz');
    expect(html).toContain('Manual Architect');
    expect(html).toContain('No Reviewer');
    expect(html).toContain('COMING LATER');
    expect(html).toContain('SIGN-IN REQUIRED');
    expect(html).toContain('API CONNECTION REQUIRED');
    expect(html).toContain('RELAY RECOMMENDS');
    expect(html).toContain('type="radio"');
    expect(html).toContain('REVIEWER REQUIRED');
    expect(html).toContain('INDEPENDENT FROM CODING AGENT');
    // Live workforce preview.
    expect(html).toContain('RESEARCH + MISSION + HANDOFF');
    expect(html).toContain('Verified Result');
  });

  it('the prompt architect is presented as a continuous role', () => {
    expect(sectionHtml.workforce).toContain(
      'Plans the mission, continuously researches the project, expands the Project Brain',
    );
  });
});

/* ---------------------------------------------------------- validation */

describe('validation + independence', () => {
  it('same-provider reviewer/coding pairs are flagged not independent', () => {
    const byId = (id: string) => AGENT_OPTIONS.find((o) => o.id === id)!;
    expect(reviewerIndependentFromCodingAgent(byId('reviewer-claude'), byId('coding-claude-code'))).toBe(false);
    expect(reviewerIndependentFromCodingAgent(byId('reviewer-codex'), byId('coding-claude-code'))).toBe(true);
    expect(reviewerIndependentFromCodingAgent(byId('reviewer-manual'), byId('coding-manual'))).toBe(false);
    expect(reviewerIndependentFromCodingAgent(byId('reviewer-none'), byId('coding-claude-code'))).toBe(true);
  });

  it('START stays blocked while required configuration is missing', () => {
    const empty = createDefaultSettingsDraft(null);
    // Brief-less default has no project source yet.
    const v = validateSettingsDraft(empty, AGENT_OPTIONS);
    expect(v.blockers.some((b) => b.id === 'source-missing')).toBe(true);

    const noArchitect = {
      ...draft,
      workforce: { ...draft.workforce, promptArchitectId: null },
    };
    expect(
      validateSettingsDraft(noArchitect, AGENT_OPTIONS).blockers.some((b) => b.id === 'architect-missing'),
    ).toBe(true);

    const reviewerPolicyNoReviewer = {
      ...draft,
      workforce: { ...draft.workforce, reviewerId: null, reviewerPolicy: 'every_mission' as const },
    };
    expect(
      validateSettingsDraft(reviewerPolicyNoReviewer, AGENT_OPTIONS).blockers.some(
        (b) => b.id === 'reviewer-missing',
      ),
    ).toBe(true);
  });

  it('a fully-defaulted brief-driven draft is startable and warns truthfully', () => {
    const v = validateSettingsDraft(draft, AGENT_OPTIONS);
    expect(v.blockers).toEqual([]);
    expect(v.reviewerIndependent).toBe(true);
  });

  it('unavailable agents can never be validated as startable', () => {
    const withComingLater = {
      ...draft,
      workforce: { ...draft.workforce, codingAgentId: 'coding-hermes' },
    };
    const v = validateSettingsDraft(withComingLater, AGENT_OPTIONS);
    expect(v.blockers.some((b) => b.id === 'coding-hermes-unavailable')).toBe(true);
  });

  it('"No Reviewer" cannot satisfy a reviewer-requiring policy (review finding)', () => {
    const noneWithPolicy = {
      ...draft,
      workforce: { ...draft.workforce, reviewerId: 'reviewer-none', reviewerPolicy: 'every_mission' as const },
    };
    const v = validateSettingsDraft(noneWithPolicy, AGENT_OPTIONS);
    expect(v.blockers.some((b) => b.id === 'reviewer-missing')).toBe(true);
  });

  it('reviewer policy NEVER releases the reviewer seat — no availability blocker (review finding)', () => {
    const neverWithUnavailable = {
      ...draft,
      workforce: {
        ...draft.workforce,
        reviewerId: 'reviewer-security', // coming_later
        reviewerPolicy: 'never' as const,
      },
    };
    const v = validateSettingsDraft(neverWithUnavailable, AGENT_OPTIONS);
    expect(v.blockers.some((b) => b.id === 'reviewer-security-unavailable')).toBe(false);
    // But the verification/review conflict is surfaced as a warning.
    expect(v.warnings.some((w) => w.id === 'review-policy-conflict')).toBe(true);
  });

  it('a whitespace-only custom name never satisfies the name blocker (review finding)', () => {
    const blank = { ...draft, projectName: '   ' };
    expect(
      validateSettingsDraft(blank, AGENT_OPTIONS).blockers.some((b) => b.id === 'name-missing'),
    ).toBe(true);
  });
});

/* -------------------------------------------------- option-based sections */

describe('option-based sections', () => {
  it('mode is a segmented selection with one visible description', () => {
    expect(sectionHtml.mode).toContain('GUIDED');
    expect(sectionHtml.mode).toContain('SEMI');
    expect(sectionHtml.mode).toContain('AUTONOMOUS');
    expect(sectionHtml.mode).toContain('rps-segmented');
    expect(sectionHtml.mode).toContain('PRESET: STANDARD');
  });

  it('research, memory, scope, verification use selectable options', () => {
    expect(sectionHtml.research).toContain('ON DEMAND');
    expect(sectionHtml.research).toContain('RESEARCH TOPICS');
    expect(sectionHtml.research).toContain('No research runs from this screen');
    expect(sectionHtml.memory).toContain('Relay Project Brain');
    expect(sectionHtml.memory).toContain('COMING LATER');
    expect(sectionHtml.scope).toContain('PROTECTED AREAS');
    expect(sectionHtml.scope).toContain('Claimed files only');
    expect(sectionHtml.verification).toContain('REQUIRED TESTS');
    expect(sectionHtml.verification).toContain('COMPLETION RULE');
    expect(sectionHtml.verification).toContain('STRICT');
  });

  it('permissions use segmented option rows and never offer ACCESS EVERYTHING', () => {
    expect(sectionHtml.permissions).toContain('DEPENDENCY INSTALLATION');
    expect(sectionHtml.permissions).toContain('DESTRUCTIVE ACTIONS');
    expect(sectionHtml.permissions).not.toContain('ACCESS EVERYTHING');
    // Truthful sessions: nothing is claimed approved without real connection data.
    expect(sectionHtml.permissions).toContain('AUTHENTICATED SESSIONS');
    expect(sectionHtml.permissions).toContain('NONE APPROVED YET');
    // Session handles only — never values.
    expect(sectionHtml.permissions).not.toMatch(/sk-[A-Za-z0-9]{8,}|Bearer\s|type="password"/);
  });

  it('limits use presets and steppers; notifications use switches', () => {
    expect(sectionHtml.limits).toContain('RUNTIME');
    expect(sectionHtml.limits).toContain('30 MIN');
    expect(sectionHtml.limits).toContain('CUSTOM');
    expect(sectionHtml.limits).toContain('rps-preset');
    expect(sectionHtml.notifications).toContain('role="switch"');
    expect(sectionHtml.notifications).toContain('No notification is actually delivered');
  });
});

/* -------------------------------------------------- security + boundaries */

describe('security and boundaries (source-level)', () => {
  const dir = join(process.cwd(), 'src/relay/ui/project-settings');
  const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));

  it('no Node imports, no adapters, no provider calls, no credential fields', () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, `${f} must not use node built-ins`).not.toMatch(/from\s+['"]node:/);
      expect(src, `${f} must not import adapters/CLI/server`).not.toMatch(
        /from\s+['"].*(connectors|cli|fusion-engine|server)\//,
      );
      expect(src, `${f} must not import Relay Core mutation surfaces`).not.toMatch(
        /from\s+['"].*(\.\.\/)+(core|coordination|handoff|verification|recovery|ledger|storage|workspace)\//,
      );
      expect(src, `${f} must not call providers`).not.toMatch(/api\.anthropic\.com|api\.openai\.com|fetch\(/);
      expect(src, `${f} must not render credential fields`).not.toMatch(
        /type=["']password["']|apiKey|api_key|secretValue|credentialValue|document\.cookie/,
      );
    }
    expect(files.length).toBeGreaterThan(8);
  });

  it('css has mobile flow, 320px handling, reduced motion, focus styles', () => {
    const css = readFileSync(join(dir, 'relay-project-settings.css'), 'utf8');
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain('@media (max-width: 360px)');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('overflow-x: hidden');
  });
});
