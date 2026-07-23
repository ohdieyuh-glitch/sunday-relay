// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RelayHomePage } from './RelayHomePage';
import { DEFAULT_CONNECTION_STATUSES, EMPTY_PROJECT_DRAFT } from './fixtures';
import type { RelayHomePageProps, RelayProjectDraft } from './contracts';
import { applyRoute, projectReadiness, recommendationFor } from './recommendations';
import { PROJECT_ROUTES } from './fixtures';

afterEach(cleanup);

function props(overrides: Partial<RelayHomePageProps> = {}): RelayHomePageProps {
  return {
    projectDraft: { ...EMPTY_PROJECT_DRAFT }, recentProjects: [], entitlement: 'pro',
    connectionStatuses: DEFAULT_CONNECTION_STATUSES, dogState: 'wandering', terminalState: 'idle',
    onCreateProject: vi.fn(), onConnectProject: vi.fn(), onOpenProject: vi.fn(),
    onOpenProjectSettings: vi.fn(), onOpenTerminal: vi.fn(), onUpdateProjectDraft: vi.fn(),
    onApplyRecommendation: vi.fn(), ...overrides,
  };
}

describe('Relay application home', () => {
  it('shows the authenticated no-project home controls without marketing navigation', () => {
    render(<RelayHomePage {...props()} />);
    expect(screen.getByText('SUNDAY')).toBeTruthy();
    expect(screen.getByText('NO PROJECT SELECTED')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'MAIN PROJECT OBJECTIVE' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /START PROJECT/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /CONNECT/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /PROJECT SETTINGS/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /OPEN LIVE TERMINAL/i }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Relay Dog: READY, wandering/i)).toBeTruthy();
    expect(screen.getByText('No Relay projects yet.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Features|Pricing|Waitlist|Sign Up|Learn More/);
    expect(document.querySelector('aside')).toBeNull();
  }, 15_000);

  it('renders exactly six routes; selection prefills but never starts execution', () => {
    const p = props();
    render(<RelayHomePage {...p} />);
    expect(document.querySelectorAll('.rh-route-list > button')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: /HARDEN SECURITY/ }));
    expect((screen.getByRole('textbox', { name: 'MAIN PROJECT OBJECTIVE' }) as HTMLTextAreaElement).value).toBe(PROJECT_ROUTES[5].objective);
    expect(p.onCreateProject).not.toHaveBeenCalled();
    expect(p.onUpdateProjectDraft).toHaveBeenCalledWith(expect.objectContaining({
      category: 'Security', reviewer: 'Security Reviewer', evidenceRequired: expect.stringContaining('security reviewer'),
    }));
    expect(screen.getByText('Security Reviewer', { selector: 'dd' })).toBeTruthy();
  });

  it('blocks start until objective, workforce, mode, and boundaries are complete', () => {
    const complete = { ...EMPTY_PROJECT_DRAFT, objective: 'Build the project', boundariesConfirmed: true };
    const p = props({ projectDraft: complete });
    render(<RelayHomePage {...p} />);
    const start = screen.getAllByRole('button', { name: /START PROJECT/ })[0];
    expect((start as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(start);
    expect(p.onCreateProject).toHaveBeenCalledWith(complete);
  });

  it('opens the idle terminal through the integration callback without fabricating events', () => {
    const p = props();
    render(<RelayHomePage {...p} />);
    expect(screen.getByText('No mission is running. Relay activity will appear here after the project starts.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /OPEN LIVE TERMINAL/i })[0]);
    expect(p.onOpenTerminal).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toMatch(/mission started|agent dispatched|execution event/i);
  });
});

describe('readiness and deterministic recommendations', () => {
  const ready = { ...EMPTY_PROJECT_DRAFT, objective: 'x', boundariesConfirmed: true };
  it.each([
    ['objective', { ...ready, objective: '' }, 'Objective'],
    ['workforce', { ...ready, codingAgent: '' }, 'Workforce'],
    ['mode', { ...ready, mode: '' as const }, 'Mode'],
    ['boundaries', { ...ready, boundariesConfirmed: false }, 'Boundaries'],
  ])('missing %s blocks readiness', (_name, draft, missing) => {
    expect(projectReadiness(draft as RelayProjectDraft)).toMatchObject({ ready: false, missing: [missing] });
  });
  it('complete configuration is ready', () => expect(projectReadiness(ready).ready).toBe(true));
  it('routes deterministically update objective, evidence, and policy setup', () => {
    const security = applyRoute(EMPTY_PROJECT_DRAFT, PROJECT_ROUTES[5]);
    expect(recommendationFor(security)).toMatchObject({ reviewer: 'Security Reviewer', mode: 'guided' });
    expect(security.evidenceRequired).toContain('security reviewer');
  });
});

describe('Project Settings', () => {
  it('contains every setup section, truthful availability, safe inputs, save, cancel, and validation', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<RelayHomePage {...props({ onSaveProjectSettings: onSave, onCancelProjectSettings: onCancel })} />);
    fireEvent.click(screen.getAllByRole('button', { name: /OPEN PROJECT SETTINGS/i })[0]);
    for (const title of ['PROJECT IDENTITY', 'PROJECT SCOPE', 'PROMPT ARCHITECT', 'CODING AGENT', 'REVIEWER', 'RELAY MODE',
      'ACCESS AND PERMISSIONS', 'PROJECT MEMORY', 'COMPLETION REQUIREMENTS', 'LIMITS', 'NOTIFICATIONS']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.getByText('VALIDATION SUMMARY')).toBeTruthy();
    expect(screen.getByLabelText('Project description')).toBeTruthy();
    expect(screen.getByText('sign in required')).toBeTruthy();
    expect(screen.getAllByText('coming later').length).toBeGreaterThan(0);
    expect(screen.getByText(/Notification delivery infrastructure is not active/)).toBeTruthy();
    const unsafeNames = ['password', 'api key', 'token', 'cookie', 'secret value', 'access everything'];
    const inputs = [...document.querySelectorAll('input')];
    for (const unsafe of unsafeNames) expect(inputs.some((input) => `${input.name} ${input.placeholder}`.toLowerCase().includes(unsafe))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'SAVE PROJECT SETTINGS' }));
    expect(onSave).toHaveBeenCalledOnce();
  }, 15_000);

  it('calls cancel without saving', () => {
    const onSave = vi.fn(); const onCancel = vi.fn();
    render(<RelayHomePage {...props({ onSaveProjectSettings: onSave, onCancelProjectSettings: onCancel })} />);
    fireEvent.click(screen.getAllByRole('button', { name: /OPEN PROJECT SETTINGS/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  }, 15_000);
});
