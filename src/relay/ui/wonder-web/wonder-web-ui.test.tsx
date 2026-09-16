/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createWonderWebCreation,
  projectWonderWebSurface,
  type WonderWebCreationDraft,
} from '../../mission/wonder-web';
import { RelayWonderWeb } from './RelayWonderWeb';

/**
 * The surface is rendered from the projection and asserted against the
 * founder's reference: the wordmark, MY VIEW first, peer tabs with distinct
 * dots, the lock-prefixed address, the terminal prompt, and — the part that
 * matters most — that a viewer without control is never handed a frame, a
 * cursor or a live control.
 */

afterEach(cleanup);

const AT = '2026-09-15T12:00:00.000Z';
const OWNER = 'ghu-1001';
const PEER = 'ghu-2002';

function creation(): WonderWebCreationDraft {
  const made = createWonderWebCreation({
    creationId: 'cre_1',
    ownerUserId: OWNER,
    name: 'Test',
    creationType: 'website',
    runtimeType: 'static_bundle',
    sourceFiles: [],
    provenance: 'live',
    producer: { systemId: 'fixture', systemVersion: null, attestationId: null },
    createdAtIso: AT,
  });
  if (!made.ok) throw new Error('fixture refused');
  return made.value;
}

const ready = (): WonderWebCreationDraft => ({
  ...creation(),
  status: 'RUNNING',
  entrypoint: 'index.html',
  buildArtifacts: [{ path: 'index.html', sizeBytes: 1, sha256: null, mediaType: null }],
  logs: [{ sequence: 1, stream: 'build', text: 'built ok', redactionsApplied: 0 }],
});

describe('the window matches the reference', () => {
  it('renders the wordmark, MY VIEW first, and the peer tabs after it', () => {
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [
        { userId: 'ghu-3', displayName: 'JUDITH', connectionState: 'LIVE' },
        { userId: 'ghu-4', displayName: 'TANISH', connectionState: 'LIVE' },
        { userId: 'ghu-5', displayName: 'MAYA', connectionState: 'LIVE' },
      ],
      creation: null,
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    render(<RelayWonderWeb surface={surface} creationUrl={null} />);

    expect(screen.getByText('WONDER WEB')).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].textContent).toContain('MY VIEW');
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('JUDITH'),
        expect.stringContaining('TANISH'),
        expect.stringContaining('MAYA'),
      ]),
    );
  });

  it('shows the project address and the terminal prompt verbatim', () => {
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [],
      creation: null,
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    render(<RelayWonderWeb surface={surface} creationUrl={null} />);

    expect(screen.getByText('wonder.app/project')).toBeTruthy();
    expect(screen.getByText('wonder@project:~$')).toBeTruthy();
    // The lock is rendered only because the projection said `secure`.
    expect(screen.getByLabelText('Served from an isolated origin')).toBeTruthy();
  });

  it('rests on the Wonder mark when nothing is open', () => {
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [],
      creation: null,
      projectId: null,
      observedAtIso: AT,
    });
    const { container } = render(<RelayWonderWeb surface={surface} creationUrl={null} />);
    expect(container.querySelector('.rww__idle-mark')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });
});

describe('the frame is only ever handed to someone with control', () => {
  it('loads the creation in a sandboxed frame for its owner', () => {
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [],
      creation: ready(),
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    const { container } = render(
      <RelayWonderWeb surface={surface} creationUrl="http://127.0.0.1:41234/" />,
    );
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    const sandbox = frame?.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    // THE load-bearing omission: without this the frame would share Relay's
    // origin and the whole boundary would be decorative.
    expect(sandbox).not.toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');
  });

  it('gives an observer no frame, no cursor and no live controls', () => {
    const surface = projectWonderWebSurface({
      viewerUserId: PEER,
      viewerDisplayName: 'JUDITH',
      peers: [{ userId: OWNER, displayName: 'KAI', connectionState: 'LIVE' }],
      creation: ready(),
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    const { container } = render(
      <RelayWonderWeb surface={surface} creationUrl="http://127.0.0.1:41234/" />,
    );

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.rww__cursor')).toBeNull();
    expect(screen.getByLabelText('Stop').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Rebuild').hasAttribute('disabled')).toBe(true);
    // The owner's build log is not shown to a bystander.
    expect(container.textContent).not.toContain('built ok');
  });

  it('renders a failure rather than an empty page', () => {
    const failed: WonderWebCreationDraft = {
      ...creation(),
      status: 'FAILED',
      errors: [
        { phase: 'build', summary: 'The build exited 2.', detail: null, occurredAtIso: AT },
      ],
    };
    const surface = projectWonderWebSurface({
      viewerUserId: OWNER,
      viewerDisplayName: 'KAI',
      peers: [],
      creation: failed,
      projectId: 'prj_1',
      observedAtIso: AT,
    });
    const { container } = render(<RelayWonderWeb surface={surface} creationUrl={null} />);
    expect(screen.getByText('Build failed')).toBeTruthy();
    expect(screen.getByText('The build exited 2.')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
  });
});

describe('the stylesheet keeps the reference palette', () => {
  const css = readFileSync(join(__dirname, 'relay-wonder-web.css'), 'utf8');

  it('draws the chrome in one yellow on an unlit ground', () => {
    expect(css).toContain('--rww-line: #ffd400');
    expect(css).toContain('--rww-ink: #05050a');
  });

  it('declares a dot token for every token the projection can emit', () => {
    for (const token of [
      'wonder-dot-amber', 'wonder-dot-violet', 'wonder-dot-azure',
      'wonder-dot-rose', 'wonder-dot-jade', 'wonder-dot-coral',
    ]) {
      expect(css, `${token} has no colour`).toContain(`--${token}:`);
    }
  });
});
