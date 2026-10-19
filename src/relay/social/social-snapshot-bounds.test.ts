import { describe, expect, it } from 'vitest';
import { conversationsFor, openDirectConversation, sendMessage } from './social-conversations';
import { createSocialFixture, FIXTURE_NOW, FIXTURE_USERS as U } from './social-fixtures';
import { boundedSnapshotMessages, buildSocialView, SNAPSHOT_MESSAGE_CHAR_BUDGET, SNAPSHOT_MESSAGES_PER_CONVERSATION } from './social-preview';
import { friendIdsOf, messagesOf, type SocialState } from './social-state';
import type { RelayResult } from '../protocol/errors';

/**
 * THE SNAPSHOT'S MESSAGE HISTORY IS BOUNDED (CORE's latent MAJOR of 10-07). The client refuses an answer longer than
 * 2 Mi characters (WonderlandSocialLive.cpp MaxResponseBytes = 2 * 1024 * 1024) and never pages older history: an unbounded
 * history would one day make a player's whole social view unreadable. These tests build that day.
 */
const CLIENT_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

function must<T>(r: RelayResult<T>): T {
  expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const atSecond = (n: number): string => new Date(Date.parse(FIXTURE_NOW) + n * 1000).toISOString();

/** Kai talks with each of his friends: `perConversation` messages each, every body `body(n)`. Newest conversation last. */
function talkative(perConversation: number, body: (n: number) => string): { state: SocialState; conversationIds: string[] } {
  let state = createSocialFixture();
  const conversationIds: string[] = [];
  let clock = 0;
  for (const friend of friendIdsOf(state, U.KAI)) {
    const opened = must(openDirectConversation(state, U.KAI, friend, atSecond(clock)));
    state = opened.state;
    conversationIds.push(opened.conversationId);
    for (let n = 0; n < perConversation; n += 1) {
      clock += 1;
      state = must(sendMessage(state, n % 2 === 0 ? U.KAI : friend, opened.conversationId, { body: body(n) }, atSecond(clock)));
    }
  }
  return { state, conversationIds };
}

describe('the social snapshot: bounded message history', () => {
  it('a small history is served whole, with nothing omitted', () => {
    const state = createSocialFixture();
    const view = buildSocialView(state, U.KAI, FIXTURE_NOW, { developmentPreview: false });
    expect(view.messagesOmitted).toEqual({});
    for (const c of view.conversations) expect(view.messages[c.conversationId]).toEqual(messagesOf(state, c.conversationId));
  });

  it(`a conversation keeps its newest ${SNAPSHOT_MESSAGES_PER_CONVERSATION} messages, oldest first, and says how many it left out`, () => {
    const { state, conversationIds } = talkative(150, (n) => `message ${n}`);
    const view = buildSocialView(state, U.KAI, FIXTURE_NOW, { developmentPreview: false });
    for (const id of conversationIds) {
      const all = messagesOf(state, id);
      const kept = view.messages[id];
      expect(kept).toHaveLength(SNAPSHOT_MESSAGES_PER_CONVERSATION);
      expect(kept).toEqual(all.slice(-SNAPSHOT_MESSAGES_PER_CONVERSATION));
      expect(kept.map((m) => m.sequence)).toEqual([...kept.map((m) => m.sequence)].sort((a, b) => a - b));
      expect(view.messagesOmitted[id]).toBe(all.length - SNAPSHOT_MESSAGES_PER_CONVERSATION);
    }
  });

  it('the WORST CASE stays readable: every friend, maximum-length bodies that double when escaped -- under the client cap, newest first, nothing deleted', () => {
    const { state, conversationIds } = talkative(SNAPSHOT_MESSAGES_PER_CONVERSATION + 50, () => '"'.repeat(2000));
    expect(conversationIds.length).toBeGreaterThanOrEqual(3);
    // the control: unbounded, this history alone is past what the client accepts
    const unbounded = conversationIds.reduce((sum, id) => sum + messagesOf(state, id).reduce((s, m) => s + JSON.stringify(m).length + 1, 0), 0);
    expect(unbounded).toBeGreaterThan(CLIENT_MAX_RESPONSE_CHARS);

    const view = buildSocialView(state, U.KAI, FIXTURE_NOW, { developmentPreview: false });
    expect(JSON.stringify({ data: view }).length).toBeLessThan(CLIENT_MAX_RESPONSE_CHARS);
    const spent = Object.values(view.messages).reduce((s, list) => s + list.reduce((t, m) => t + JSON.stringify(m).length + 1, 0), 0);
    expect(spent).toBeLessThanOrEqual(SNAPSHOT_MESSAGE_CHAR_BUDGET);

    // the newest conversation is served first, with its newest messages
    const newest = conversationsFor(state, U.KAI)[0].conversationId;
    expect(view.messages[newest].length).toBeGreaterThan(0);
    expect(view.messages[newest].at(-1)).toEqual(messagesOf(state, newest).at(-1));
    // every conversation's kept + omitted is its whole history: nothing is lost from the store, only from this view
    for (const id of conversationIds) expect(view.messages[id].length + (view.messagesOmitted[id] ?? 0)).toBe(messagesOf(state, id).length);
  });

  it('boundedSnapshotMessages never splits a conversation out of order: what it keeps is a contiguous newest run', () => {
    const { state } = talkative(SNAPSHOT_MESSAGES_PER_CONVERSATION + 20, (n) => `${n}:${'x'.repeat(n % 7 === 0 ? 1990 : 10)}`);
    const conversations = conversationsFor(state, U.KAI);
    const { messages } = boundedSnapshotMessages(state, conversations);
    for (const c of conversations) {
      const all = messagesOf(state, c.conversationId);
      const kept = messages[c.conversationId];
      expect(kept).toEqual(all.slice(all.length - kept.length));
    }
  });
});
