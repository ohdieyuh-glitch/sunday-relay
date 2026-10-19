/**
 * WONDERLAND SOCIAL — party voice, separated from whoever carries the audio.
 *
 * FOUNDER: "Architect the UI separately from the underlying voice provider so Wonderland is not permanently coupled to one
 * voice backend … Do NOT fake production voice transport. If a real voice backend is not configured yet: build the complete
 * UI/state architecture and deterministic local test harness, but explicitly label transport integration as pending."
 *
 * So the UI consumes ONE thing, `PartyVoiceState` (social-contracts.ts), from ONE interface, `IPartyVoiceService`. A real
 * provider (LiveKit, Vivox, EOS Voice … a founder decision, with its credentials) implements the interface later. Until then:
 *   - `createUnavailableVoiceService` is what a build with no provider uses: connection UNAVAILABLE, providerId null, every
 *     command refused with the reason -- the panel says VOICE TRANSPORT PENDING;
 *   - `createLocalVoiceHarness` is a DETERMINISTIC script for QA and design: it moves through the same states a provider
 *     would, from scripted events, and says on its face (providerId "local-harness") that it is not a transport.
 */

import type { PartyVoiceState, SocialUserId, VoiceConnectionState, VoiceParticipantState } from './social-contracts';

export type VoiceListener = (state: PartyVoiceState) => void;

export interface VoiceCommandResult {
  readonly ok: boolean;
  /** Why a command was refused: "VOICE TRANSPORT PENDING", "not connected" … */
  readonly reason: string | null;
}

/** What the party voice UI calls and listens to. Nothing else about voice reaches the UI. */
export interface IPartyVoiceService {
  readonly providerId: string | null;
  getState(): PartyVoiceState;
  subscribe(listener: VoiceListener): () => void;
  connect(partyId: string, memberIds: readonly SocialUserId[]): VoiceCommandResult;
  /** LEAVE VOICE: the party is kept; only the voice channel is left. */
  disconnect(): VoiceCommandResult;
  setMicMuted(muted: boolean): VoiceCommandResult;
  /** LOCAL mute of another member: only this listener stops hearing them. */
  setLocallyMuted(userId: SocialUserId, muted: boolean): VoiceCommandResult;
}

export const VOICE_TRANSPORT_PENDING = 'VOICE TRANSPORT PENDING';

/** The honest service of a build with no voice provider. */
export function createUnavailableVoiceService(): IPartyVoiceService {
  const state: PartyVoiceState = Object.freeze({ partyId: null, connection: 'UNAVAILABLE', providerId: null, participants: [], detail: VOICE_TRANSPORT_PENDING });
  const refuse = (): VoiceCommandResult => ({ ok: false, reason: VOICE_TRANSPORT_PENDING });
  return {
    providerId: null,
    getState: () => state,
    subscribe: (listener) => {
      listener(state);
      return () => undefined;
    },
    connect: refuse,
    disconnect: refuse,
    setMicMuted: refuse,
    setLocallyMuted: refuse,
  };
}

/** A scripted event for the harness: what a provider would report. */
export type VoiceHarnessEvent =
  | { readonly kind: 'connected' }
  | { readonly kind: 'connection'; readonly state: VoiceConnectionState; readonly detail?: string }
  | { readonly kind: 'member-joined'; readonly userId: SocialUserId }
  | { readonly kind: 'member-left'; readonly userId: SocialUserId }
  | { readonly kind: 'member-mic'; readonly userId: SocialUserId; readonly muted: boolean }
  | { readonly kind: 'speaking'; readonly userId: SocialUserId; readonly speaking: boolean };

export interface LocalVoiceHarness extends IPartyVoiceService {
  /** Feed one provider event. Deterministic: the same events in the same order give the same states. */
  emit(event: VoiceHarnessEvent): void;
}

/**
 * THE DETERMINISTIC HARNESS. `connect` moves to CONNECTING (a provider would then report CONNECTED; the harness waits for an
 * emitted `connected`). Speaking is only ever shown for a connected member whose mic is open and who is not locally muted --
 * the same rule a real provider's speaking flags will be held to.
 */
export function createLocalVoiceHarness(selfId: SocialUserId): LocalVoiceHarness {
  let partyId: string | null = null;
  let connection: VoiceConnectionState = 'DISCONNECTED';
  let detail: string | null = null;
  let participants = new Map<SocialUserId, VoiceParticipantState>();
  const locallyMuted = new Set<SocialUserId>();
  const listeners = new Set<VoiceListener>();

  const snapshot = (): PartyVoiceState => ({
    partyId,
    connection,
    providerId: 'local-harness',
    detail,
    participants: [...participants.values()]
      .map((p) => {
        const mutedLocally = locallyMuted.has(p.userId);
        const connected = connection === 'CONNECTED' && p.connected;
        return { ...p, connected, mutedLocally, speaking: connected && p.speaking && !p.micMuted && !mutedLocally };
      })
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)),
  });
  const publish = () => {
    const s = snapshot();
    for (const listener of listeners) listener(s);
  };
  const member = (userId: SocialUserId): VoiceParticipantState =>
    participants.get(userId) ?? { userId, connected: false, micMuted: false, speaking: false, mutedLocally: false };
  const notConnected = (): VoiceCommandResult => ({ ok: false, reason: 'not connected' });

  return {
    providerId: 'local-harness',
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    connect(id, memberIds) {
      partyId = id;
      connection = 'CONNECTING';
      detail = null;
      participants = new Map(
        [...new Set([selfId, ...memberIds])].map((u) => [u, { userId: u, connected: u === selfId, micMuted: false, speaking: false, mutedLocally: false }]),
      );
      publish();
      return { ok: true, reason: null };
    },
    disconnect() {
      if (connection === 'DISCONNECTED') return notConnected();
      connection = 'DISCONNECTED';
      detail = null;
      partyId = null;
      participants = new Map();
      publish();
      return { ok: true, reason: null };
    },
    setMicMuted(muted) {
      if (connection !== 'CONNECTED') return notConnected();
      participants.set(selfId, { ...member(selfId), micMuted: muted, speaking: muted ? false : member(selfId).speaking });
      publish();
      return { ok: true, reason: null };
    },
    setLocallyMuted(userId, muted) {
      if (userId === selfId) return { ok: false, reason: 'use the microphone mute for yourself' };
      if (muted) locallyMuted.add(userId);
      else locallyMuted.delete(userId);
      publish();
      return { ok: true, reason: null };
    },
    emit(event) {
      // THE AUDIENCE IS THE ROSTER GIVEN TO connect() -- the party view, which the block wall already filtered (and
      // voiceAudienceFor on the server). A provider's event about anybody else is dropped: it can update a member, never
      // ADD one, so a player blocked either way is never heard or seen here, whatever the transport reports. A real new
      // member arrives through the party view and a fresh connect().
      if (event.kind !== 'connected' && event.kind !== 'connection' && !participants.has(event.userId)) return;
      switch (event.kind) {
        case 'connected':
          connection = 'CONNECTED';
          detail = null;
          break;
        case 'connection':
          connection = event.state;
          detail = event.detail ?? null;
          break;
        case 'member-joined':
          participants.set(event.userId, { ...member(event.userId), connected: true });
          break;
        case 'member-left':
          participants.set(event.userId, { ...member(event.userId), connected: false, speaking: false });
          break;
        case 'member-mic':
          participants.set(event.userId, { ...member(event.userId), micMuted: event.muted, speaking: event.muted ? false : member(event.userId).speaking });
          break;
        case 'speaking':
          participants.set(event.userId, { ...member(event.userId), speaking: event.speaking });
          break;
      }
      publish();
    },
  };
}
