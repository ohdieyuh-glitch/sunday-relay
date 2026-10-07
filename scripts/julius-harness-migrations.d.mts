/**
 * Type declarations for the harness exporter's migration classifier and describer.
 * Authored as plain `.mjs` because the exporter runs with `node` and no build step;
 * the exporter and its test import the SAME module, so the classification the
 * manifest prints and the one the test pins cannot be computed two ways.
 */

/** The migrations that are Julius schema by explicit name (they alter a Julius table but are not named "julius"). */
export declare const JULIUS_SCHEMA_MIGRATIONS_BY_NAME: readonly string[];

/** Why each explicitly listed migration is Julius's; printed in the export's file header. */
export declare const JULIUS_SCHEMA_MIGRATION_REASONS: Readonly<Record<string, string>>;

/** True for a migration named "julius", or one on the explicit list. */
export declare function isJuliusSchemaMigration(name: string): boolean;

/** Problems with the explicit list against the runner's registered names; [] when the list is consistent. */
export declare function juliusSchemaListProblems(
  registeredNames: readonly string[],
  list?: readonly string[],
  reasons?: Readonly<Record<string, string>>,
): string[];

/** One description per non-Julius migration numbered after the first Julius migration. */
export declare const NON_JULIUS_MIGRATION_DESCRIPTIONS: Readonly<Record<string, string>>;

/** The manifest lines for the registered non-Julius migrations; throws on an undescribed, stale or unanchored input. */
export declare function describeNonJuliusMigrations(input: {
  readonly julius: readonly string[];
  readonly excluded: readonly string[];
  readonly dir: string;
  readonly descriptions?: Readonly<Record<string, string>>;
}): string[];
