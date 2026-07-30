/**
 * SUNDAY RELAY — Relay Dog CODING animation: the code the dog is writing.
 *
 * Four experience levels, shown in order, so the coding state reads as work
 * that GETS MORE ADVANCED rather than as a generic typing loop. The levels are
 * a visual device only:
 *
 *   - advancing a level is NOT mission progress, NOT verification, NOT review
 *     and NOT completion; nothing here is derived from, or writes to, mission
 *     state, a trace entry, a capsule, economics or a PSP;
 *   - the level shown comes from the animation's own position in its loop
 *     (CSS keyframes), never from a mission-state ordinal;
 *   - the text is ILLUSTRATIVE and abstract. It is not the user's project
 *     source, it is not read from any file, and it never contains a
 *     credential, a token, a key, a URL or an environment value. A test
 *     asserts exactly that.
 *
 * PURE DATA — no imports, no framework, no environment.
 */

export const CODE_EXPERIENCE_LEVELS = ['basic', 'intermediate', 'advanced', 'architecture'] as const;
export type CodeExperienceLevel = (typeof CODE_EXPERIENCE_LEVELS)[number];

export interface CodeProgressionLevel {
  level: CodeExperienceLevel;
  /** Ordinal, 1-based — display order only, never a score or a mission fact. */
  step: number;
  /** Short human name for the accessible description of the whole loop. */
  title: string;
  /** Illustrative lines. Kept short so they stay readable on a phone. */
  lines: readonly string[];
}

/**
 * LEVEL 1 — BASIC. Straightforward implementation work. Deliberately NOT
 * presented as bad code: it is simply the short, direct kind of change.
 */
const BASIC: CodeProgressionLevel = {
  level: 'basic',
  step: 1,
  title: 'writing a first implementation',
  lines: ['const task = "start";', '', 'if (ready) {', '  run();', '}'],
};

/** LEVEL 2 — INTERMEDIATE. Structured application work: types, validation. */
const INTERMEDIATE: CodeProgressionLevel = {
  level: 'intermediate',
  step: 2,
  title: 'adding types and validation',
  lines: [
    'interface MissionState {',
    '  status: MissionStatus;',
    '  actualAgentId: string;',
    '}',
    '',
    'function validateMission(s: MissionState) {',
    '  return s.status !== "failed";',
    '}',
  ],
};

/** LEVEL 3 — ADVANCED. Senior production engineering: assertions, evidence. */
const ADVANCED: CodeProgressionLevel = {
  level: 'advanced',
  step: 3,
  title: 'asserting evidence and recording the trace',
  lines: [
    'const result = executeMission(command);',
    '',
    'assertVerifiedOutcome(result);',
    'assertActualAgentIdentity(result);',
    'appendTraceEntry(result);',
    'evaluateBudgetPolicy(result);',
  ],
};

/**
 * LEVEL 4 — SYSTEM ARCHITECT. The editor gives way to a compact view of the
 * coordination the product actually performs. The nodes are the real Relay
 * pipeline vocabulary, so the picture teaches the product — but it is still a
 * drawing: showing a RELEASE GATE node does not mean release was granted.
 */
const ARCHITECTURE: CodeProgressionLevel = {
  level: 'architecture',
  step: 4,
  title: 'connecting the mission pipeline',
  lines: [
    'REQUEST',
    '  -> PROMPT ARCHITECT',
    '  -> CODING AGENT',
    '  -> REVIEWER',
    '  -> VERIFICATION',
    '  -> REPAIR',
    '  -> RELEASE GATE',
  ],
};

export const CODE_PROGRESSION: readonly CodeProgressionLevel[] = [
  BASIC,
  INTERMEDIATE,
  ADVANCED,
  ARCHITECTURE,
];

/** Seconds each level holds before the next one takes over. 4 x 3s = 12s, in
 *  the founder-approved 8–15s band for the whole loop. */
export const CODE_LEVEL_SECONDS = 3;
export const CODE_PROGRESSION_SECONDS = CODE_LEVEL_SECONDS * CODE_PROGRESSION.length;

/**
 * The level a REDUCED-MOTION surface shows: one static composition with real
 * structure, rather than a rapidly changing editor. Intermediate is chosen
 * because it is the most representative — it has types, a function and
 * indentation without needing the loop to make sense.
 */
export const CODE_PROGRESSION_STATIC_LEVEL: CodeExperienceLevel = 'intermediate';

export function codeProgressionLevel(level: CodeExperienceLevel): CodeProgressionLevel {
  return CODE_PROGRESSION.find((l) => l.level === level) ?? BASIC;
}
