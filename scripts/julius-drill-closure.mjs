/**
 * WHAT A DRILL DROVE, READ FROM THE TREE AND NEVER FROM THE DRILL'S OWN WORD.
 *
 * A drill attestation used to name only the files of the Beta Gate row it
 * claimed, and the gate checked only their digests. The code between the drill
 * and those files could change underneath it: paid run 36568129865's repair
 * drill was produced at main, and read at a stack where the task pipeline, the
 * PostgreSQL repositories, the run loop and the live composition had all moved,
 * the gate still reported REPAIR LOOP as CAPABILITY PROVEN, "the code it drove
 * has not changed since". It had.
 *
 * So the set a drill must attest is derived here, from repository state alone:
 *
 *   1. THE ENTRY. `npm run <script>` names a package.json script, and only the
 *      three capability drills below are drills; that script must build its
 *      bundle with `<script>:build` and then run exactly the bundle that build
 *      writes. The build's esbuild entry is the drill's root. An attestation
 *      cannot choose its own root: it only names the command.
 *   2. THE CLOSURE. Every relative `import` / `export … from` / `import()` /
 *      `require()` is followed from that root. Type-only imports are erased by
 *      the compiler and drive nothing, so they are not followed. A bare
 *      specifier is a dependency, and the dependency code the bundle carries is
 *      pinned by `package-lock.json`, so that file joins the set whenever the
 *      closure reaches one.
 *
 * The scanner is a regular-expression reader, deliberately: the gate is run
 * with plain `node` and no install. It errs towards INCLUDING a file (a comment
 * that happens to look like an import makes a drill go stale sooner, never
 * later), and `julius-drill-support.test.ts` holds it to a SUPERSET of what
 * esbuild actually bundles for every drill, so a file it failed to follow is a
 * failing test rather than a proof that silently covers less than it claims.
 *
 * No module-scope side effect and no `import.meta`: a drill bundles this file
 * into CommonJS, where both would misbehave.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix } from 'node:path';

const SUFFIXES = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.mts', '/index.js', '/index.mjs'];
const CODE = /\.(?:[cm]?[jt]sx?)$/u;
const BUILTINS = new Set(builtinModules);

const onDisk = (repoRoot, relativePath) => join(repoRoot, ...relativePath.split('/'));
const isFile = (repoRoot, relativePath) => {
  const path = onDisk(repoRoot, relativePath);
  return existsSync(path) && statSync(path).isFile();
};

/** Every specifier a source file imports for its VALUE. Type-only statements are skipped. */
export function specifiersIn(source) {
  const found = [];
  const statement = /(?:^|;)[ \t]*(import|export)[ \t]+(type[ \t]+)?([^;'"]*?)\bfrom[ \t]*['"]([^'"\n]+)['"]/gmu;
  for (const match of source.matchAll(statement)) {
    if (match[2] !== undefined) continue;
    found.push(match[4]);
  }
  for (const match of source.matchAll(/(?:^|;)[ \t]*import[ \t]*['"]([^'"\n]+)['"]/gmu)) found.push(match[1]);
  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/gu)) found.push(match[1]);
  for (const match of source.matchAll(/\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/gu)) found.push(match[1]);
  return found;
}

/** A relative specifier resolved to a repository file, posix-separated, or null. */
export function resolveRelative(repoRoot, fromFile, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  if (base === '..' || base.startsWith('../')) return null;
  const candidates = SUFFIXES.map((suffix) => `${base}${suffix}`);
  // TypeScript's ESM convention: `./x.js` names `./x.ts`.
  const script = /\.([cm]?)js$/u.exec(base);
  if (script !== null) {
    const stem = base.slice(0, -script[0].length);
    candidates.push(`${stem}.${script[1]}ts`, `${stem}.tsx`);
  }
  for (const candidate of candidates) {
    if (/\.d\.[cm]?ts$/u.test(candidate)) continue;
    if (isFile(repoRoot, candidate)) return candidate;
  }
  return null;
}

const bareDependency = (specifier) => {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
  if (specifier.startsWith('node:')) return false;
  const root = specifier.split('/')[0];
  return !BUILTINS.has(root);
};

/**
 * THE CAPABILITY DRILLS, AND NOTHING ELSE IS ONE.
 *
 * `drillEntry` used to accept any `npm run <script>` with a `<script>:build`
 * sibling, so the relay bridge SERVER (`relay:bridge`) was a "drill" whose
 * closure covered the account files; and the three real drills share all but
 * their own entry and module, so the recovery drill's attestation, relabelled,
 * "proved" FAILURE RECOVERY and REPAIR LOOP as well. Each capability names its
 * one drill here, with the two things only that drill writes: the transcript
 * file it leaves and the sentence its transcript closes on (`DrillRecord.seal`
 * writes `<name> VERIFIED`). The drills read their constants from this table
 * and the Beta Gate holds every attestation to it, so neither can drift from
 * the other.
 */
export const JULIUS_CAPABILITY_DRILLS = Object.freeze({
  'RESTART / RECOVERY': Object.freeze({ script: 'julius:recovery-drill', name: 'JULIUS RESTART RECOVERY', transcript: 'julius-recovery-drill.transcript.txt' }),
  'FAILURE RECOVERY': Object.freeze({ script: 'julius:failure-recovery-drill', name: 'JULIUS FAILURE RECOVERY', transcript: 'julius-failure-recovery-drill.transcript.txt' }),
  'REPAIR LOOP': Object.freeze({ script: 'julius:repair-loop-drill', name: 'JULIUS REPAIR LOOP', transcript: 'julius-repair-loop-drill.transcript.txt' }),
});

/** The drill that proves `capability`, with its command, or null when none does. */
export function capabilityDrill(capability) {
  const drill = Object.hasOwn(JULIUS_CAPABILITY_DRILLS, capability) ? JULIUS_CAPABILITY_DRILLS[capability] : undefined;
  return drill === undefined ? null : { ...drill, capability, command: `npm run ${drill.script}` };
}

const closures = new Map();

/** The sorted, posix-relative set of repository files `entry` drives, `entry` included. */
export function importClosure(repoRoot, entry) {
  const key = `${repoRoot}\u0000${entry}`;
  const cached = closures.get(key);
  if (cached !== undefined) return cached;
  const seen = new Set();
  let dependencies = false;
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !isFile(repoRoot, file)) continue;
    seen.add(file);
    if (!CODE.test(file)) continue;
    for (const specifier of specifiersIn(readFileSync(onDisk(repoRoot, file), 'utf8'))) {
      if (bareDependency(specifier)) { dependencies = true; continue; }
      const resolved = resolveRelative(repoRoot, file, specifier);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  if (dependencies && isFile(repoRoot, 'package-lock.json')) seen.add('package-lock.json');
  const files = Object.freeze([...seen].sort());
  closures.set(key, files);
  return files;
}

/**
 * The esbuild entry a drill command builds, derived from package.json. The run
 * script must build first and then run exactly the bundle that build writes,
 * or the entry would not be what ran.
 */
export function drillEntry(repoRoot, drillCommand) {
  const named = /^npm run ([A-Za-z0-9:._-]+)$/u.exec(typeof drillCommand === 'string' ? drillCommand : '');
  if (named === null) return { error: `${drillCommand || '(no command)'} is not an \`npm run <script>\` command` };
  const drills = Object.values(JULIUS_CAPABILITY_DRILLS).map((drill) => drill.script);
  if (!drills.includes(named[1])) {
    return { error: `${named[1]} is not a Julius capability drill (${drills.join(', ')}), so it proves no capability` };
  }
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    return { error: 'package.json is unreadable' };
  }
  const script = named[1];
  const run = scripts[script];
  const build = scripts[`${script}:build`];
  if (typeof run !== 'string') return { error: `package.json has no script ${script}` };
  if (typeof build !== 'string') return { error: `package.json has no ${script}:build, so what the drill bundles cannot be read` };
  const entry = /\besbuild\s+(\S+\.[cm]?tsx?)\s/u.exec(`${build} `)?.[1];
  const outfile = /--outfile=(\S+)/u.exec(build)?.[1];
  if (entry === undefined || outfile === undefined) return { error: `${script}:build names no esbuild entry and outfile` };
  const runsTheBundle = run.split(/\s+/u).some((word, index, words) => word === 'node' && words[index + 1] === outfile);
  if (!run.includes(`npm run ${script}:build`) || !runsTheBundle) {
    return { error: `${script} does not build and then run ${outfile}, so its esbuild entry is not what ran` };
  }
  if (!isFile(repoRoot, entry)) return { error: `${entry} is not in this repository` };
  return { entry };
}

/** Every file the drill behind `drillCommand` drives, or why that cannot be known. */
export function drillDrivenFiles(repoRoot, drillCommand) {
  const found = drillEntry(repoRoot, drillCommand);
  if ('error' in found) return found;
  return { entry: found.entry, files: importClosure(repoRoot, found.entry) };
}
