import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore } from '../../persistence';
import type { CliCaps } from './contracts';
import { DEMO_LABELS } from './contracts';
import {
  DEMO_EVIDENCE, DEMO_FINDING_RESOLVED, DEMO_MANUAL_TASK, DEMO_PROJECT,
  DEMO_RECOVERY, DEMO_REPAIR, DEMO_TIMELINE, DEMO_TIMELINE_PREFIX_COUNT,
} from './fixtures';
import { initialState, renderScreen, type AppData, type AppState } from './app';
import { runProductShell } from './shell';
import { paint } from './theme';

/**
 * Relay CLI offline demo (Prompt 8.6). OFFLINE DEMO · FAKE ADAPTERS · NO
 * PROVIDER CALLS: an isolated temporary state root, fixture events only,
 * and clear labeling on every screen. The interactive mode is the real
 * product shell fed with the scripted mission; the plain mode prints a
 * deterministic non-interactive walkthrough of every screen (including the
 * simulated-restart recovery view).
 */

/** Demo playback tick (ms). Locked with DEMO_STEP_TICKS by the Prompt-8.7
 * acceptance tests: 300ms × 7 ticks × 20 reveals ≈ 42s at 1× — the
 * founder-approved duration. Change requires re-approval. */
export const DEMO_PLAYBACK_MS = 300;

export function demoData(): AppData {
  return {
    projects: [DEMO_PROJECT],
    events: DEMO_TIMELINE,
    tasks: [DEMO_MANUAL_TASK],
    findings: [DEMO_FINDING_RESOLVED],
    repairs: [{ ...DEMO_REPAIR, status: 'RESOLVED' }],
    evidence: DEMO_EVIDENCE,
    recovery: DEMO_RECOVERY,
    demo: true,
  };
}

export async function runCliDemo(input: { caps: CliCaps; plain: boolean }): Promise<{ lines: string[]; exitCode: number }> {
  const root = mkdtempSync(join(tmpdir(), 'relay-cli-demo-state-'));
  const store = createStateStore({ root });
  const now = (): string => '2026-07-26T12:43:00.000Z';
  const data = demoData();
  // Durable-state integration: the demo project exists as a real durable
  // record inside the ISOLATED temp root (never the user's state root).
  store.writeProjectRecord(DEMO_PROJECT.projectId, DEMO_PROJECT as unknown as Record<string, unknown>);

  try {
    if (!input.plain && input.caps.tty) {
      // Open on the activation splash and step into the live console on ENTER/P;
      // a fine 300ms tick drives dot animation, with reduceTick pacing reveals.
      const exitCode = await runProductShell({
        caps: input.caps, data, store, playbackMs: DEMO_PLAYBACK_MS, now, initialScreen: 'demo-intro',
        selectedProjectId: DEMO_PROJECT.projectId,
      });
      return { lines: [], exitCode };
    }
    return { lines: plainWalkthrough(data, input.caps), exitCode: 0 };
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** Deterministic non-interactive walkthrough — stable formatting, no cursor
 * movement, no spinners, safe for pipes and recordings. */
export function plainWalkthrough(data: AppData, caps: CliCaps): string[] {
  const p = paint(caps);
  const lines: string[] = [];
  const sep = caps.unicode ? ' · ' : ' / ';
  const banner = (title: string): void => {
    lines.push('', `===== ${title} =====`, DEMO_LABELS.join(sep), '');
  };
  const screen = (state: AppState): void => {
    lines.push(...renderScreen(state, data, caps));
  };
  const base = initialState(false);

  banner('ACTIVATION SPLASH');
  screen({ ...base, screen: 'demo-intro' });

  banner('ACTIVE MISSION CONSOLE — MID-PLAYBACK (Coding Agent working, paused)');
  screen({ ...base, screen: 'console', view: 'panels', timelineCount: 8, playing: false, selectedProjectId: data.projects[0]?.projectId ?? null });

  banner('RELAY HOME');
  screen({ ...base, screen: 'home' });

  banner('PROJECT HOME');
  screen({ ...base, screen: 'project', selectedProjectId: data.projects[0]?.projectId ?? null });

  banner('ACTIVE MISSION CONSOLE — PANELS VIEW (before review)');
  screen({ ...base, screen: 'console', view: 'panels', timelineCount: DEMO_TIMELINE_PREFIX_COUNT, selectedProjectId: data.projects[0]?.projectId ?? null });

  banner('ACTIVE MISSION CONSOLE — STREAM VIEW (full mission)');
  screen({ ...base, screen: 'console', view: 'stream', timelineCount: data.events.length, selectedProjectId: data.projects[0]?.projectId ?? null });

  banner('RESEARCH STATUS');
  screen({ ...base, screen: 'research', selectedProjectId: data.projects[0]?.projectId ?? null });

  banner('MANUAL TASK');
  screen({ ...base, screen: 'tasks' });

  banner('FINDINGS AND REPAIRS');
  screen({ ...base, screen: 'findings' });

  banner('VERIFICATION EVIDENCE');
  screen({ ...base, screen: 'evidence' });

  banner('SIMULATED RESTART — RECOVERY');
  lines.push(p.dim('The process exited and a fresh Relay CLI reopened the durable run.'), '');
  screen({ ...base, screen: 'recovery' });

  banner('VERIFIED COMPLETE — MISSION CONSOLE');
  screen({ ...base, screen: 'console', view: 'panels', timelineCount: data.events.length, selectedProjectId: data.projects[0]?.projectId ?? null });

  lines.push('', `${DEMO_LABELS.join(sep)}${caps.unicode ? ' — ' : ' -- '}no provider was called.`);
  return lines;
}
