/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RelayEntryHome } from './RelayEntryHome';
import {
  DEFAULT_CONNECTION_STATUSES,
  PRIMARY_PROJECT_ROUTES,
  buildEvidenceRecommendation,
  buildResearchRecommendation,
  buildWorkforceRecommendation,
} from './recommendations';
import { buildProjectBriefDraft } from './project-brief';
import { FIXTURE_RECENT_PROJECTS, SUGGESTED_QUESTIONS } from './fixtures';
import type { RelayEntryHomeProps } from './contracts';

/**
 * Entry Home interaction tests (jsdom): callbacks fire with the right
 * payloads; typing and selecting never starts execution; the Project
 * Settings handoff receives the structured draft.
 */

afterEach(cleanup);

function makeProps(overrides: Partial<RelayEntryHomeProps> = {}) {
  const props: RelayEntryHomeProps = {
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
    dogState: 'ready',
    handoffNetworkState: 'standby',
    entitlement: 'pro',
    connectionStatuses: DEFAULT_CONNECTION_STATUSES,
    onReturnToSunday: vi.fn(),
    onSelectProjectRoute: vi.fn(),
    onUpdateProjectIdea: vi.fn(),
    onBuildProjectBrief: vi.fn(),
    onConnectExistingProject: vi.fn(),
    onAskRelay: vi.fn(),
    onSelectSuggestedQuestion: vi.fn(),
    onUpdateProjectBriefDraft: vi.fn(),
    onCopyProjectBrief: vi.fn(),
    onClearProjectBrief: vi.fn(),
    onContinueToProjectSettings: vi.fn(),
    onOpenRecentProject: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onOpenTerminal: vi.fn(),
    ...overrides,
  };
  return props;
}

describe('entry home interactions', () => {
  it('typing the objective updates the idea without starting execution', () => {
    const props = makeProps();
    render(createElement(RelayEntryHome, props));
    const input = screen.getByLabelText('PROJECT OBJECTIVE');
    fireEvent.change(input, { target: { value: 'Build a usage dashboard' } });
    expect(props.onUpdateProjectIdea).toHaveBeenCalledWith('Build a usage dashboard');
    expect(props.onBuildProjectBrief).not.toHaveBeenCalled();
    expect(props.onContinueToProjectSettings).not.toHaveBeenCalled();
  });

  it('BUILD PROJECT BRIEF passes the objective; disabled while empty', () => {
    const empty = makeProps();
    render(createElement(RelayEntryHome, empty));
    const btn = screen.getByRole('button', { name: 'BUILD PROJECT BRIEF' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    cleanup();

    const props = makeProps({ projectIdeaDraft: 'Build a usage dashboard' });
    render(createElement(RelayEntryHome, props));
    fireEvent.click(screen.getByRole('button', { name: 'BUILD PROJECT BRIEF' }));
    expect(props.onBuildProjectBrief).toHaveBeenCalledWith('Build a usage dashboard');
  });

  it('selecting a route reports the full route definition and never launches anything', () => {
    const props = makeProps();
    render(createElement(RelayEntryHome, props));
    fireEvent.click(screen.getByRole('button', { name: /BUILD A PRODUCT FEATURE/ }));
    expect(props.onSelectProjectRoute).toHaveBeenCalledWith(PRIMARY_PROJECT_ROUTES[0]);
    expect(props.onContinueToProjectSettings).not.toHaveBeenCalled();
  });

  it('view-more reveals secondary routes', () => {
    const props = makeProps();
    render(createElement(RelayEntryHome, props));
    expect(screen.queryByText('HARDEN AUTHENTICATION')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'VIEW MORE PROJECT ROUTES' }));
    expect(screen.getByText('HARDEN AUTHENTICATION')).toBeTruthy();
  });

  it('ask relay send + suggested question callbacks fire', () => {
    const props = makeProps();
    render(createElement(RelayEntryHome, props));
    const input = screen.getByLabelText('Ask Relay');
    fireEvent.change(input, { target: { value: 'How does Relay coordinate agents?' } });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));
    expect(props.onAskRelay).toHaveBeenCalledWith('How does Relay coordinate agents?');

    fireEvent.click(screen.getByRole('button', { name: 'Do I need an independent Reviewer?' }));
    expect(props.onSelectSuggestedQuestion).toHaveBeenCalledWith(
      'Do I need an independent Reviewer?',
    );
  });

  it('draft editing, copy, clear, and settings handoff carry the structured draft', () => {
    const draft = buildProjectBriefDraft('Build a usage dashboard', PRIMARY_PROJECT_ROUTES[0]);
    const props = makeProps({ projectBriefDraft: draft, projectIdeaDraft: 'Build a usage dashboard' });
    render(createElement(RelayEntryHome, props));

    fireEvent.change(screen.getByLabelText('WORKING TITLE'), { target: { value: 'Usage HQ' } });
    expect(props.onUpdateProjectBriefDraft).toHaveBeenCalledWith({ workingTitle: 'Usage HQ' });

    fireEvent.change(screen.getByLabelText('CONSTRAINTS'), {
      target: { value: 'No PII\nStay in scope' },
    });
    expect(props.onUpdateProjectBriefDraft).toHaveBeenCalledWith({
      constraints: ['No PII', 'Stay in scope'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'COPY DRAFT' }));
    expect(props.onCopyProjectBrief).toHaveBeenCalled();
    const copied = vi.mocked(props.onCopyProjectBrief).mock.calls[0][0];
    expect(copied).toContain('PROJECT BRIEF DRAFT');

    fireEvent.click(screen.getByRole('button', { name: 'CLEAR DRAFT' }));
    expect(props.onClearProjectBrief).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'SEND TO PROJECT SETTINGS' }));
    expect(props.onContinueToProjectSettings).toHaveBeenCalledWith(draft);
  });

  it('recent project continue, project settings, terminal, and return-to-Sunday callbacks fire', () => {
    const props = makeProps({ recentProjects: FIXTURE_RECENT_PROJECTS });
    render(createElement(RelayEntryHome, props));

    fireEvent.click(screen.getAllByRole('button', { name: 'CONTINUE' })[0]);
    expect(props.onOpenRecentProject).toHaveBeenCalledWith(FIXTURE_RECENT_PROJECTS[0].projectId);

    fireEvent.click(screen.getByRole('button', { name: 'PROJECT SETTINGS' }));
    expect(props.onOpenProjectSettings).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Live Terminal' }));
    expect(props.onOpenTerminal).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ALCATRAZ' }));
    expect(props.onReturnToSunday).toHaveBeenCalled();
  });

  it('connect existing project fires its integration callback only', () => {
    const props = makeProps();
    render(createElement(RelayEntryHome, props));
    fireEvent.click(screen.getByRole('button', { name: 'CONNECT EXISTING PROJECT' }));
    expect(props.onConnectExistingProject).toHaveBeenCalled();
    expect(props.onBuildProjectBrief).not.toHaveBeenCalled();
  });
});
