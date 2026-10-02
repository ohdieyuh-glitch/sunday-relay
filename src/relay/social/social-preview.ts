/**
 * WONDERLAND SOCIAL — the DEVELOPMENT PREVIEW snapshot the Unreal client renders before a social service is connected.
 *
 * WHY A SNAPSHOT AND NOT A C++ COPY OF THE RULES. The presence authority is this TypeScript domain. If the desktop client
 * re-implemented privacy to show a preview, there would be two authorities, and the first time they disagreed the preview
 * would show somebody's private server. So the client never decides anything: it renders VIEWS -- the same shapes the
 * Relay Bridge will return over the social capability -- and this module produces those views from the fixture cast, as one
 * viewer (Kai) sees them, through the real resolvers.
 *
 * The output is written to wonderland/UiArt/Social/social-preview.json (staged NonUFS with the rest of UiArt) by
 * scripts/social/write-social-preview.ts, and social-preview.test.ts fails if the committed file ever differs from a fresh
 * generation -- the preview cannot drift from the authority.
 */

import type { ConversationSummary } from './social-conversations';
import { conversationsFor } from './social-conversations';
import type {
  Message,
  PartyInvite,
  PartyVoiceState,
  RecentPlayerEntry,
  SocialUserId,
  UserPresenceView,
  UserProfileView,
} from './social-contracts';
import { FIXTURE_NOW, FIXTURE_USERS, createSocialFixture } from './social-fixtures';
import { pendingRequestsFor, recentPlayersFor } from './social-friends';
import { acceptPartyInvite, partyInvitesFor, partyViewFor, type PartyView } from './social-parties';
import { resolvePresenceFor, resolveProfileFor } from './social-presence';
import { friendIdsOf, partyOf, type SocialState } from './social-state';
import { createLocalVoiceHarness, createUnavailableVoiceService } from './social-voice';

export const SOCIAL_PREVIEW_SCHEMA = 'relay-wonderland-social-preview.v1' as const;
/** The same view, live: made by the server for a signed-in player (snapshot.read). Never a preview, never synthetic. */
export const SOCIAL_VIEW_SCHEMA = 'relay-wonderland-social-view.v1' as const;

/** A person as a list row: who they are, and their presence as the viewer may see it. */
export interface SocialPersonRow {
  readonly userId: SocialUserId;
  readonly displayName: string;
  readonly handle: string;
  readonly avatarRef: string;
  readonly presence: UserPresenceView;
}

export interface SocialPreviewSnapshot {
  readonly schema: typeof SOCIAL_PREVIEW_SCHEMA | typeof SOCIAL_VIEW_SCHEMA;
  /** True for the generated preview (said on every surface that draws it); false for a live view. */
  readonly developmentPreview: boolean;
  readonly note: string;
  readonly viewerId: SocialUserId;
  readonly generatedAtIso: string;
  readonly self: UserProfileView;
  readonly friends: readonly SocialPersonRow[];
  readonly requests: { readonly incoming: readonly { requestId: string; from: SocialPersonRow }[]; readonly outgoing: readonly { requestId: string; to: SocialPersonRow }[] };
  readonly recentPlayers: readonly (RecentPlayerEntry & { person: SocialPersonRow })[];
  readonly conversations: readonly ConversationSummary[];
  readonly messages: Readonly<Record<string, readonly Message[]>>;
  readonly party: PartyView | null;
  readonly visibleParties: readonly PartyView[];
  /** Invites to the viewer: an invitee sees the inviting party's name and who invited them, and nothing else of it. */
  readonly partyInvites: readonly (PartyInvite & { partyName: string; from: SocialPersonRow })[];
  /** Every profile the viewer may open, keyed by user id. A person the viewer may not see is absent, not redacted. */
  readonly profiles: Readonly<Record<SocialUserId, UserProfileView>>;
  /** The voice panel's states, in order, for review: what a build without a provider shows, then a scripted session. */
  readonly voiceStates: readonly { readonly label: string; readonly state: PartyVoiceState }[];
}

function row(state: SocialState, viewerId: SocialUserId, userId: SocialUserId): SocialPersonRow | null {
  const user = state.users[userId];
  const presence = resolvePresenceFor(state, viewerId, userId);
  if (user === undefined || presence === null) return null;
  return { userId, displayName: user.profile.displayName, handle: user.profile.handle, avatarRef: user.profile.avatarRef, presence };
}

const ONLINE_ORDER: Record<UserPresenceView['onlineState'], number> = { ONLINE: 0, BUSY: 1, AWAY: 2, OFFLINE: 3 };

/** THE PREVIEW: the fixture's synthetic people and the scripted voice states, said to be a preview on its face. */
export function buildSocialPreview(state: SocialState = createSocialFixture(), viewerId: SocialUserId = FIXTURE_USERS.KAI, nowIso = FIXTURE_NOW): SocialPreviewSnapshot {
  return buildSocialView(state, viewerId, nowIso, { developmentPreview: true });
}

export interface SocialViewOptions {
  readonly developmentPreview: boolean;
}

/**
 * ONE VIEW FOR ONE VIEWER, preview or live (snapshot.read): the same shape either way, so the client draws a live snapshot
 * with the code it draws the preview with. Live there is no note and no scripted voice -- the client's own voice provider
 * reports voice.
 */
export function buildSocialView(state: SocialState, viewerId: SocialUserId, nowIso: string, options: SocialViewOptions): SocialPreviewSnapshot {
  const self = resolveProfileFor(state, viewerId, viewerId);
  if (self === null) throw new Error('the viewer has no profile');
  const friends = friendIdsOf(state, viewerId)
    .map((id) => row(state, viewerId, id))
    .filter((r): r is SocialPersonRow => r !== null)
    .sort((a, b) => ONLINE_ORDER[a.presence.onlineState] - ONLINE_ORDER[b.presence.onlineState] || a.displayName.localeCompare(b.displayName));
  const pending = pendingRequestsFor(state, viewerId);
  const conversations = conversationsFor(state, viewerId);
  const visibleParties = Object.keys(state.parties)
    .map((id) => partyViewFor(state, viewerId, id))
    .filter((p): p is PartyView => p !== null && !p.viewerIsMember);
  const mine = partyOf(state, viewerId);
  const profiles: Record<SocialUserId, UserProfileView> = {};
  for (const userId of Object.keys(state.users).sort()) {
    const view = resolveProfileFor(state, viewerId, userId);
    if (view !== null) profiles[userId] = view;
  }

  return {
    schema: options.developmentPreview ? SOCIAL_PREVIEW_SCHEMA : SOCIAL_VIEW_SCHEMA,
    developmentPreview: options.developmentPreview,
    note: options.developmentPreview
      ? 'DEVELOPMENT PREVIEW -- synthetic people from src/relay/social/social-fixtures.ts, resolved by the real presence authority. Not connected to anybody.'
      : '',
    viewerId,
    generatedAtIso: nowIso,
    self,
    friends,
    requests: {
      incoming: pending.incoming.map((r) => ({ requestId: r.requestId, from: row(state, viewerId, r.fromUserId)! })).filter((r) => r.from !== null),
      outgoing: pending.outgoing.map((r) => ({ requestId: r.requestId, to: row(state, viewerId, r.toUserId)! })).filter((r) => r.to !== null),
    },
    recentPlayers: recentPlayersFor(state, viewerId)
      .map((e) => ({ ...e, person: row(state, viewerId, e.userId)! }))
      .filter((e) => e.person !== null),
    conversations,
    messages: Object.fromEntries(conversations.map((c) => [c.conversationId, state.messages[c.conversationId] ?? []])),
    party: mine !== undefined ? partyViewFor(state, viewerId, mine.partyId) : null,
    visibleParties,
    partyInvites: partyInvitesFor(state, viewerId, nowIso)
      .map((i) => ({ ...i, partyName: state.parties[i.partyId]?.name ?? 'Party', from: row(state, viewerId, i.fromUserId)! }))
      .filter((i) => i.from !== null),
    profiles,
    voiceStates: options.developmentPreview ? scriptedVoiceStates(viewerId) : [],
  };
}

/** THE VOICE PANEL'S STATES (preview only): no provider first (what the beta truly is), then a scripted session through the harness. */
function scriptedVoiceStates(viewerId: SocialUserId): { label: string; state: PartyVoiceState }[] {
  const voiceStates: { label: string; state: PartyVoiceState }[] = [{ label: 'no provider configured', state: createUnavailableVoiceService().getState() }];
  const harness = createLocalVoiceHarness(viewerId);
  const capture = (label: string) => voiceStates.push({ label, state: harness.getState() });
  harness.connect('pty_preview', [FIXTURE_USERS.NOVA, FIXTURE_USERS.ORION]);
  capture('connecting');
  harness.emit({ kind: 'connected' });
  harness.emit({ kind: 'member-joined', userId: FIXTURE_USERS.NOVA });
  harness.emit({ kind: 'member-joined', userId: FIXTURE_USERS.ORION });
  harness.emit({ kind: 'speaking', userId: FIXTURE_USERS.NOVA, speaking: true });
  capture('connected, Nova speaking');
  harness.setLocallyMuted(FIXTURE_USERS.ORION, true);
  harness.setMicMuted(true);
  capture('self muted, Orion muted locally');
  harness.emit({ kind: 'connection', state: 'RECONNECTING', detail: 'network changed' });
  capture('reconnecting');
  harness.emit({ kind: 'connection', state: 'FAILED', detail: 'provider refused' });
  capture('failed');
  return voiceStates;
}

/**
 * THE SAME PREVIEW WITH THE VIEWER IN A PARTY: the fixture's pending Lab Crew invitation, accepted through the real party
 * rules, so the client's party and voice panels have a party of the viewer's own to draw (its members, its leader, its
 * rules). Written beside the first as social-preview-party.json; still synthetic people, still a DEVELOPMENT PREVIEW.
 */
export function buildSocialPartyPreview(): SocialPreviewSnapshot {
  const state = createSocialFixture();
  const invite = partyInvitesFor(state, FIXTURE_USERS.KAI, FIXTURE_NOW)[0];
  if (invite === undefined) throw new Error('the fixture has no party invitation for the viewer');
  const accepted = acceptPartyInvite(state, FIXTURE_USERS.KAI, invite.inviteId, FIXTURE_NOW);
  if (!accepted.ok) throw new Error(`the fixture's invitation did not accept: ${accepted.error.message}`);
  return buildSocialPreview(accepted.value, FIXTURE_USERS.KAI, FIXTURE_NOW);
}

/** The file as written: stable key order and a trailing newline, so a regeneration is byte-identical. */
export function serializeSocialPreview(snapshot: SocialPreviewSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
