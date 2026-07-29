import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RelayEntryHome, DEFAULT_CONNECTION_STATUSES, FIXTURE_GUIDE_MESSAGES, FIXTURE_RECENT_PROJECTS, SUGGESTED_QUESTIONS } from './entry-home';
import { RelayProjectSettings } from './project-settings';
import { AGENT_OPTIONS } from './project-settings';
import { RelayProjectWorkspace, WORKSPACE_FIXTURES } from './project-workspace';
import type { RelayProjectWorkspaceProps } from './project-workspace';

/**
 * ASSET SAFETY — the founder's mobile screenshot (external chatgpt.site
 * mock) showed broken-image placeholders. This repository's Relay frontend
 * must make that failure mode IMPOSSIBLE: the Relay Dog, header mark, and
 * dialogue identity are inline SVG/CSS — zero <img> elements, zero CSS
 * url() image fetches — so no route can ever render the browser's
 * broken-image icon, in dev or production, on any colorway.
 */

const noop = () => undefined;

function workspaceHtml(terminalOpen: boolean) {
  const props: RelayProjectWorkspaceProps = {
    ...WORKSPACE_FIXTURES.implementing,
    terminalOpen,
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
  };
  return renderToStaticMarkup(createElement(RelayProjectWorkspace, props));
}

const homeHtml = renderToStaticMarkup(
  createElement(RelayEntryHome, {
    productState: 'unconfigured',
    currentProject: null,
    recentProjects: FIXTURE_RECENT_PROJECTS,
    projectIdeaDraft: '',
    projectBriefDraft: null,
    selectedRoute: null,
    guideMessages: FIXTURE_GUIDE_MESSAGES,
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
  }),
);

const settingsHtml = renderToStaticMarkup(
  createElement(RelayProjectSettings, {
    brief: null,
    agentOptions: AGENT_OPTIONS,
    entitlement: 'pro',
    onSaveDraft: noop,
    onStartProject: noop,
    onConnectRepository: noop,
    onBack: noop,
  }),
);

describe('no broken-image placeholder is possible', () => {
  const screens: Array<[string, string]> = [
    ['entry home', homeHtml],
    ['project settings', settingsHtml],
    ['workspace', workspaceHtml(false)],
    ['live terminal', workspaceHtml(true)],
  ];

  it('no Relay screen renders an <img> element at all', () => {
    for (const [name, html] of screens) {
      expect(html, name).not.toContain('<img');
    }
  });

  it('the Relay Dog / header mark renders as inline SVG on every screen', () => {
    for (const [name, html] of screens) {
      expect(html, name).toContain('<svg');
    }
  });

  it('no Relay stylesheet fetches external images', () => {
    const UI = __dirname;
    for (const f of [
      'entry-home/relay-entry-home.css',
      'project-workspace/relay-project-workspace.css',
      'project-settings/relay-project-settings.css',
      'preview/relay-preview.css',
      'chrome/relay-chrome.css',
      'pixel-dog/pixel-dog.css',
      'relay-manual-theme.css',
    ]) {
      const css = readFileSync(join(UI, f), 'utf8');
      const urls = css.match(/url\(/g) ?? [];
      expect(urls.length, `${f} must not fetch image assets`).toBe(0);
    }
  });

  it('the production favicon referenced by relay.html exists in public/', () => {
    const root = join(__dirname, '..', '..', '..');
    const html = readFileSync(join(root, 'relay.html'), 'utf8');
    expect(html).toContain('href="/icon.svg"');
    expect(existsSync(join(root, 'public', 'icon.svg'))).toBe(true);
    // Exactly one viewport declaration, mobile-hardened.
    const viewports = html.match(/name="viewport"/g) ?? [];
    expect(viewports.length).toBe(1);
    expect(html).toContain('width=device-width, initial-scale=1.0, viewport-fit=cover');
  });
});
