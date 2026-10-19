import { safeText } from './redact';

/**
 * REQUESTED VERSUS SERVED — the ONE rule that decides what their difference means.
 *
 * Splitting the reviewer's `model` field into `requestedModel`/`servedModel`
 * produced a second question immediately, and getting it wrong turned a
 * labelling defect into a mission-blocking one:
 *
 *   Relay asks for `gpt-4o`. OpenAI answers `gpt-4o-2024-08-06`.
 *
 * That is not a substituted model. It is the SAME model, named exactly. Every
 * provider does it — `gpt-4o` → `gpt-4o-2024-08-06`, `claude-sonnet-5` →
 * `claude-sonnet-5-20260114` — and it is the reason the two axes exist at all.
 * A rule that called it a substitution refused every review on the reviewer
 * configuration this repository's own docs recommend, discarded the verdict of
 * a review that had already been paid for, and told the founder their provider
 * had swapped the reviewer. An independent review found that by running it.
 *
 * A SUBSTITUTION is the provider answering with a model that is not the
 * requested one at all — `grok-4` requested, `grok-3-mini` served. That is the
 * thing worth refusing: a cheaper or weaker model standing in for the one whose
 * judgement Relay is relying on.
 *
 * ONE MEANS, NOT THREE. `modelMatchesVerified` in the xAI harness already
 * implemented an exact-match version of this rule, unused by any production
 * caller, and the mission leg then wrote a second inline copy. Both now call
 * this. `attestation.ts` states the principle: *"Two legs deciding one fact by
 * different means is how they came to disagree, so now there is one means."*
 */

/**
 * Separators a provider puts between a model family and its snapshot.
 *
 * `-` is the only one any provider Relay speaks to actually uses — `anthropic`,
 * `xai` and `openai` all spell snapshots that way. `@`, `:` and `/` are gateway
 * and self-hosted forms, kept because a proxy in front of those providers is a
 * real deployment shape.
 *
 * **`.` IS DELIBERATELY ABSENT, and it used to be here.** With `.` in this list
 * `gpt-4` → `gpt-4.1` classified as a resolution, and `gpt-4.1` is a different
 * model with different weights and a different price. A version BUMP is not a
 * snapshot. No provider spells a snapshot with a leading `.` — `2024-08-06`,
 * `20241022`, `0709` and `002` all use `-` — so removing it costs nothing and
 * closes a real under-refusal an independent review found by running the
 * classifier over 46 real provider id pairs.
 *
 * A suffix appended with NO separator is also not a resolution:
 * `grok-4` → `grok-40` is a different model, and accepting it would make the
 * rule depend on nothing more than a shared prefix.
 *
 * This list and the sentence above it are asserted against each other by a test,
 * because the first version of that sentence enumerated four separators while the
 * array held five — and the undocumented fifth was the unsound one.
 */
const RESOLUTION_SEPARATORS = ['-', '@', ':', '/'] as const;

/**
 * ALIAS MARKERS ON THE **REQUESTED** ID.
 *
 * `claude-3-5-sonnet-latest`, `mistral-large-latest`, `gpt-4-turbo-preview` and
 * `claude-sonnet-4-0` are alias forms: they name a family and let the provider
 * pick the snapshot. Relay holds no table of alias mappings and must not invent
 * one, so when the requested id is an alias it genuinely CANNOT verify that the
 * served snapshot is the right one.
 *
 * Refusing those was the same over-refusal that made the first version of this
 * rule fail every review — `claude-3-5-sonnet-latest` answered by
 * `claude-3-5-sonnet-20241022` is the provider doing exactly what the alias
 * asked for. So an alias yields its own relation, `alias_unverifiable`: not a
 * match, not a substitution, and the reason says why the check could not be
 * made. Choosing an alias trades verifiability for convenience, and the record
 * says so rather than pretending either way.
 *
 * The bound: the served id must still share its FIRST segment with the requested
 * family. `claude-3-5-sonnet-latest` answered by `grok-3-mini` is a substitution,
 * because `claude` and `grok` are not the same provider's family however loose
 * the alias.
 */
const ALIAS_TAILS = ['latest', 'preview'] as const;

/**
 * A SNAPSHOT SUFFIX IS A VERSION, NOT A WORD — and getting this wrong is how a
 * cheaper model gets accepted as the one that was requested.
 *
 * "Prefix plus separator" alone is unsound, and its counterexample is the most
 * common model id on earth: `gpt-4o` → `gpt-4o-mini` satisfies it, and
 * `gpt-4o-mini` is a genuinely different, weaker, cheaper model — precisely the
 * substitution worth refusing. So does `-turbo`, `-nano`, `-instruct`,
 * `-preview`, and `-latest` (which does not even name what ran). The first
 * version of this rule accepted all of them; a test written for the rule caught
 * it before it shipped.
 *
 * A resolution's suffix is therefore a snapshot number: either a `v`-prefixed
 * version (`v2`) or **at least three digits**, optionally followed by more
 * dot/dash/underscore-separated groups — `2024-08-06`, `20241022`, `0709`,
 * `002`, `2026-01`. Anything with a letter in it is a VARIANT, and a variant is
 * a substitution.
 *
 * THE THREE-DIGIT FLOOR EXISTS BECAUSE ONE AND TWO DIGITS ARE VERSION BUMPS.
 * `gpt-4o` → `gpt-4o-2` and `claude-3` → `claude-3-5` matched the earlier
 * one-or-more-digits rule and are different models. Every real snapshot is a
 * date or a zero-padded build number, and both are at least three digits.
 *
 * The unknown shape is refused rather than accepted, which is the direction that
 * fails loudly. A legitimate snapshot spelled some new way is a refusal a human
 * reads and can widen; a variant accepted as a snapshot is a weaker model
 * silently reviewing Relay's work.
 */
const SNAPSHOT_SUFFIX = /^(?:v\d+|\d{3,})(?:[-._]\d+)*$/;

export const MODEL_IDENTITY_RELATIONS = [
  'unknown', 'unrequested', 'exact', 'resolution', 'alias_unverifiable', 'substitution',
] as const;
export type ModelIdentityRelation = (typeof MODEL_IDENTITY_RELATIONS)[number];

export interface ModelIdentityVerdict {
  readonly relation: ModelIdentityRelation;
  /** True only for `substitution`. The one relation that invalidates a run. */
  readonly substituted: boolean;
  /** Always present. Says which relation was found and why. */
  readonly reason: string;
}

/**
 * Classify what a served model is, relative to the one requested.
 *
 *   - `unknown` — the provider named no model. Unknown stays Unknown: it is
 *     never promoted to a match and never treated as a substitution. A run
 *     whose provider is silent is attested with no served model, not with the
 *     requested one.
 *   - `unrequested` — Relay asked for no particular model, which is the honest
 *     state of the remote reviewer path: the bridge asks the service for a
 *     review and the service's own configuration decides. There is nothing to
 *     compare, so there is nothing to refuse.
 *   - `exact` — the same string. Case is normalized, because a model id that
 *     differs only in case is the same model and failing a paid review over
 *     capitalization is the over-refusal this rule exists to avoid.
 *   - `resolution` — the served id is the requested family plus a snapshot.
 *     Truthful on both axes, and NOT a fallback.
 *   - `alias_unverifiable` — the requested id is an ALIAS (`-latest`,
 *     `-preview`, a trailing generation pointer), so there was no pin to
 *     honour and Relay holds no alias table to check the answer against. Not a
 *     match and not a substitution: the record says the check could not be
 *     made. See `ALIAS_TAILS`.
 *   - `substitution` — anything else, INCLUDING the reverse direction. A
 *     request that pinned `gpt-4o-2024-08-06` and got `gpt-4o` back did not
 *     have its pin honoured, and a pin nobody honours is not a pin.
 */
export function classifyModelIdentity(input: {
  readonly requested: string | null;
  readonly served: string | null;
}): ModelIdentityVerdict {
  const requested = normalize(input.requested);
  const served = normalize(input.served);

  if (served === null) {
    return {
      relation: 'unknown',
      substituted: false,
      reason: 'The provider did not report which model answered.',
    };
  }
  if (requested === null) {
    return {
      relation: 'unrequested',
      substituted: false,
      reason: `Relay requested no particular model; the provider answered with ${safeText(input.served ?? '')}.`,
    };
  }
  if (requested === served) {
    return { relation: 'exact', substituted: false, reason: `The provider answered with the requested ${safeText(input.served ?? '')}.` };
  }
  if (isResolutionOf(requested, served)) {
    return {
      relation: 'resolution',
      substituted: false,
      reason:
        `The provider resolved ${safeText(input.requested ?? '')} to the specific `
        + `${safeText(input.served ?? '')}, which is the same model named exactly.`,
    };
  }
  const family = aliasFamily(requested);
  if (family !== null && sharesFirstSegment(family, served)) {
    return {
      relation: 'alias_unverifiable',
      substituted: false,
      reason:
        `Relay requested the alias ${safeText(input.requested ?? '')} and the provider answered with `
        + `${safeText(input.served ?? '')}. An alias names a family and lets the provider pick the `
        + 'snapshot, so there was no pin to honour and Relay holds no alias table to check this against. '
        + 'Both names are recorded; the match is unverified.',
    };
  }
  return {
    relation: 'substitution',
    substituted: true,
    reason:
      `The provider answered with model ${safeText(input.served ?? '')}, not the requested `
      + `${safeText(input.requested ?? '')}.`,
  };
}

/** Lowercased and trimmed, or null. A blank string is not a model name. */
function normalize(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * The family an alias names, or null when the requested id is not an alias.
 *
 * `claude-3-5-sonnet-latest` → `claude-3-5-sonnet`. A trailing `-0` is
 * Anthropic's generation pointer and is treated the same way.
 */
function aliasFamily(requested: string): string | null {
  for (const tail of ALIAS_TAILS) {
    for (const separator of RESOLUTION_SEPARATORS) {
      const marker = `${separator}${tail}`;
      if (requested.endsWith(marker)) return requested.slice(0, -marker.length);
    }
  }
  // A trailing generation pointer: `claude-sonnet-4-0`. Exactly `-0`, not `-01`,
  // which would be a two-digit version and is already a substitution.
  if (requested.endsWith('-0')) return requested.slice(0, -2);
  return null;
}

/**
 * The bound on `alias_unverifiable`: however loose an alias is, it does not
 * cross providers. `claude-3-5-sonnet-latest` answered by `grok-3-mini` is a
 * substitution, because `claude` and `grok` are not the same family.
 */
function sharesFirstSegment(family: string, served: string): boolean {
  const first = family.split(/[-@:/.]/)[0] ?? '';
  return first !== '' && served.startsWith(first);
}

/** Is `served` the `requested` family plus a snapshot suffix? One-directional. */
function isResolutionOf(requested: string, served: string): boolean {
  if (!served.startsWith(requested)) return false;
  const suffix = served.slice(requested.length);
  if (suffix.length < 2) return false;
  if (!RESOLUTION_SEPARATORS.includes(suffix[0] as typeof RESOLUTION_SEPARATORS[number])) return false;
  return SNAPSHOT_SUFFIX.test(suffix.slice(1));
}
