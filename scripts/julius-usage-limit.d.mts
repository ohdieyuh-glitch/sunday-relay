/**
 * Type declarations for the one recogniser of the Claude subscription's usage-limit sentence (audit F5).
 *
 * Plain `.mjs` so the paid workflow's smoke runs it with `node` and no build step; the live coder's classifier and the
 * tests import the same function.
 */

/** Whether `text` reports that the subscription's own usage limit was reached. Returns a boolean, never the text. */
export declare function isSubscriptionUsageLimit(text: unknown): boolean;
