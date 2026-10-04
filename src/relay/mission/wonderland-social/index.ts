/**
 * WONDERLAND SOCIAL — the barrel.
 *
 * Friends, blocks, parties, private servers, presence, Recent Players and direct
 * messages, with the privacy wall (P1–P5, party, DM, no inference) as one set of
 * projections over one durable state. Decide once (`decideWonderlandSocialCommand`),
 * apply the same mutations in every store.
 *
 * Not re-exported through the mission barrel, for the reason the other
 * Wonderland modules are not.
 */

export * from './social-contracts';
export * from './social-relations';
export * from './social-commands';
export * from './social-privacy';
export * from './social-store';
