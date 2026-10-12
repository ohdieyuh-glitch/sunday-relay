import { describe, expect, it } from 'vitest';
import { openPrivateServer, privateServerAccess, PRIVATE_SERVER_POLICY } from './private-server-lifecycle';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { partyOf, type SocialState } from './social-state';
import { contextOf, emptyWorldState, type PrivateServerGate } from './world-presence';

/*
 * NO CONTROL CHARACTER IN ANYTHING A PLAYER WRITES FOR OTHER PLAYERS TO READ (CORE, 10-07: the log-injection finding).
 *
 * The clients write some of these strings into their logs exactly as the server sent them: a party name in "WLSOCIAL live
 * snapshot" and in the hub's description, a private server's name in "WLWORLD joined", a message body in the QA harness's
 * WLSOCIALLIVE evidence lines. A line break in one of them FORGES a log line. So every field a player writes for others is
 * refused, as validation-failed, when it holds a C0 control (U+0000-U+001F), DEL (U+007F) or U+2028 / U+2029, wherever the
 * character sits (a trailing one is refused, not trimmed away); ordinary text in any script still passes, kept as written.
 *
 * Every character below is BUILT from its code point. This file writes none of them, and no escape for any of them, so no
 * editor or tool can turn an escape into the raw character (a raw U+2028 is invisible in a review).
 */

const NOW = '2026-10-07T18:00:00.000Z';

type Outcome = { ok: true; value: SocialCommandOutcome } | { ok: false; error: { code: string; message: string } };
const op = (s: SocialState, actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown>, ids: string[] = [], gate: PrivateServerGate | null = null): Outcome =>
  applySocialOperation(s, name, actor, { ids, body, query: {} }, NOW, emptyWorldState(), gate) as Outcome;

/**
 * Migration 037: an owner enters their private server only by the store's read of it (fail closed). Kai has no record yet (READY),
 * so this read OPENS it, a Free window from NOW, under the name asked for: every refusal of that field below is the name's
 * (validation-failed), never a closed server's (illegal-transition), and the ordinary name is let in.
 */
const kaiOpens = (name: string): PrivateServerGate => {
  const nowMs = Date.parse(NOW);
  return { ownerId: U.KAI, access: privateServerAccess(null, null, PRIVATE_SERVER_POLICY, nowMs), open: openPrivateServer(null, null, PRIVATE_SERVER_POLICY, U.KAI, name, nowMs) };
};

/** One of each kind: NUL, SOH, TAB, LF, VT, CR, ESC, the last C0 (U+001F), DEL, and the line and paragraph separators. */
const CONTROLS = [0x00, 0x01, 0x09, 0x0a, 0x0b, 0x0d, 0x1b, 0x1f, 0x7f, 0x2028, 0x2029];
const nameOf = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
/** Inside a short name (what a forged log line needs), and at its end (where a trim would have hidden it). */
const PLACES: ReadonlyArray<readonly [string, (c: string) => string]> = [
  ['inside', (c) => `Den${c}LSQ9 PASS`],
  ['at the end', (c) => `Den${c}`],
];
/** Ordinary text: accented Latin, CJK and an emoji (a surrogate pair, whose two code units are not controls). */
const UNICODE = `Ünïcødé 名前 ${String.fromCodePoint(0x1f415)}`;

const dmOf = (s: SocialState) =>
  Object.values(s.conversations).find((c) => c.kind === 'DIRECT' && c.memberIds.includes(U.KAI) && c.memberIds.includes(U.NOVA))!.conversationId;
const lastBody = (s: SocialState) => {
  const history = s.messages[dmOf(s)] ?? [];
  return history.length === 0 ? undefined : history[history.length - 1].body;
};
const place = (fields: Record<string, string>) => ({ serverId: 'srv_kai_den', serverKind: 'PUBLIC_WORLD', serverName: 'Den', ...fields });

/** LFF (social-lff.ts): a post by `owner`, made through the dispatcher, for an edit or a request to carry the text. */
const lffPost = (s: SocialState, owner: string): { state: SocialState; postId: string } => {
  const o = op(s, owner, 'lff.post.create', { category: 'TEAMS', title: 'Squad', openSlots: 2 });
  if (!o.ok) throw new Error(`the LFF post was not made: ${o.error.message}`);
  return { state: o.value.state, postId: (o.value.data as { postId: string }).postId };
};
const lastLffPost = (s: SocialState) => s.lffPosts[s.lffPosts.length - 1];
const lffCreate = (s: SocialState, fields: Record<string, unknown>) => op(s, U.KAI, 'lff.post.create', { category: 'TEAMS', title: 'Squad', openSlots: 1, ...fields });

interface Field {
  readonly name: string;
  /** The operation that carries the field, with `text` in it. */
  readonly send: (s: SocialState, text: string) => Outcome;
  /** Where an accepted text is kept. */
  readonly kept: (outcome: SocialCommandOutcome) => string | null | undefined;
}

const FIELDS: readonly Field[] = [
  {
    name: 'parties.create name',
    send: (s, text) => op(s, U.KAI, 'parties.create', { name: text }),
    kept: (o) => partyOf(o.state, U.KAI)?.name,
  },
  {
    name: 'parties.rules name',
    send: (s, text) => op(s, U.ORION, 'parties.rules', { name: text }, [partyOf(s, U.ORION)!.partyId]),
    kept: (o) => partyOf(o.state, U.ORION)?.name,
  },
  {
    name: 'world.join PRIVATE name',
    send: (s, text) => op(s, U.KAI, 'world.join', { target: 'PRIVATE', name: text }, [], kaiOpens(text)),
    kept: (o) => (o.world === undefined ? undefined : contextOf(o.world, U.KAI)?.serverName),
  },
  {
    name: 'presence.update_self activityDetail',
    send: (s, text) => op(s, U.KAI, 'presence.update_self', { activityDetail: text }),
    kept: (o) => o.state.users[U.KAI].presence.activityDetail,
  },
  {
    name: 'presence.update_self location.serverName',
    send: (s, text) => op(s, U.KAI, 'presence.update_self', { location: place({ serverName: text }) }),
    kept: (o) => o.state.users[U.KAI].presence.location?.serverName,
  },
  {
    name: 'presence.update_self location.placeLabel',
    send: (s, text) => op(s, U.KAI, 'presence.update_self', { location: place({ placeLabel: text }) }),
    kept: (o) => o.state.users[U.KAI].presence.location?.placeLabel,
  },
  {
    name: 'presence.update_self location.serverId',
    send: (s, text) => op(s, U.KAI, 'presence.update_self', { location: place({ serverId: text }) }),
    kept: (o) => o.state.users[U.KAI].presence.location?.serverId,
  },
  {
    name: 'messages.send body',
    send: (s, text) => op(s, U.KAI, 'messages.send', { body: text }, [dmOf(s)]),
    kept: (o) => lastBody(o.state),
  },
  // LFF (the Looking For Feed): every text a player writes on a post or a request reaches other players' clients
  {
    name: 'lff.post.create title',
    send: (s, text) => lffCreate(s, { title: text }),
    kept: (o) => lastLffPost(o.state)?.title,
  },
  {
    name: 'lff.post.create description',
    send: (s, text) => lffCreate(s, { description: text }),
    kept: (o) => lastLffPost(o.state)?.description,
  },
  {
    name: 'lff.post.create projectLabel',
    send: (s, text) => lffCreate(s, { projectLabel: text }),
    kept: (o) => lastLffPost(o.state)?.projectLabel,
  },
  {
    name: 'lff.post.create skills item',
    send: (s, text) => lffCreate(s, { skills: ['UE5', text] }),
    kept: (o) => lastLffPost(o.state)?.skills[1],
  },
  {
    name: 'lff.post.edit title',
    send: (s, text) => {
      const p = lffPost(s, U.KAI);
      return op(p.state, U.KAI, 'lff.post.edit', { title: text }, [p.postId]);
    },
    kept: (o) => lastLffPost(o.state)?.title,
  },
  {
    name: 'lff.request.create message',
    send: (s, text) => {
      const p = lffPost(s, U.NOVA);
      return op(p.state, U.KAI, 'lff.request.create', { message: text }, [p.postId]);
    },
    kept: (o) => o.state.lffRequests[o.state.lffRequests.length - 1]?.message,
  },
];

describe('10-07 log injection: a control character in anything a player writes for others is refused', () => {
  for (const field of FIELDS) {
    it(`${field.name}: refused as validation-failed for every control character, inside the text or at its end`, () => {
      const s = createSocialFixture();
      for (const code of CONTROLS) {
        for (const [where, put] of PLACES) {
          const r = field.send(s, put(String.fromCharCode(code)));
          const label = `${field.name}, ${nameOf(code)} ${where}`;
          expect(r.ok, label).toBe(false);
          if (!r.ok) expect(r.error.code, label).toBe('validation-failed');
        }
      }
    });
  }

  it('control: ordinary Unicode passes every one of those fields, and is kept exactly as written', () => {
    for (const field of FIELDS) {
      const r = field.send(createSocialFixture(), UNICODE);
      expect(r.ok, field.name).toBe(true);
      if (r.ok) expect(field.kept(r.value), field.name).toBe(UNICODE);
    }
  });
});
