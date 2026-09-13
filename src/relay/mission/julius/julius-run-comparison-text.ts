/**
 * THE SENTENCES A COMPARISON CAN BE READ AS — PURE.
 *
 * A comparison is a structure; an operator reads a line. This module turns
 * `julius-run-comparison`'s structure into text that cannot be misread: a
 * DELTA is printed with its sign and its direction, an UNKNOWN is printed with
 * its reason and the words "unknown is not zero", and a NOT_COMPARABLE is
 * printed with its reason and never with a number. The hedge is not decoration
 * — it is the only honest way to print a metric that has no delta.
 *
 * IT DEPENDS ON THE COMPARATOR, in this workspace, and reads its structure
 * exactly; it computes nothing of its own. Implement the comparator first.
 *
 * EVERY FUNCTION BELOW THROWS. This module is the second deliverable of a
 * bounded Julius mission; its specification is
 * `julius-run-comparison-text.test.ts`, which is written and currently fails.
 */

import type { JuliusMetricComparison, JuliusRunComparison } from './julius-run-comparison';

export const JULIUS_RUN_COMPARISON_TEXT_VERSION = 'julius-run-comparison-text.v1' as const;

/**
 * One metric as one fragment:
 *   DELTA          `<label>: <before> → <after> (<signed delta>, <direction>)`
 *   UNKNOWN        `<label>: unknown (<reason>) — unknown is not zero`
 *   NOT_COMPARABLE `<label>: not comparable (<reason>)`
 */
export function describeJuliusMetric(label: string, comparison: JuliusMetricComparison): string {
  void label; void comparison;
  throw new Error('run_comparison_text_not_implemented');
}

/**
 * The whole comparison as one deterministic paragraph, the mission first and
 * then each role, ending with the one verdict on the whole: "comparable in
 * full" or a statement of what kept it from being.
 */
export function describeJuliusRunComparison(comparison: JuliusRunComparison): string {
  void comparison;
  throw new Error('run_comparison_text_not_implemented');
}
