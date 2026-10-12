/**
 * WONDERLAND SOCIAL — conversations and messages.
 *
 * DIRECT messages first (founder: "Architect group conversations cleanly even if the first implementation ships direct
 * messages first"), so a conversation is a member list from the start and DIRECT is just the two-member case.
 *
 * UNREAD IS ARITHMETIC, NOT A FLAG: each conversation numbers its messages 1, 2, 3 …, each member records the last number
 * they have read, and unread is the difference -- with one's own messages counting as read. A flag per message would have to
 * be written for every reader of every message; a number per member is written once per read.
 *
 * A BLOCK HIDES THE PAIR'S DIRECT CONVERSATION FROM BOTH (FOUNDER RULING (b), 2026-10-04 -- replacing the earlier rule that it
 * "stays readable, it just cannot grow"). While a block stands either way, the DIRECT conversation between the pair is in
 * neither one's list, snapshot or reads: listing skips it, and reading, writing, marking read or re-opening it answer exactly
 * as a conversation that is not there (re-opening: as somebody not accepting your messages). Nothing is deleted: on the
 * unblock it comes back unchanged.
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import {
  MESSAGE_MAX_CHARS,
  type Conversation,
  type Message,
  type MessageKind,
  type SocialUserId,
} from './social-contracts';
import { resolvePresenceFor } from './social-presence';
import { audienceAdmits, blockedEitherWay, conversationById, hasUser, isMuted, messagesOf, mintId, userById, type SocialState } from './social-state';

const denied = (message: string) => fail<SocialState>(relayError('permission-denied', message));
const invalid = (message: string) => fail<SocialState>(relayError('validation-failed', message));

/** The deterministic id of the one DIRECT conversation between two people. */
export function directConversationId(a: SocialUserId, b: SocialUserId): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `dm_${x}__${y}`;
}

/** The refusal for "you may not write to this person": a policy that does not admit you, and anybody across a wall. */
export const NOT_ACCEPTING_MESSAGES = 'this person is not accepting messages from you';

/** A DIRECT conversation whose other member has a block with this member, either way: hidden from both (ruling (b)). */
export function isWalledDirect(state: SocialState, conversation: Conversation, userId: SocialUserId): boolean {
  if (conversation.kind !== 'DIRECT') return false;
  const other = conversation.memberIds.find((id) => id !== userId);
  return other !== undefined && blockedEitherWay(state, userId, other);
}

/**
 * OPEN (or find) THE DIRECT CONVERSATION. Only when there is no block either way (a hidden conversation is never handed back:
 * the answer is a stranger's who does not accept your messages) and -- for a new one -- the other person's message policy
 * admits the actor: the same `can.message` the presence authority shows on every surface.
 */
export function openDirectConversation(
  state: SocialState,
  actorId: SocialUserId,
  otherId: SocialUserId,
  atIso: string,
): RelayResult<{ state: SocialState; conversationId: string }> {
  if (!hasUser(state, actorId) || !hasUser(state, otherId)) return fail(relayError('not-found', 'user not found'));
  if (actorId === otherId) return fail(relayError('validation-failed', 'a person cannot message themselves'));
  if (blockedEitherWay(state, actorId, otherId)) return fail(relayError('permission-denied', NOT_ACCEPTING_MESSAGES));
  const id = directConversationId(actorId, otherId);
  if (conversationById(state, id) !== undefined) return ok({ state, conversationId: id });
  const view = resolvePresenceFor(state, actorId, otherId);
  if (view === null || !view.can.message) return fail(relayError('permission-denied', NOT_ACCEPTING_MESSAGES));
  const conversation: Conversation = {
    conversationId: id,
    kind: 'DIRECT',
    memberIds: [actorId, otherId].sort(),
    title: null,
    partyId: null,
    createdAtIso: atIso,
    lastSequence: 0,
    lastMessageAtIso: null,
  };
  return ok({ state: { ...state, conversations: { ...state.conversations, [id]: conversation }, messages: { ...state.messages, [id]: [] } }, conversationId: id });
}

/** A GROUP conversation among people who may each message the creator. Up to 16 members. */
export function openGroupConversation(
  state: SocialState,
  actorId: SocialUserId,
  memberIds: readonly SocialUserId[],
  title: string,
  atIso: string,
): RelayResult<{ state: SocialState; conversationId: string }> {
  const members = [...new Set([actorId, ...memberIds])].sort();
  if (members.length < 3 || members.length > 16) return fail(relayError('validation-failed', 'a group has 3 to 16 members'));
  for (const id of members) {
    const member = userById(state, id);
    if (member === undefined) return fail(relayError('not-found', 'user not found'));
    if (id !== actorId && (blockedEitherWay(state, actorId, id) || !audienceAdmits(state, member.privacy.messagePolicy, actorId, id))) {
      return fail(relayError('permission-denied', 'not everybody listed accepts messages from you'));
    }
  }
  const minted = mintId(state, 'grp');
  const conversation: Conversation = {
    conversationId: minted.id,
    kind: 'GROUP',
    memberIds: members,
    title: title.trim().slice(0, 60) || 'Group',
    partyId: null,
    createdAtIso: atIso,
    lastSequence: 0,
    lastMessageAtIso: null,
  };
  return ok({
    state: { ...minted.state, conversations: { ...minted.state.conversations, [minted.id]: conversation }, messages: { ...minted.state.messages, [minted.id]: [] } },
    conversationId: minted.id,
  });
}

/**
 * SEND. A member only; text 1..2000 characters (trimmed). In a DIRECT conversation:
 *   - across a block either way the conversation is hidden from both (ruling (b)): the answer is exactly a missing
 *     conversation's, before anything else is looked at;
 *   - otherwise the other person's message policy must still admit the writer, as it had to when the conversation was opened:
 *     somebody who unfriended you under a FRIENDS policy no longer receives your messages (Second's R16 run: an existing DM
 *     was never re-checked).
 */
export function sendMessage(
  state: SocialState,
  actorId: SocialUserId,
  conversationId: string,
  input: { kind?: MessageKind; body: string; ref?: string | null },
  atIso: string,
): RelayResult<SocialState> {
  const conversation = conversationById(state, conversationId);
  // NOT A MEMBER = NOT THERE (the privacy attacker's B1, 10-07): a 403 for a non-member against a 404 for no conversation told
  // any player whether two others had ever opened a DM (dm_<a>__<b> is computable). One answer for both, as messages.list gives.
  if (conversation === undefined || isWalledDirect(state, conversation, actorId) || !conversation.memberIds.includes(actorId)) {
    return fail(relayError('not-found', 'conversation not found'));
  }
  if (conversation.kind === 'DIRECT') {
    const other = conversation.memberIds.find((id) => id !== actorId);
    const recipient = other === undefined ? undefined : userById(state, other);
    if (recipient !== undefined && !audienceAdmits(state, recipient.privacy.messagePolicy, actorId, recipient.profile.userId)) return denied(NOT_ACCEPTING_MESSAGES);
  }
  const kind = input.kind ?? 'TEXT';
  if (kind === 'SYSTEM') return denied('system messages are not sent by people');
  const body = input.body.trim();
  if (kind === 'TEXT' && (body.length === 0 || body.length > MESSAGE_MAX_CHARS)) return invalid(`a message is 1 to ${MESSAGE_MAX_CHARS} characters`);
  const minted = mintId(state, 'msg');
  const sequence = conversation.lastSequence + 1;
  const message: Message = {
    messageId: minted.id,
    conversationId,
    sequence,
    senderId: actorId,
    kind,
    body: body.slice(0, MESSAGE_MAX_CHARS),
    ref: input.ref ?? null,
    sentAtIso: atIso,
  };
  const next = minted.state;
  return ok({
    ...next,
    conversations: { ...next.conversations, [conversationId]: { ...conversation, lastSequence: sequence, lastMessageAtIso: atIso } },
    messages: { ...next.messages, [conversationId]: [...messagesOf(next, conversationId), message] },
    // The sender has read their own message.
    readStates: setRead(next.readStates, conversationId, actorId, sequence),
  });
}

function setRead(states: SocialState['readStates'], conversationId: string, userId: SocialUserId, sequence: number): SocialState['readStates'] {
  const current = states.find((r) => r.conversationId === conversationId && r.userId === userId);
  if (current !== undefined && current.lastReadSequence >= sequence) return states;
  return [...states.filter((r) => !(r.conversationId === conversationId && r.userId === userId)), { conversationId, userId, lastReadSequence: sequence }];
}

/** Mark read up to `sequence` (default: everything). Never moves backwards. A hidden conversation is not there. */
export function markRead(state: SocialState, actorId: SocialUserId, conversationId: string, sequence?: number): RelayResult<SocialState> {
  const conversation = conversationById(state, conversationId);
  // NOT A MEMBER = NOT THERE (B1): the same single answer as sendMessage, and as a conversation that does not exist.
  if (conversation === undefined || isWalledDirect(state, conversation, actorId) || !conversation.memberIds.includes(actorId)) {
    return fail(relayError('not-found', 'conversation not found'));
  }
  const upTo = Math.min(sequence ?? conversation.lastSequence, conversation.lastSequence);
  return ok({ ...state, readStates: setRead(state.readStates, conversationId, actorId, upTo) });
}

export function unreadCount(state: SocialState, userId: SocialUserId, conversationId: string): number {
  const conversation = conversationById(state, conversationId);
  if (conversation === undefined || !conversation.memberIds.includes(userId)) return 0;
  const read = state.readStates.find((r) => r.conversationId === conversationId && r.userId === userId)?.lastReadSequence ?? 0;
  // Messages from somebody this reader muted for messages, or blocked, do not count as unread.
  return messagesOf(state, conversationId).filter(
    (m) => m.sequence > read && m.senderId !== userId && !isMuted(state, userId, m.senderId, 'messages') && !blockedEitherWay(state, userId, m.senderId),
  ).length;
}

export interface ConversationSummary {
  readonly conversationId: string;
  readonly kind: Conversation['kind'];
  readonly title: string;
  /** For a DIRECT conversation, the other person (the surface draws their presence through resolvePresenceFor). */
  readonly otherUserId: SocialUserId | null;
  readonly lastMessagePreview: string | null;
  readonly lastMessageAtIso: string | null;
  readonly unread: number;
}

/** The Messages tab: newest first, with unread counts. Never a DIRECT conversation across a block (ruling (b)). */
export function conversationsFor(state: SocialState, userId: SocialUserId): ConversationSummary[] {
  return Object.values(state.conversations)
    .filter((c) => c.memberIds.includes(userId) && !isWalledDirect(state, c, userId))
    .map((c) => {
      const other = c.kind === 'DIRECT' ? (c.memberIds.find((id) => id !== userId) ?? null) : null;
      const last = messagesOf(state, c.conversationId).at(-1);
      return {
        conversationId: c.conversationId,
        kind: c.kind,
        title: c.title ?? (other !== null ? (userById(state, other)?.profile.displayName ?? other) : 'Conversation'),
        otherUserId: other,
        lastMessagePreview: last === undefined ? null : last.kind === 'TEXT' ? last.body.slice(0, 80) : last.kind === 'PARTY_INVITE' ? 'Party invite' : last.kind === 'SERVER_INVITE' ? 'Server invite' : last.body.slice(0, 80),
        lastMessageAtIso: c.lastMessageAtIso,
        unread: unreadCount(state, userId, c.conversationId),
      };
    })
    .sort((a, b) => ((a.lastMessageAtIso ?? '') < (b.lastMessageAtIso ?? '') ? 1 : (a.lastMessageAtIso ?? '') > (b.lastMessageAtIso ?? '') ? -1 : 0));
}

/** Total unread across conversations: the badge on the Messages tab. */
export const totalUnread = (state: SocialState, userId: SocialUserId): number =>
  conversationsFor(state, userId).reduce((sum, c) => sum + c.unread, 0);
