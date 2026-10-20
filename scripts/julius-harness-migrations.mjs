/**
 * JULIUS HARNESS MIGRATIONS — which registered schema migrations are Julius's,
 * and the one manifest line every other migration gets.
 *
 * `export-julius-harness.mjs` imports this file. It is kept separate so a test
 * can import it: the generator runs on load and is only ever driven as a child
 * process. An entry guard in the generator would be the trap
 * `julius-reviewer-deadline.mjs` records. A guard that misfires on Windows
 * prints NOTHING, and a silent `--check` would pass.
 *
 * Pure: no module-scope side effect, no filesystem, no `import.meta`. Every
 * function takes migration FILE NAMES (`034_project_brain_components.sql`),
 * never paths.
 */

/** A migration NAMED "julius" is Julius's schema. */
const NAMED_JULIUS = /julius/i;

/**
 * Migrations NOT named "julius" that are Julius's schema all the same, because
 * they change the definition of a Julius table. This is an EXPLICIT list, never
 * a wider pattern. Each entry is a reviewed decision, and
 * `export-julius-harness.test.ts` pins the list exactly.
 *
 * A migration whose foreign keys only point AT a Julius table does not qualify.
 * 017's gauntlet tables reference `julius_runs` and `julius_tasks`, but 017
 * alters no Julius table. 034 does.
 */
export const JULIUS_SCHEMA_MIGRATIONS_BY_NAME = Object.freeze(['034_project_brain_components.sql']);

/** Why each listed migration is Julius's. It is printed in the export's file header. */
export const JULIUS_SCHEMA_MIGRATION_REASONS = Object.freeze({
  '034_project_brain_components.sql': 'Julius schema migration by the generator\'s explicit list, registered by filename in the migration runner. It is not named "julius", but it alters 029_julius_project_brain\'s tables: it replaces project_brain_mutations_operation_check, and it adds TRUNCATE guards on all four. It also adds foreign keys to relay_wonderland.julius_runs',
});

export function isJuliusSchemaMigration(name) {
  return NAMED_JULIUS.test(name) || JULIUS_SCHEMA_MIGRATIONS_BY_NAME.includes(name);
}

/**
 * Problems with the explicit list, measured against the runner's registered
 * names. A listed migration that is not registered is stale. A listed migration
 * that is named "julius" is redundant. Each listed migration has exactly one reason.
 *
 * The list and the reasons are PARAMETERS, defaulted to this module's constants
 * (like `describeNonJuliusMigrations`' `descriptions`). A test can then hand
 * every guard a non-compliant input. Over the compliant constants alone, a
 * deleted guard would go unnoticed.
 */
export function juliusSchemaListProblems(registeredNames, list = JULIUS_SCHEMA_MIGRATIONS_BY_NAME, reasons = JULIUS_SCHEMA_MIGRATION_REASONS) {
  const problems = [];
  for (const name of list) {
    if (!registeredNames.includes(name)) problems.push(`listed as a Julius schema migration but not registered by the migration runner: ${name}`);
    if (NAMED_JULIUS.test(name)) problems.push(`listed as a Julius schema migration although its name already says "julius": ${name}`);
    if (!Object.hasOwn(reasons, name)) problems.push(`listed as a Julius schema migration with no reason: ${name}`);
  }
  for (const name of Object.keys(reasons)) {
    if (!list.includes(name)) problems.push(`a Julius schema reason for a migration that is not listed: ${name}`);
  }
  return problems;
}

/**
 * One description per non-Julius migration numbered after the FIRST Julius
 * migration. These migrations are interleaved with the Julius ones (017) or
 * follow them (033), so the "pre-Julius" sentence would be false for them.
 * Each says what that one migration holds. A new non-Julius migration must
 * arrive with its own line here: the describer throws without one, so no
 * migration can inherit another migration's description.
 */
export const NON_JULIUS_MIGRATION_DESCRIPTIONS = Object.freeze({
  '017_gauntlet_command.sql': 'the Gauntlet Loop\'s own storage (`relay_wonderland.gauntlet_runs` and `gauntlet_rounds`). Its foreign keys point at `julius_runs` and `julius_tasks`, and no Julius migration references it',
  '033_wonderland_social.sql': 'Wonderland Social\'s own storage: 17 additive `relay_wonderland.social_*` tables referencing only `relay_wonderland.players` and each other',
  '035_wonderland_voice.sql': 'Wonderland party voice\'s own storage: 1 additive `relay_wonderland.voice_puid_binding` table referencing only `relay_wonderland.players`',
  '036_wonderfs.sql': 'WonderFS\'s own storage (the project file system, contract r1.4): 16 additive `relay_wonderland.wfs_*` tables, referencing only `relay_wonderland.projects` outside them',
  '037_wonderland_lff.sql': 'Wonderland LFF\'s own storage (the "Looking For Feed", a PROVISIONAL number): 4 additive `relay_wonderland.lff_*` tables (posts, join requests, the creation record behind the creation cap, and moderation-evidence snapshots) whose keys reference only `relay_wonderland.players` outside them, and 1 read-only moderation view over them and `relay_wonderland.social_reports`',
});

const migrationNumber = (name) => {
  const number = Number.parseInt(name, 10);
  if (!Number.isInteger(number)) throw new Error(`migration file name does not start with its number: ${name}`);
  return number;
};

/**
 * The manifest lines for the registered migrations that are NOT Julius's.
 *   - "pre-Julius schema": every one numbered below the first Julius migration,
 *     on one line.
 *   - "non-Julius schema": every later one, on its own line, from `descriptions`.
 * The function THROWS when there is no Julius migration to anchor the split,
 * when a later migration has no description, or when a description names no
 * later migration (a stale line).
 *
 * @param {{ julius: string[], excluded: string[], dir: string, descriptions?: Record<string, string> }} input
 * @returns {string[]}
 */
export function describeNonJuliusMigrations({ julius, excluded, dir, descriptions = NON_JULIUS_MIGRATION_DESCRIPTIONS }) {
  if (julius.length === 0) throw new Error('no Julius schema migration is registered, so the pre-Julius / non-Julius split has no anchor');
  const firstJulius = Math.min(...julius.map(migrationNumber));
  const pre = excluded.filter((name) => migrationNumber(name) < firstJulius);
  const later = excluded.filter((name) => !pre.includes(name));
  const stale = Object.keys(descriptions).filter((name) => !later.includes(name));
  if (stale.length > 0) throw new Error(`described as a non-Julius migration after the first Julius one, but none is registered under that name (remove or re-justify the line): ${stale.join(', ')}`);
  const undescribed = later.filter((name) => !Object.hasOwn(descriptions, name));
  if (undescribed.length > 0) throw new Error(`non-Julius migration with no manifest description (add its own line to NON_JULIUS_MIGRATION_DESCRIPTIONS; never reuse another's): ${undescribed.join(', ')}`);
  const code = (name) => `\`${name}\``;
  const lines = [];
  if (pre.length > 0) lines.push(`- **pre-Julius schema** — ${pre.map(code).join(', ')} under \`${dir}\`: registered by the same migration runner and applied in order before the Julius migrations; Julius tables reference \`relay_wonderland.projects\`, \`mission_contracts\` and \`budget_reservations\` defined there.`);
  for (const name of later) lines.push(`- **non-Julius schema** — ${code(name)} under \`${dir}\`: registered by the same migration runner, which applies every migration in numeric order; ${descriptions[name]}; deliberately not Julius's.`);
  return lines;
}
