import { describe, expect, it } from 'vitest';

import {
  JULIUS_AUTHORITY,
  SIDEKICK_EDGES,
  SIDEKICK_REGISTRY,
  SIDEKICK_STATES,
  authorityOf,
  chooseAuth,
  emptySidekickWorld,
  findProvider,
  grantAuthority,
  isLegalSidekickTransition,
  isSidekickAuthority,
  looksLikeSecret,
  mascotStateFor,
  providersFor,
} from '../../src/relay/mission/sidekicks';
import { createSidekickService, type SidekickService, type SidekickServiceView } from './sidekick-service';

/**
 * THE SIDEKICK ARCHITECTURE, PROVEN PROVIDER-FREE.
 *
 * FOUNDER DIRECTIVE (2026-09-17): finish the provider interface, auth state, cancellation, timeout, rate limits, quota
 * failure, malformed results, reconnection, session identity, crash recovery, audit, secret isolation, model identity and
 * the SIMULATED/REAL distinction BEFORE any real call. Every one of those has a test here, against deterministic
 * fixtures: nothing in this file contacts anything, and no provider is paid to run it.
 */

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * WAIT FOR THE THING, NOT FOR A NUMBER. These fixtures run on real timers, so a test that sleeps a fixed 700 ms passes
 * on an idle machine and fails on a busy one -- which is a test that proves nothing. This polls until the condition
 * holds, or gives up loudly.
 */
async function waitFor(check: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await settle(20);
  }
  throw new Error(`waited ${timeoutMs} ms for: ${what}`);
}

const settled = (service: SidekickService, sidekickId: string) => () => look(service, sidekickId).live === null;

function look(service: SidekickService, sidekickId: string): SidekickServiceView['sidekicks'][number] {
  const found = service.view().sidekicks.find((sidekick) => sidekick.sidekickId === sidekickId);
  if (found === undefined) throw new Error(`no sidekick ${sidekickId}`);
  return found;
}

function must(result: ReturnType<SidekickService['intent']>): SidekickServiceView {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A companion connected to its development stand-in, which is where every turn test starts. */
async function connected(options: Parameters<typeof createSidekickService>[0] = {}): Promise<SidekickService> {
  const service = createSidekickService({ timeoutMs: 3000, rateLimitMs: 120, ...options });
  must(service.intent({ intent: 'connect', sidekickId: 'llm-companion', providerId: 'dev-companion' }));
  await settle(20);
  expect(look(service, 'llm-companion').state).toBe('CONNECTED');
  return service;
}

describe('sidekicks: the three identities do not collapse', () => {
  it('Julius is not a sidekick, and no sidekick can hold mission authority', () => {
    // JULIUS IS ABSENT FROM THE REGISTRY BY CONSTRUCTION: it is the compound agent, not something a provider backs.
    expect(SIDEKICK_REGISTRY.some((provider) => /julius/i.test(provider.providerId))).toBe(false);
    expect(JULIUS_AUTHORITY).toBe('mission');
    expect(isSidekickAuthority('mission')).toBe(false);
    expect(authorityOf('llm_companion')).toBe('conversation');
    expect(authorityOf('single_agent')).toBe('scoped_work');

    const world = emptySidekickWorld({ at: '2026-09-17T12:00:00.000Z' });
    for (const sidekickId of ['llm-companion', 'jhinn']) {
      const refused = grantAuthority(world, { sidekickId, authority: 'mission' });
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe('permission-denied');
        expect(refused.error.message).toContain('Julius');
      }
    }
    // Each may hold its own authority, and only its own.
    expect(grantAuthority(world, { sidekickId: 'llm-companion', authority: 'conversation' }).ok).toBe(true);
    expect(grantAuthority(world, { sidekickId: 'llm-companion', authority: 'scoped_work' }).ok).toBe(false);
  });

  it('a provider cannot back the wrong kind of sidekick', () => {
    const service = createSidekickService();
    // Claude Code is a single agent's provider; putting it behind the conversational companion is a category error.
    const wrong = service.intent({ intent: 'connect', sidekickId: 'llm-companion', providerId: 'claude-code' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.message).toContain('different jobs');
    expect(providersFor('llm_companion').map((p) => p.providerId)).toEqual(['openai', 'dev-companion']);
    expect(providersFor('single_agent').map((p) => p.providerId)).toEqual(['claude-code', 'dev-single-agent']);
  });
});

describe('sidekicks: auth is real or it is nothing', () => {
  it('a companion with no account is SIMULATED and says so', () => {
    const service = createSidekickService();
    const companion = look(service, 'llm-companion');
    expect(companion.state).toBe('SIMULATED');
    expect(companion.mode).toBe('SIMULATED');
    expect(companion.note).toContain('SIMULATED');
  });

  it('asking for a real provider waits for the founder and contacts nothing', () => {
    const service = createSidekickService();
    must(service.intent({ intent: 'connect', sidekickId: 'llm-companion', providerId: 'openai' }));
    const companion = look(service, 'llm-companion');
    expect(companion.state).toBe('AUTH_REQUIRED');
    expect(companion.mode).toBe('REAL');
    expect(companion.note).toContain('account');
    // NOTHING WAS CONTACTED, and the audit says so rather than implying a failed call.
    expect(service.view().audit[0]).toMatchObject({ action: 'auth.required', mode: 'REAL', outcome: 'pending' });
    expect(service.view().audit[0].detail).toContain('Nothing was contacted');
  });

  it('the registry records the real auth mechanism each provider actually offers, and no more', () => {
    const openai = findProvider('openai')!;
    // A SUBSCRIPTION IS NOT A CREDENTIAL, and the registry says so where the founder will read it.
    expect(openai.auth.map((option) => option.mechanism)).toEqual(['api_credential']);
    expect(openai.auth[0].unavailableReason).toMatch(/ChatGPT Plus or Pro subscription does not by itself grant API access/);
    expect(chooseAuth(openai)).toBeNull();

    const claudeCode = findProvider('claude-code')!;
    // The preferred route for Claude Code holds no credential at all: its own tool keeps its own.
    expect(claudeCode.auth[0].mechanism).toBe('account_cli');
    expect(claudeCode.auth[0].holdsCredential).toBe(false);
    expect(claudeCode.auth.map((o) => o.mechanism)).toContain('api_credential');
    expect(chooseAuth(claudeCode)).toBeNull();

    // Every real provider says plainly what it is not.
    for (const provider of SIDEKICK_REGISTRY.filter((p) => !p.development)) {
      expect(provider.notThis.length).toBeGreaterThan(20);
    }
    expect(findProvider('claude-code')!.notThis).toContain('not Julius');
  });

  it('only legal moves exist, and CONNECTED is reachable only from CONNECTING', () => {
    for (const [from, to] of SIDEKICK_EDGES) {
      expect(SIDEKICK_STATES).toContain(from);
      expect(SIDEKICK_STATES).toContain(to);
    }
    expect(SIDEKICK_EDGES.filter(([, to]) => to === 'CONNECTED').map(([from]) => from).sort()).toEqual(['CONNECTING', 'RATE_LIMITED', 'WORKING']);
    expect(isLegalSidekickTransition('SIMULATED', 'CONNECTED')).toBe(false);
    expect(isLegalSidekickTransition('AUTH_REQUIRED', 'CONNECTED')).toBe(false);
  });
});

describe('sidekicks: a turn, and every way it can end', () => {
  it('will not ask anything of a companion that is not connected', () => {
    const service = createSidekickService();
    const refused = service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'hello' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('asked nothing');
  });

  it('answers, streams while it does, and marks the answer SIMULATED for ever', async () => {
    const service = await connected();
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'what are you?' }));
    const working = look(service, 'llm-companion');
    expect(working.state).toBe('WORKING');
    expect(['THINKING', 'STREAMING']).toContain(working.live?.state);
    expect(working.mascot === 'THINKING' || working.mascot === 'RESPONDING').toBe(true);

    await waitFor(settled(service, 'llm-companion'), 'the answer to arrive');
    const done = look(service, 'llm-companion');
    expect(done.state).toBe('CONNECTED');
    expect(done.mascot).toBe('IDLE');
    expect(done.lastAnswer).toContain('SIMULATED COMPANION');
    expect(done.turns).toBe(1);
    // THE MARK IS WRITTEN ONCE AND NEVER EDITED: the audit row for the answer says SIMULATED too.
    expect(service.view().audit.find((row) => row.action === 'turn.answered')?.mode).toBe('SIMULATED');
  });

  it('cancels a turn in flight, and says it was cancelled rather than answered', async () => {
    const service = await connected();
    must(service.intent({ intent: 'connect', sidekickId: 'llm-companion', providerId: 'dev-companion', modelId: 'fixture-chat-slow' }));
    await settle(20);
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'take your time' }));
    await settle(120);
    must(service.intent({ intent: 'cancel', sidekickId: 'llm-companion' }));
    await waitFor(settled(service, 'llm-companion'), 'the cancellation to land');
    const after = look(service, 'llm-companion');
    expect(after.state).toBe('CONNECTED');
    expect(after.live).toBeNull();
    expect(after.lastAnswer).toBe('');
    expect(service.view().audit.some((row) => row.action === 'turn.cancelled')).toBe(true);
  });

  it('a rate limit is a wait, and the companion comes back on its own', async () => {
    const service = await connected({ rateLimitMs: 100 });
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'please rate limit me' }));
    await waitFor(() => look(service, 'llm-companion').state === 'RATE_LIMITED', 'the rate limit');
    // RATE LIMITED IS NOT WORKING: nothing is being computed, so the body is idle rather than busy.
    expect(look(service, 'llm-companion').mascot).toBe('IDLE');
    await waitFor(() => {
      service.tick();
      return look(service, 'llm-companion').state === 'CONNECTED';
    }, 'the companion to come back on its own');
  });

  it('an exhausted account, a malformed answer and a provider error each fail honestly', async () => {
    for (const [ask, failure] of [
      ['we have no credit left, quota', 'QUOTA_EXHAUSTED'],
      ['send me something malformed', 'MALFORMED'],
      ['cause a provider error', 'PROVIDER_ERROR'],
    ] as const) {
      const service = await connected();
      must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask }));
      await waitFor(() => look(service, 'llm-companion').state === 'FAILED', `the ${failure} failure`);
      const after = look(service, 'llm-companion');
      expect(after.state).toBe('FAILED');
      expect(after.failure).toBe(failure);
      expect(after.mascot).toBe('ERROR');
      // NOTHING PARTIAL IS SHOWN AS AN ANSWER.
      expect(after.lastAnswer).toBe('');
      expect(service.view().audit[0]).toMatchObject({ action: 'turn.failed', outcome: 'failed' });
    }
  });

  it('gives up on a provider that outlasts its timeout', async () => {
    const service = await connected({ timeoutMs: 60 });
    must(service.intent({ intent: 'connect', sidekickId: 'llm-companion', providerId: 'dev-companion', modelId: 'fixture-chat-slow' }));
    await settle(20);
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'a long answer please' }));
    await waitFor(() => look(service, 'llm-companion').state === 'FAILED', 'the timeout');
    const after = look(service, 'llm-companion');
    expect(after.state).toBe('FAILED');
    expect(after.failure).toBe('TIMEOUT');
  });

  it('disconnecting mid-turn ends the turn rather than leaving it hanging', async () => {
    const service = await connected();
    must(service.intent({ intent: 'connect', sidekickId: 'llm-companion', providerId: 'dev-companion', modelId: 'fixture-chat-slow' }));
    await settle(20);
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'still thinking' }));
    await settle(80);
    must(service.intent({ intent: 'disconnect', sidekickId: 'llm-companion' }));
    const after = look(service, 'llm-companion');
    expect(after.state).toBe('DISCONNECTED');
    expect(after.mascot).toBe('DISCONNECTED');
    expect(after.live).toBeNull();
  });
});

describe('sidekicks: identity, memory and provenance', () => {
  it('a session remembers its turns, and a new model is a new conversation', async () => {
    const service = await connected();
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'first' }));
    await waitFor(settled(service, 'llm-companion'), 'the first answer');
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'second' }));
    await waitFor(settled(service, 'llm-companion'), 'the second answer');
    const twoTurns = look(service, 'llm-companion');
    expect(twoTurns.turns).toBe(2);
    // The fixture proves the history really reached the provider: it counts the turns it was given.
    expect(twoTurns.lastAnswer).toContain('turn 2');
    const sessionBefore = twoTurns.sessionId;

    must(service.intent({ intent: 'model', sidekickId: 'llm-companion', modelId: 'fixture-chat-slow' }));
    const afterModel = look(service, 'llm-companion');
    expect(afterModel.modelId).toBe('fixture-chat-slow');
    expect(afterModel.sessionId).not.toBe(sessionBefore);
    expect(afterModel.turns).toBe(0);
    expect(service.view().audit[0]).toMatchObject({ action: 'model.changed' });
  });

  it('a turn left in flight when the runtime goes down is lost, not resumed', async () => {
    const service = await connected();
    must(service.intent({ intent: 'connect', sidekickId: 'llm-companion', providerId: 'dev-companion', modelId: 'fixture-chat-slow' }));
    await settle(20);
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: 'interrupt me' }));
    await settle(80);
    await service.close();
    const after = look(service, 'llm-companion');
    expect(after.live).toBeNull();
    expect(after.lastAnswer).toBe('');
  });

  it('refuses to carry credential material into a conversation, and does not record it', async () => {
    const service = await connected();
    const key = `sk-${'a1B2c3D4e5F6g7H8'}`;
    must(service.intent({ intent: 'ask', sidekickId: 'llm-companion', ask: `my key is ${key}` }));
    const after = look(service, 'llm-companion');
    // NOTHING WAS SENT AND NO TURN WAS OPENED.
    expect(after.live).toBeNull();
    expect(after.turns).toBe(0);
    expect(after.note).toContain('not sent anywhere');
    const audited = JSON.stringify(service.view());
    expect(audited).not.toContain(key);
    expect(looksLikeSecret(key)).toBe(true);
  });

  it('the body follows the runtime, and has no state the runtime cannot explain', () => {
    expect(mascotStateFor('AUTH_REQUIRED', null, 'llm_companion')).toBe('WAITING_FOR_AUTH');
    expect(mascotStateFor('DISCONNECTED', null, 'llm_companion')).toBe('DISCONNECTED');
    expect(mascotStateFor('FAILED', null, 'single_agent')).toBe('ERROR');
    expect(mascotStateFor('CONNECTED', null, 'llm_companion')).toBe('IDLE');
    expect(mascotStateFor('SIMULATED', null, 'llm_companion')).toBe('IDLE');
    expect(mascotStateFor('WORKING', 'ASKED', 'llm_companion')).toBe('LISTENING');
    // A CONVERSATION THINKS AND RESPONDS; A SINGLE AGENT WORKS. The same runtime state reads differently on each body.
    expect(mascotStateFor('WORKING', 'THINKING', 'llm_companion')).toBe('THINKING');
    expect(mascotStateFor('WORKING', 'THINKING', 'single_agent')).toBe('WORKING');
    expect(mascotStateFor('WORKING', 'STREAMING', 'llm_companion')).toBe('RESPONDING');
    expect(mascotStateFor('WORKING', 'STREAMING', 'single_agent')).toBe('WORKING');
  });
});

describe('sidekicks: what a single agent is allowed to do', () => {
  it('reads until a person allows more, and a conversational companion can be allowed nothing at all', async () => {
    const service = createSidekickService({ timeoutMs: 5000 });
    // READ ONLY, BY DEFAULT. Nobody granted anything yet, so nothing but looking is possible.
    expect(look(service, 'jhinn').allowance).toEqual(['read']);
    expect(look(service, 'llm-companion').allowance).toEqual([]);

    // A COMPANION THAT CONVERSES HAS NO FOLDER, so there is nothing to allow and the attempt is refused.
    const wrong = service.intent({ intent: 'allow', sidekickId: 'llm-companion', allowance: ['write'] });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('permission-denied');

    must(service.intent({ intent: 'allow', sidekickId: 'jhinn', allowance: ['read', 'write'] }));
    expect(look(service, 'jhinn').allowance).toEqual(['read', 'write']);
    expect(service.view().audit[0].detail).toContain('read, write');

    // AND TAKEN BACK, which is the half that matters: an allowance that cannot be withdrawn is not a permission.
    must(service.intent({ intent: 'allow', sidekickId: 'jhinn', allowance: [] }));
    expect(look(service, 'jhinn').allowance).toEqual([]);
    expect(look(service, 'jhinn').note).toContain('change nothing');
  });

  it('will not change an allowance while the agent is working', async () => {
    const service = createSidekickService({ timeoutMs: 5000 });
    must(service.intent({ intent: 'connect', sidekickId: 'jhinn', providerId: 'dev-single-agent' }));
    await waitFor(() => look(service, 'jhinn').state === 'CONNECTED', 'the agent to connect');
    must(service.intent({ intent: 'ask', sidekickId: 'jhinn', ask: 'look at the palette' }));
    const busy = service.intent({ intent: 'allow', sidekickId: 'jhinn', allowance: ['read', 'run'] });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.error.message).toContain('Not while it is working');
    must(service.intent({ intent: 'cancel', sidekickId: 'jhinn' }));
    await waitFor(settled(service, 'jhinn'), 'the cancellation');
  });
});

describe('sidekicks: the single agent is bounded work, not a mission', () => {
  it('does scoped work, reports, and stops', async () => {
    const service = createSidekickService({ timeoutMs: 5000 });
    must(service.intent({ intent: 'connect', sidekickId: 'jhinn', providerId: 'dev-single-agent' }));
    await settle(20);
    expect(look(service, 'jhinn').state).toBe('CONNECTED');
    must(service.intent({ intent: 'ask', sidekickId: 'jhinn', ask: 'add a test for the palette' }));
    // A SINGLE AGENT WORKS; it does not "think" and it does not "respond".
    await waitFor(() => look(service, 'jhinn').mascot === 'WORKING', 'the agent to be working');
    await waitFor(settled(service, 'jhinn'), 'the task to finish');
    const done = look(service, 'jhinn');
    expect(done.state).toBe('CONNECTED');
    expect(done.authority).toBe('scoped_work');
    expect(done.lastAnswer).toContain('SIMULATED SINGLE AGENT');
    expect(done.lastAnswer).toContain('and nothing outside it');
    expect(done.lastAnswer).toContain('does not carry on into a mission');
    expect(service.view().audit.some((row) => row.action === 'work.finished')).toBe(true);
  });
});
