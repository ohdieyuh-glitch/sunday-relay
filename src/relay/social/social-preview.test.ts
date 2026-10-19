import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEVER_SOCIAL_CONCERNS } from './social-contracts';
import { FIXTURE_USERS as U } from './social-fixtures';
import { buildSocialPartyPreview, buildSocialPreview, serializeSocialPreview } from './social-preview';

const FILE = join(__dirname, '..', '..', '..', 'wonderland', 'UiArt', 'Social', 'social-preview.json');
const PARTY_FILE = join(__dirname, '..', '..', '..', 'wonderland', 'UiArt', 'Social', 'social-preview-party.json');

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe('the development preview the desktop client renders', () => {
  it('is exactly what the authority generates today (regenerate with tools/write-social-preview.ts)', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(serializeSocialPreview(buildSocialPreview()));
  });

  it('says it is a preview, and carries nothing the social layer may never carry', () => {
    const snapshot = buildSocialPreview();
    expect(snapshot.developmentPreview).toBe(true);
    const keys = allKeys(snapshot);
    for (const forbidden of NEVER_SOCIAL_CONCERNS) expect(keys.has(forbidden)).toBe(false);
  });

  it('omits the profile of somebody who blocked the viewer, and hides the private server it may not see', () => {
    const snapshot = buildSocialPreview();
    expect(snapshot.profiles[U.MIRA]).toBeUndefined();
    expect(snapshot.friends.find((f) => f.userId === U.RHEA)?.presence.location).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("Rhea's Lab");
  });

  it('has the inbox, the open party, the unread conversation and every voice state for the panels to draw', () => {
    const snapshot = buildSocialPreview();
    expect(snapshot.requests.incoming.map((r) => r.from.userId)).toEqual([U.VEGA]);
    expect(snapshot.partyInvites.map((i) => i.fromUserId)).toEqual([U.RHEA]);
    expect(snapshot.visibleParties.map((p) => p.name)).toEqual(['Arena Run']);
    expect(snapshot.conversations[0].unread).toBe(2);
    expect(snapshot.voiceStates.map((v) => v.state.connection)).toEqual(['UNAVAILABLE', 'CONNECTING', 'CONNECTED', 'CONNECTED', 'RECONNECTING', 'FAILED']);
    expect(snapshot.self.profile.progression).toEqual({ source: 'PENDING', rank: null, level: null });
  });

  it('has a second scene, written beside it, with the viewer in the party they were invited to', () => {
    expect(readFileSync(PARTY_FILE, 'utf8')).toBe(serializeSocialPreview(buildSocialPartyPreview()));
    const snapshot = buildSocialPartyPreview();
    expect(snapshot.developmentPreview).toBe(true);
    expect(snapshot.party?.name).toBe('Lab Crew');
    expect(snapshot.party?.viewerIsMember).toBe(true);
    expect(snapshot.party?.viewerIsLeader).toBe(false);
    expect(snapshot.party?.members.map((m) => m.userId).sort()).toEqual([U.KAI, U.RHEA].sort());
    expect(snapshot.partyInvites).toEqual([]);
    const keys = allKeys(snapshot);
    for (const forbidden of NEVER_SOCIAL_CONCERNS) expect(keys.has(forbidden)).toBe(false);
  });
});
