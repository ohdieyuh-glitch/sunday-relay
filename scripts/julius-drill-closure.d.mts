/**
 * Type declarations for the drill-closure reader shared by the Beta Gate and
 * the capability drills. Authored as plain `.mjs` because the gate runs with
 * `node` and no build step, and a drill bundles the SAME reader, so the set a
 * drill attests and the set the gate demands cannot be computed two ways.
 */

/** One capability drill: its npm script, the name its transcript's VERIFIED line opens with, and the transcript file it writes. */
export interface JuliusCapabilityDrill {
  readonly script: string;
  readonly name: string;
  readonly transcript: string;
}
export type JuliusDrilledCapability = 'RESTART / RECOVERY' | 'FAILURE RECOVERY' | 'REPAIR LOOP';

/** The three capability drills, by the capability each proves. Nothing else is a drill. */
export declare const JULIUS_CAPABILITY_DRILLS: Readonly<Record<JuliusDrilledCapability, JuliusCapabilityDrill>>;

/** The drill that proves `capability`, with its `npm run` command, or null when none does. */
export declare function capabilityDrill(capability: string): (JuliusCapabilityDrill & { readonly capability: JuliusDrilledCapability; readonly command: string }) | null;

/** Every specifier a source file imports for its value; type-only statements are skipped. */
export declare function specifiersIn(source: string): readonly string[];

/** A relative specifier resolved to a posix-relative repository file, or null. */
export declare function resolveRelative(repoRoot: string, fromFile: string, specifier: string): string | null;

/** The sorted set of repository files `entry` drives, `entry` included, plus `package-lock.json` when a dependency is reached. */
export declare function importClosure(repoRoot: string, entry: string): readonly string[];

/** The esbuild entry behind `npm run <script>`, or why it cannot be known. */
export declare function drillEntry(repoRoot: string, drillCommand: string): { readonly entry: string } | { readonly error: string };

/** Every file the drill behind `drillCommand` drives, or why that cannot be known. */
export declare function drillDrivenFiles(
  repoRoot: string,
  drillCommand: string,
): { readonly entry: string; readonly files: readonly string[] } | { readonly error: string };
