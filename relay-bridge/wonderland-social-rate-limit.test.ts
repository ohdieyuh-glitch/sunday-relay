import { describe, expect, it } from 'vitest';

import {
  createWonderlandCommandLimiter, WONDERLAND_COMMAND_LIMITS, wonderlandCommandBuckets,
} from './wonderland-social-rate-limit';

/**
 * PER-PLAYER COMMAND BUDGETS, ON A CLOCK THE TEST HOLDS. Every boundary is
 * reached exactly: the last admitted command, the first refused, and the
 * instant a token comes back.
 */

const T0 = 1_000_000;
const takeN = (limiter: ReturnType<typeof createWonderlandCommandLimiter>, player: string, kind: string, n: number, at = T0) =>
  Array.from({ length: n }, () => limiter.take(player, kind, at));

describe('the buckets a command draws on', () => {
  it('every command draws on all; a message also on message; what lands on another player also on invitation', () => {
    expect(wonderlandCommandBuckets('ENTER_INSTANCE')).toEqual(['all']);
    expect(wonderlandCommandBuckets('UPDATE_PRESENCE')).toEqual(['all']);
    expect(wonderlandCommandBuckets('BLOCK')).toEqual(['all']);
    expect(wonderlandCommandBuckets('SEND_MESSAGE')).toEqual(['all', 'message']);
    for (const kind of ['FRIEND_REQUEST', 'PARTY_INVITE', 'SERVER_INVITE']) expect(wonderlandCommandBuckets(kind)).toEqual(['all', 'invitation']);
  });

  it('the limits are a person\'s and not a script\'s, and a client\'s own heartbeat is a small part of them', () => {
    expect(WONDERLAND_COMMAND_LIMITS).toEqual({
      all: { capacity: 60, intervalMs: 1_000 },
      message: { capacity: 20, intervalMs: 3_000 },
      invitation: { capacity: 10, intervalMs: 30_000 },
    });
    // One presence refresh every 30 s is one token in thirty of what the all bucket returns.
    expect(30_000 / WONDERLAND_COMMAND_LIMITS.all.intervalMs).toBeGreaterThanOrEqual(30);
  });
});

describe('one player\'s budget', () => {
  it('a burst of sixty, the sixty-first refused for one second, then one more per second', () => {
    const limiter = createWonderlandCommandLimiter();
    expect(takeN(limiter, 'ann', 'ENTER_INSTANCE', 60).every((verdict) => verdict.allowed)).toBe(true);
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0)).toEqual({ allowed: false, bucket: 'all', retryAfterSeconds: 1 });
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0 + 999).allowed, 'not a millisecond early').toBe(false);
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0 + 1_000).allowed).toBe(true);
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0 + 1_000).allowed).toBe(false);
  });

  it('twenty messages, then one every three seconds; other commands still pass on what is left of all', () => {
    const limiter = createWonderlandCommandLimiter();
    expect(takeN(limiter, 'ann', 'SEND_MESSAGE', 20).every((verdict) => verdict.allowed)).toBe(true);
    expect(limiter.take('ann', 'SEND_MESSAGE', T0)).toEqual({ allowed: false, bucket: 'message', retryAfterSeconds: 3 });
    expect(limiter.take('ann', 'BLOCK', T0).allowed, 'a block is never held behind a message budget').toBe(true);
    expect(limiter.take('ann', 'SEND_MESSAGE', T0 + 3_000).allowed).toBe(true);
  });

  it('ten invitations, then one every thirty seconds, to the millisecond, however the wait is read', () => {
    const limiter = createWonderlandCommandLimiter();
    const kinds = ['FRIEND_REQUEST', 'PARTY_INVITE', 'SERVER_INVITE'];
    expect(Array.from({ length: 10 }, (_, i) => limiter.take('ann', kinds[i % 3]!, T0).allowed).every(Boolean)).toBe(true);
    expect(limiter.take('ann', 'PARTY_INVITE', T0)).toEqual({ allowed: false, bucket: 'invitation', retryAfterSeconds: 30 });
    // Read at 29.999 s, then at 30 s: a fractional refill summed across the two reads once fell short of a token here.
    expect(limiter.take('ann', 'FRIEND_REQUEST', T0 + 29_999).allowed).toBe(false);
    expect(limiter.take('ann', 'FRIEND_REQUEST', T0 + 30_000).allowed).toBe(true);
    expect(limiter.take('ann', 'FRIEND_REQUEST', T0 + 30_000).allowed).toBe(false);
  });

  it('a refused command takes nothing: knocking does not dig the wait deeper', () => {
    const limiter = createWonderlandCommandLimiter();
    takeN(limiter, 'ann', 'SEND_MESSAGE', 20);
    // A hundred refused messages: the all bucket still holds exactly the forty the twenty admitted ones left.
    expect(takeN(limiter, 'ann', 'SEND_MESSAGE', 100).some((verdict) => verdict.allowed)).toBe(false);
    expect(takeN(limiter, 'ann', 'ENTER_INSTANCE', 40).every((verdict) => verdict.allowed)).toBe(true);
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0).allowed).toBe(false);
  });

  it('when both buckets a command draws on are short, the wait named is the longer one', () => {
    const limiter = createWonderlandCommandLimiter();
    takeN(limiter, 'ann', 'SEND_MESSAGE', 20);
    takeN(limiter, 'ann', 'ENTER_INSTANCE', 40);
    expect(limiter.take('ann', 'SEND_MESSAGE', T0)).toEqual({ allowed: false, bucket: 'message', retryAfterSeconds: 3 });
  });
});

describe('everyone else, the clock, and memory', () => {
  it('one player\'s flood leaves every other player untouched', () => {
    const limiter = createWonderlandCommandLimiter();
    takeN(limiter, 'ann', 'SEND_MESSAGE', 200);
    expect(takeN(limiter, 'ben', 'SEND_MESSAGE', 20).every((verdict) => verdict.allowed)).toBe(true);
  });

  it('a clock that steps backwards refills nothing and locks nobody out', () => {
    const limiter = createWonderlandCommandLimiter();
    takeN(limiter, 'ann', 'ENTER_INSTANCE', 60);
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0 - 60_000).allowed, 'a backwards step is not time passing').toBe(false);
    // Ten seconds return ten tokens; one is spent. A step back of a minute must not take the other nine away (a
    // budget read against the stepped-back clock would refuse for the next 52 s).
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0 + 10_000).allowed).toBe(true);
    expect(takeN(limiter, 'ann', 'ENTER_INSTANCE', 9, T0 - 50_000).every((verdict) => verdict.allowed), 'no lockout').toBe(true);
    expect(limiter.take('ann', 'ENTER_INSTANCE', T0 - 50_000).allowed, 'and no token from nowhere').toBe(false);
  });

  it('memory is bounded: past the cap, the player seen least recently is forgotten and starts full again', () => {
    const limiter = createWonderlandCommandLimiter(WONDERLAND_COMMAND_LIMITS, 2);
    takeN(limiter, 'ann', 'SEND_MESSAGE', 20);
    takeN(limiter, 'ben', 'SEND_MESSAGE', 20);
    expect(limiter.take('ann', 'SEND_MESSAGE', T0).allowed, 'ann is seen again, so ben is now the oldest').toBe(false);
    limiter.take('cal', 'BLOCK', T0); // the third player: ben, the oldest, is forgotten
    expect(limiter.take('ann', 'SEND_MESSAGE', T0).allowed, 'ann is still remembered').toBe(false);
    expect(limiter.take('ben', 'SEND_MESSAGE', T0).allowed, 'ben was forgotten, and starts full').toBe(true);
  });
});
