import type { DurableKeyValueBacking } from '../durable';
import type { RelayCard } from './card-contracts';
import { restoreCard, validateCard, type CardRestoration } from './card-lifecycle';

/**
 * DURABLE C.A.R.D. PERSISTENCE, on the backing Relay already has.
 *
 * This is deliberately thin. `DurableKeyValueBacking` is the same port the
 * mission store uses, so a card is written wherever missions are written and
 * inherits that durability rather than inventing a second one. What this adds
 * is the card-shaped rules: one card per owner, validate before writing,
 * validate again after reading, and never invent a card that is not there.
 */

const KEY_PREFIX = 'card:';
const keyFor = (ownerId: string): string => `${KEY_PREFIX}${ownerId}`;

export interface CardSaveOk {
  readonly ok: true;
  readonly card: RelayCard;
}
export interface CardSaveFailed {
  readonly ok: false;
  readonly reason: string;
}
export type CardSaveResult = CardSaveOk | CardSaveFailed;

export interface RelayCardStore {
  readonly durability: DurableKeyValueBacking['durability'];
  readonly locationLabel: string;
  save(card: RelayCard): Promise<CardSaveResult>;
  load(ownerId: string): Promise<CardRestoration>;
  clear(ownerId: string): Promise<void>;
}

export function createRelayCardStore(backing: DurableKeyValueBacking): RelayCardStore {
  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,

    async save(card: RelayCard): Promise<CardSaveResult> {
      // VALIDATE BEFORE WRITING. A store that persists whatever it is handed
      // turns one bad write into a permanently unreadable card, and the
      // participant discovers it on their next visit rather than now.
      const v = validateCard(card);
      if (!v.valid) {
        return { ok: false, reason: `refusing to save an invalid card: ${v.problems.join('; ')}` };
      }
      try {
        await backing.putText(keyFor(card.ownerId), JSON.stringify(card));
      } catch (error) {
        // Announce the fact, not the intention: a failed write is reported as
        // a failure, and the caller must not tell anyone the card was saved.
        return { ok: false, reason: `durable write failed: ${String(error)}` };
      }
      return { ok: true, card };
    },

    async load(ownerId: string): Promise<CardRestoration> {
      let raw: string | null;
      try {
        raw = await backing.getText(keyFor(ownerId));
      } catch (error) {
        return { outcome: 'invalid', card: null, detail: `durable read failed: ${String(error)}` };
      }
      if (raw === null) {
        return { outcome: 'no_card', card: null, detail: 'no card is stored for this owner' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Malformed JSON is a corrupt card, and corrupt is not empty. Reporting
        // it as "no card" would send a returning participant to the create flow
        // and quietly lose the configuration they still have.
        return { outcome: 'invalid', card: null, detail: 'stored card is not valid JSON' };
      }
      return restoreCard({ stored: parsed, expectedOwnerId: ownerId });
    },

    async clear(ownerId: string): Promise<void> {
      try {
        await backing.deleteKey(keyFor(ownerId));
      } catch {
        /* nothing to undo; the caller learns the truth on the next load */
      }
    },
  };
}
