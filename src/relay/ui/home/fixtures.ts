import type { AgentConnectionStatuses, ProjectRoute, RelayProjectDraft } from './contracts';

export const DEFAULT_COMPLETION_RULE =
  'Relay may mark the mission VERIFIED COMPLETE only when every blocking criterion, required test, and required review passes.';

export const EMPTY_PROJECT_DRAFT: RelayProjectDraft = {
  name: '', description: '', objective: '', kind: 'new', category: '', source: '',
  filesInScope: '', filesOutOfScope: '', protectedAreas: '',
  productionPresent: false, deploymentAllowed: false, destructiveActionsAllowed: false,
  dependencyInstallationAllowed: false, architect: 'Sunday Alcatraz',
  codingAgent: 'Claude Code', reviewer: 'Codex Independent Reviewer',
  reviewerRequired: true, mode: 'guided', approvedTools: '', approvedServices: '',
  approvedSessions: '', runtimeLimitMinutes: 30, spendingLimitUsd: 5,
  consentExpiration: 'End of mission', memory: ['Repository context', 'Sunday Alcatraz context'],
  requiredTests: true, requiredBuild: true, requiredIndependentReview: true,
  requiredSecurityReview: false, requiredManualApproval: true,
  evidenceRequired: 'Passing tests, successful build, and independent review approval.',
  completionRule: DEFAULT_COMPLETION_RULE, maximumAgentCalls: 20,
  maximumReviewCycles: 2, maximumRepairCycles: 2, stopOnNoProgress: true,
  notifications: ['needs-user', 'review-blocker', 'stopped-safely', 'verified-complete'],
  boundariesConfirmed: false,
};

export const DEFAULT_CONNECTION_STATUSES: AgentConnectionStatuses = {
  architect: { 'Sunday Alcatraz': 'available', 'Manual Architect': 'available', 'External Architect': 'not-configured', None: 'available' },
  coding: { 'Claude Code': 'sign-in-required', Codex: 'available', Hermes: 'coming-later', OpenClaw: 'not-configured', Ophiuchus: 'coming-later', 'Manual worker': 'available' },
  reviewer: { 'No Reviewer': 'available', 'Independent Reviewer': 'available', 'Codex Independent Reviewer': 'available', 'Security Reviewer': 'pro', 'Specialist Reviewer': 'not-configured' },
};

export const PROJECT_ROUTES: ProjectRoute[] = [
  { id: 'feature', number: '01', title: 'BUILD A PRODUCT FEATURE', description: 'Plan, implement, test, review, and complete a focused feature.', objective: 'Build a focused product feature with implementation, tests, and independent review.', category: 'Product feature', evidence: 'Passing focused tests, build evidence, and independent review approval.' },
  { id: 'screen', number: '02', title: 'BUILD A WEBSITE OR APP SCREEN', description: 'Turn a product idea or visual direction into a working responsive interface.', objective: 'Build a responsive application screen from the provided product direction.', category: 'Interface', evidence: 'Responsive checks at desktop and 320px, accessibility review, tests, and build evidence.' },
  { id: 'review', number: '03', title: 'REVIEW AN EXISTING CODEBASE', description: 'Inspect architecture, incomplete work, technical risks, and test coverage.', objective: 'Review an existing codebase for architecture, incomplete work, technical risks, and test coverage.', category: 'Codebase review', evidence: 'Source-cited findings, risk severity, test-gap inventory, and no unverified completion claims.', reviewer: 'Codex Independent Reviewer' },
  { id: 'bug', number: '04', title: 'FIX A BUG OR FAILING BUILD', description: 'Diagnose the issue, assign the repair, verify it, and independently review the result.', objective: 'Diagnose and fix the failing behavior, verify the repair, and independently review the result.', category: 'Bug repair', evidence: 'Reproduction proof, regression test, passing relevant checks, and independent review.' },
  { id: 'api', number: '05', title: 'BUILD AN API', description: 'Define the contract, implement endpoints, test behavior, and review the result.', objective: 'Define and build an API with tested contracts, failure handling, and independent review.', category: 'API', evidence: 'Contract tests, authorization checks, failure-path tests, build evidence, and review approval.' },
  { id: 'security', number: '06', title: 'HARDEN SECURITY', description: 'Review authentication, permissions, rate limits, secrets, spending controls, and abuse cases.', objective: 'Harden security across authentication, permissions, rate limits, secrets, spending controls, and abuse cases.', category: 'Security', evidence: 'Threat findings, security tests, secret scan, permission review, and security reviewer approval.', reviewer: 'Security Reviewer' },
];
