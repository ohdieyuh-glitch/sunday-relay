import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './main';
import { createNodeMissionWorktreeStore } from '../persistence';
import {
  WORKTREE_SCHEMA_VERSION,
  projectMissionWorktree,
  renderWorktreeStatusLines,
  type MissionWorktreeRecordDraft,
} from '../mission/worktree';

/**
 * `relay mission worktree status|inspect` — read-only, and worded by the
 * SAME projection the website renders. There is no raw-git passthrough and
 * no create/remove command in this milestone.
 */

const roots: string[] = [];
const stateRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-cli-wt-'));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const NOW = '2026-08-01T12:00:00.000Z';

function draft(overrides: Partial<MissionWorktreeRecordDraft> = {}): MissionWorktreeRecordDraft {
  return {
    schemaVersion: WORKTREE_SCHEMA_VERSION,
    worktreeRef: 'worktree:rly-010:mission-cli',
    missionId: 'mission-cli',
    projectId: 'rly-010',
    repositoryName: 'sunday-relay',
    repositoryRoot: '/tmp/does-not-matter/sunday-relay',
    baseBranch: 'main',
    baseCommit: 'abc1234567890abc1234567890abc1234567890a',
    missionBranch: 'relay/mission/mission-cli',
    worktreePath: '/tmp/does-not-matter/.relay-workspaces/missions/sunday-relay/mission-cli',
    state: 'ready',
    createdAt: NOW,
    lastValidatedAt: NOW,
    owner: null,
    expectedHead: 'abc1234567890abc1234567890abc1234567890a',
    actualHead: 'abc1234567890abc1234567890abc1234567890a',
    dirty: false,
    processState: 'none',
    cleanupEligible: false,
    cleanupBlockers: ['mission is not terminal'],
    archived: false,
    interruptionReason: null,
    validationFindings: [
      { check: 'git_registration', ok: true, detail: 'Git registration matches the recorded repository.' },
    ],
    evidenceRefs: [],
    provenance: 'live',
    ...overrides,
  };
}

async function run(args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runCli(args, {
    out: (line: string) => lines.push(line),
    isTTY: false,
    env: { ...process.env, NO_COLOR: '1' } as NodeJS.ProcessEnv,
  });
  return { code, out: lines.join('\n') };
}

describe('relay mission worktree', () => {
  it('reports the absence of a worktree without inventing one', async () => {
    const root = stateRoot();
    const { out } = await run(['mission', 'worktree', 'status', 'mission-cli', '--state-root', root]);
    expect(out).toContain('MISSION WORKTREE — mission-cli');
    expect(out).toContain('No isolated worktree');
    expect(out).not.toContain('.relay-workspaces');
  });

  it('prints the stored state, and matches the website projection exactly', async () => {
    const root = stateRoot();
    const store = createNodeMissionWorktreeStore(root);
    const written = await store.write(draft());
    expect(written.ok).toBe(true);

    const { out } = await run(['mission', 'worktree', 'status', 'mission-cli', '--state-root', root]);
    // The website renders this same view; the CLI adds no wording of its own.
    const expected = renderWorktreeStatusLines(
      'mission-cli',
      projectMissionWorktree(written.record ?? null),
    );
    for (const line of expected) expect(out).toContain(line.trim());
    expect(out).toContain('relay/mission/mission-cli');
    expect(out).toContain('Clean');
    // status abbreviates the path; it never prints the full one.
    expect(out).toContain('…/missions/sunday-relay/mission-cli');
  });

  it('inspect adds the validation findings and the full path', async () => {
    const root = stateRoot();
    const store = createNodeMissionWorktreeStore(root);
    await store.write(draft());
    const { out } = await run(['mission', 'worktree', 'inspect', 'mission-cli', '--state-root', root]);
    expect(out).toContain('Validation:');
    expect(out).toContain('[PASS] git_registration');
    expect(out).toContain('Full path:');
  });

  it('reports a corrupt record as requiring inspection, never as "no worktree"', async () => {
    const root = stateRoot();
    const store = createNodeMissionWorktreeStore(root);
    const written = await store.write(draft());
    if (!written.ok || written.record === undefined) throw new Error('seed must be written');
    // Edit the stored record behind Relay's back.
    const tampered = { ...written.record, missionBranch: 'main' };
    const backingStore = createNodeMissionWorktreeStore(root);
    await backingStore.remove('mission-cli');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const dir = join(root, 'durable-missions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${encodeURIComponent('worktree:mission-cli')}.json`),
      JSON.stringify(tampered),
      'utf8',
    );
    const { out } = await run(['mission', 'worktree', 'status', 'mission-cli', '--state-root', root]);
    expect(out).toContain('Requires inspection');
    expect(out).toContain('corrupt');
    expect(out).not.toContain('No isolated worktree');
  });

  it('refuses an unknown mode instead of guessing', async () => {
    const { out } = await run(['mission', 'worktree', 'destroy', 'mission-cli']);
    expect(out).toContain('requires status or inspect');
  });

  it('exposes no create, remove or raw-git command', async () => {
    const { out } = await run(['mission', 'worktree']);
    expect(out).toContain('requires status or inspect');
    expect(out).not.toContain('create');
    expect(out).not.toContain('remove');
  });
});
