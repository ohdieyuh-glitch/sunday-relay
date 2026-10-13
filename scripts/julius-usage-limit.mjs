/**
 * THE SUBSCRIPTION'S USAGE-LIMIT SENTENCE, RECOGNISED IN ONE PLACE (Decision C, audit F5, 2026-10-13).
 *
 * The Coding Agent runs on the founder's Claude subscription, whose limits are a 5-hour window, a weekly allowance,
 * a session and an Opus allowance. The CLI reports reaching one as prose ("Claude AI usage limit reached|<reset>",
 * "5-hour limit reached ∙ resets 3pm"). Two readers need to know it: the paid workflow's subscription smoke
 * (`julius-subscription-check.mjs`, reason USAGE_LIMIT) and the live coder's failure classifier
 * (`relay-bridge/hosted-coding-agent/hosted-failure-reason.ts`, reason `usage_limit_reached`). The smoke knew the
 * sentence and the classifier did not, so a limit reached mid-arm was recorded as UNCLASSIFIED. Both now read it from
 * here, so the two can never disagree about what the sentence is.
 *
 * Plain `.mjs`, no import and no side effect: the workflow runs the smoke with `node` and no build step, and the live
 * entrypoint's bundle imports this file. It MATCHES and answers a boolean; nothing the text says is returned.
 */

const USAGE_LIMIT_SENTENCE = /usage limit reached|\b(?:5-hour|weekly|session|opus) limit reached\b/iu;

/** Whether `text` reports that the subscription's own usage limit was reached. */
export function isSubscriptionUsageLimit(text) {
  return typeof text === 'string' && USAGE_LIMIT_SENTENCE.test(text);
}
