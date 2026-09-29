/**
 * Type declarations for the drill-closure reader shared by the Beta Gate and
 * the capability drills. Authored as plain `.mjs` because the gate runs with
 * `node` and no build step, and a drill bundles the SAME reader, so the set a
 * drill attests and the set the gate demands cannot be computed two ways.
 */

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
