import type { GuideMessage, RecentProjectSummary } from './contracts';

/**
 * FIXTURE DATA — frontend preview only.
 *
 * Everything in this file is clearly-labeled sample content for the visual
 * preview. No message here came from a provider; no project here is
 * persisted anywhere. Fixture guide messages carry `fixture: true` and render
 * with a FIXTURE label. The real Ask Relay integration will later connect to
 * an approved Relay product-guidance service — never a provider call from the
 * browser.
 */

export const SUGGESTED_QUESTIONS: string[] = [
  'How does Relay coordinate agents?',
  'What is the difference between Guided, Semi, and Autonomous?',
  'Do I need an independent Reviewer?',
  'Which Coding Agent should I use?',
  'What information should I add to Project Settings?',
  'Help me describe my project.',
];

/** Fixture conversation used by the preview shell only. */
export const FIXTURE_GUIDE_MESSAGES: GuideMessage[] = [
  {
    messageId: 'fx-guide-1',
    author: 'developer',
    text: 'How does Relay coordinate agents?',
    at: '2026-07-22 09:14 UTC',
    fixture: true,
  },
  {
    messageId: 'fx-guide-2',
    author: 'relay',
    text:
      'Relay passes bounded work between a Prompt Architect, a Coding Agent, and an independent Reviewer. ' +
      'Each handoff carries the context the next role needs, and Relay verifies evidence before anything is called complete.',
    at: '2026-07-22 09:14 UTC',
    fixture: true,
  },
];

/** Deterministic fixture reply for preview interactions (labeled FIXTURE). */
export function fixtureGuideReply(question: string, sequence: number): GuideMessage {
  const q = question.toLowerCase();
  let text =
    'I can explain how Relay works, help you shape this idea, and draft your beginning project brief. ' +
    'When the brief looks right, send it to Project Settings.';
  if (q.includes('guided') || q.includes('semi') || q.includes('autonomous')) {
    text =
      'Guided pauses for your approval at each handoff. Semi continues through routine steps and stops at boundaries. ' +
      'Autonomous continues furthest but still cannot cross permissions you set in Project Settings.';
  } else if (q.includes('reviewer')) {
    text =
      'An independent Reviewer examines the Coding Agent’s work and can require repairs before completion. ' +
      'Relay recommends one for security-sensitive or production-impacting projects.';
  } else if (q.includes('coding agent')) {
    text =
      'Claude Code is connected through a real local adapter. Other agents appear only with truthful statuses — ' +
      'Relay never labels an agent connected without a real adapter.';
  } else if (q.includes('project settings')) {
    text =
      'Project Settings collects your project identity, scope, protected areas, workforce, mode, permissions, ' +
      'limits, and what Relay must prove before completion. Your brief prefills it.';
  } else if (q.includes('describe my project') || q.includes('help me')) {
    text =
      'Tell me the product, who it serves, and what result you want. I will structure that into a Project Brief Draft ' +
      'you can edit and send to Project Settings.';
  } else if (q.includes('coordinate')) {
    text =
      'Relay coordinates through structured handoffs: the Prompt Architect plans and prepares context, the Coding Agent ' +
      'implements within bounds, the Reviewer independently examines, and Relay verifies evidence at each gate.';
  }
  return {
    messageId: `fx-reply-${sequence}`,
    author: 'relay',
    text,
    at: '2026-07-22 09:15 UTC',
    fixture: true,
  };
}

/** Fixture recent projects (populated state) — preview only, never persisted. */
export const FIXTURE_RECENT_PROJECTS: RecentProjectSummary[] = [
  {
    projectId: 'fx-proj-guardrails',
    name: 'Usage guardrail dashboard',
    projectType: 'Product feature',
    lastActivity: '2026-07-21 18:40 UTC',
    mode: 'semi',
    state: 'review_required',
    workforce: {
      promptArchitect: 'Sunday Alcatraz',
      codingAgent: 'Claude Code',
      reviewer: 'Codex',
    },
    researchStatus: 'monitoring',
  },
  {
    projectId: 'fx-proj-ingest',
    name: 'Billing event ingest service',
    projectType: 'API / backend service',
    lastActivity: '2026-07-19 22:05 UTC',
    mode: 'guided',
    state: 'verified_complete',
    workforce: {
      promptArchitect: 'Sunday Alcatraz',
      codingAgent: 'Claude Code',
      reviewer: 'Codex',
    },
    researchStatus: 'not_configured',
  },
  {
    projectId: 'fx-proj-onboarding',
    name: 'Onboarding flow refresh',
    projectType: 'Web interface',
    lastActivity: '2026-07-18 15:12 UTC',
    mode: 'semi',
    state: 'draft',
    workforce: {
      promptArchitect: 'Sunday Alcatraz',
      codingAgent: 'Claude Code',
      reviewer: null,
    },
    researchStatus: 'not_configured',
  },
];
