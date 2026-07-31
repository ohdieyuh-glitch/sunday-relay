import type {
  CliCaps, ConsoleView, EvidenceVM, FindingVM, HomeVM, ManualTaskVM, MissionConsoleVM,
  ProjectDraft, RecoveryVM, RepairVM, SafeEventVM, WorkforceVM,
} from './contracts';
import { DEMO_SPLASH_LABELS } from './contracts';
import { homeVM, missionConsoleVM, projectHomeVM, PHASES } from './projections';
import {
  renderEvidence, renderFinding, renderHeader, renderHome, renderManualTask,
  renderMissionConsole, renderProjectHome, renderRecovery, renderRepair,
} from './renderer';
import { paint } from './theme';
import { fitLines } from './layout';
import { safeText } from './safety';

/**
 * Relay CLI product shell (Prompt 8.6) — a PURE state machine (`reduceKey`)
 * driving screen routing, selection, the view toggle, the draft flow, and
 * the contextual command bar, plus a thin renderer (`renderScreen`). The
 * interactive IO loop lives in `shell.ts`; everything here is testable
 * without a TTY. The shell NEVER invokes a provider: natural-language input
 * answers that Ask Relay is not configured in the CLI, and `run` routes to
 * the founder-confirmed supervised command outside this process loop.
 */

export type Screen =
  | 'home' | 'projects' | 'new-project' | 'project' | 'console' | 'tasks'
  | 'findings' | 'evidence' | 'history' | 'recovery' | 'workforce'
  | 'research' | 'settings' | 'help' | 'demo-intro';

/** One selectable option in a `select` draft field. The value is stored on the
 * draft directly (already typed), so the founder never types a response for it. */
export interface DraftOption { label: string; value: string | number | boolean; }

/** The value a draft field commits when the founder supplies nothing usable.
 * Selects own typed domains (a boolean flag, a numeric limit), so a fallback is
 * NOT always a string — it is whatever `ProjectDraft` stores for that key. */
export type DraftFallback = string | number | boolean;

interface DraftFieldBase {
  key: keyof ProjectDraft | 'done';
  label: string;
  hint: string;
  optional: boolean;
}

/** Free-text / comma-separated-list fields. The founder types the answer;
 * Enter on an empty input commits `fallback` (always a string here, because
 * `assignDraftValue` sanitizes and splits it as text). */
export interface TypedDraftField extends DraftFieldBase {
  kind: 'text' | 'list';
  fallback: string;
}

/** Pick-one fields: arrow/number keys move the cursor, Enter commits the
 * highlighted option. `fallback` is the safe value the draft keeps when no
 * option can be applied — it MUST equal `options[defaultIndex].value` and the
 * matching default in `finalizeDraft`, so it can never silently change the
 * product's behaviour. `draft-fallbacks.test.ts` locks both invariants. */
export interface SelectDraftField extends DraftFieldBase {
  kind: 'select';
  options: DraftOption[];
  /** Which option is pre-highlighted on entry/return. */
  defaultIndex: number;
  fallback: DraftFallback;
}

export type DraftField = TypedDraftField | SelectDraftField;

/** Narrowing helper — `Array.prototype.filter` callers get a real type. */
export const isSelectField = (f: DraftField): f is SelectDraftField => f.kind === 'select';

/**
 * The project setup fields. Everything with a defined value set is a SELECT
 * (arrow keys / number keys to choose, Enter to confirm) — mirroring the
 * browser's click-to-select workforce and mode pickers. Only the genuinely
 * free-form identity/scope fields (name, objective, paths, lists) are typed.
 */
export const DRAFT_FIELDS: DraftField[] = [
  { key: 'name', label: 'Project name', hint: 'e.g. Sunday Relay Frontend', optional: false, kind: 'text', fallback: '' },
  { key: 'projectType', label: 'Project type', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 'feature',
    options: [{ label: 'Feature', value: 'feature' }, { label: 'Interface', value: 'interface' }, { label: 'Application', value: 'application' }, { label: 'Review', value: 'review' }, { label: 'Fix', value: 'fix' }, { label: 'API', value: 'api' }] },
  { key: 'objective', label: 'Main objective', hint: 'one sentence', optional: false, kind: 'text', fallback: '' },
  // The narrower reading of an unanswered "existing project?" is that the
  // founder is pointing Relay at code that already exists, so nothing is
  // treated as greenfield by default.
  { key: 'existingProject', label: 'Existing project?', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: true,
    options: [{ label: 'Yes — existing repository', value: true }, { label: 'No — new project', value: false }] },
  { key: 'repositoryPath', label: 'Repository path', hint: 'path (optional — Enter to skip)', optional: true, kind: 'text', fallback: '' },
  { key: 'stack', label: 'Technical stack', hint: 'comma-separated (optional)', optional: true, kind: 'list', fallback: '' },
  { key: 'scopeSummary', label: 'Scope summary', hint: 'what is in scope (optional)', optional: true, kind: 'text', fallback: '' },
  { key: 'protectedAreas', label: 'Protected areas', hint: 'comma-separated paths (optional)', optional: true, kind: 'list', fallback: '' },
  // Safety-ordered domains: an unanswered impact/mode/research question always
  // falls back to the LEAST permissive option, never the most capable one.
  { key: 'productionImpact', label: 'Production impact', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 'none',
    options: [{ label: 'None', value: 'none' }, { label: 'Internal', value: 'internal' }, { label: 'External', value: 'external' }] },
  { key: 'architect', label: 'Prompt Architect', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 'Sunday Alcatraz',
    options: [{ label: 'Sunday Alcatraz', value: 'Sunday Alcatraz' }] },
  { key: 'codingAgent', label: 'Coding Agent', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 'Claude Code',
    options: [{ label: 'Claude Code', value: 'Claude Code' }] },
  // Falls back to a REVIEWER, never to 'None' — losing independent review must
  // be an explicit founder choice, never the consequence of an empty answer.
  { key: 'reviewer', label: 'Reviewer', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 'Codex',
    options: [{ label: 'Codex', value: 'Codex' }, { label: 'None — no independent review', value: '' }] },
  { key: 'mode', label: 'Relay mode', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 'GUIDED',
    options: [{ label: 'Guided', value: 'GUIDED' }, { label: 'Semi-autonomous', value: 'SEMI' }, { label: 'Autonomous', value: 'AUTONOMOUS' }] },
  { key: 'researchPreference', label: 'Research preference', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 'not_configured',
    options: [{ label: 'Not configured', value: 'not_configured' }, { label: 'Monitoring', value: 'monitoring' }, { label: 'Active', value: 'active' }] },
  { key: 'evidenceRequirements', label: 'Evidence requirements', hint: 'comma-separated (optional)', optional: true, kind: 'list', fallback: '' },
  // Budget ceilings are numbers, not strings. Each falls back to the option the
  // flow already pre-highlights, which is also `finalizeDraft`'s default — an
  // unanswered budget question can never widen a ceiling.
  { key: 'runtimeLimitMinutes', label: 'Runtime limit', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 1, fallback: 30,
    options: [{ label: '15 minutes', value: 15 }, { label: '30 minutes', value: 30 }, { label: '60 minutes', value: 60 }, { label: '120 minutes', value: 120 }] },
  { key: 'callLimit', label: 'Call limit', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 1, fallback: 4,
    options: [{ label: '2 calls', value: 2 }, { label: '4 calls', value: 4 }, { label: '6 calls', value: 6 }, { label: '8 calls', value: 8 }] },
  { key: 'reviewLimit', label: 'Review limit', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 1,
    options: [{ label: '1 review', value: 1 }, { label: '2 reviews', value: 2 }, { label: '3 reviews', value: 3 }] },
  { key: 'repairLimit', label: 'Repair limit', hint: 'pick one', optional: false, kind: 'select', defaultIndex: 0, fallback: 1,
    options: [{ label: '1 repair', value: 1 }, { label: '2 repairs', value: 2 }, { label: '3 repairs', value: 3 }] },
];

/** The option index for a select field: the stored value's index, else the
 * field's default. Used to pre-highlight the right option on entry/return. */
function selectIndexFor(field: DraftField, draft: Partial<ProjectDraft>): number {
  if (!isSelectField(field)) return 0;
  const current = draft[field.key as keyof ProjectDraft];
  const idx = field.options.findIndex((o) => o.value === current);
  return idx >= 0 ? idx : field.defaultIndex;
}

/** Forbidden draft vocabulary — the flow never asks for credentials. */
export const FORBIDDEN_DRAFT_FIELDS = ['password', 'api key', 'token', 'cookie', 'recovery code', 'secret'];

export interface AppData {
  projects: ProjectDraft[];
  events: SafeEventVM[];
  tasks: ManualTaskVM[];
  findings: FindingVM[];
  repairs: RepairVM[];
  evidence: EvidenceVM[];
  recovery: RecoveryVM | null;
  demo: boolean;
}

export interface AppState {
  screen: Screen;
  previous: Screen;
  view: ConsoleView;
  selection: number;
  selectedProjectId: string | null;
  typed: string;
  message: string;
  draft: Partial<ProjectDraft>;
  draftIndex: number;
  draftReview: boolean;
  timelineCount: number;
  tick: number;
  quit: boolean;
  savedDraft: ProjectDraft | null;
  /** Offline demo playback: auto-advancing the fixture timeline, and the
   * speed multiplier (1 / 1.5 / 2). Only meaningful in the demo; real missions
   * leave `playing` false and never auto-advance. */
  playing: boolean;
  speed: number;
}

export function initialState(
  demoAutoOpen: boolean,
  opts: { screen?: Screen; selectedProjectId?: string | null } = {},
): AppState {
  // The demo opens on the activation splash; the founder presses ENTER/P to
  // step into the live console. Non-demo screens open with nothing revealed.
  const screen = opts.screen ?? (demoAutoOpen ? 'demo-intro' : 'home');
  return {
    screen, previous: 'home', view: 'panels', selection: 0,
    selectedProjectId: opts.selectedProjectId ?? null, typed: '', message: '', draft: {}, draftIndex: 0,
    draftReview: false, timelineCount: 0, tick: 0, quit: false,
    savedDraft: null, playing: false, speed: 1,
  };
}

export interface KeyEvent {
  name: string;       // normalized: 'a'..'z', 'enter', 'escape', 'up', 'down', 'tab', 'backspace', 'ctrl-c', '?', chars
  char?: string;      // printable character when applicable
}

const CONTEXT_COMMANDS = ['status', 'home', 'terminal', 'workforce', 'research', 'tasks', 'findings', 'evidence', 'history', 'settings', 'recover', 'help', 'quit'];

const COMMAND_SCREEN: Record<string, Screen> = {
  status: 'project', home: 'home', terminal: 'console', workforce: 'workforce',
  research: 'research', tasks: 'tasks', findings: 'findings', evidence: 'evidence',
  history: 'history', settings: 'settings', recover: 'recovery', help: 'help',
};

/** Pure key reducer. Returns the next state; never performs IO. */
export function reduceKey(state: AppState, key: KeyEvent, data: AppData): AppState {
  const next: AppState = { ...state, message: '' };
  if (key.name === 'ctrl-c') return { ...next, quit: true };

  /* ---- demo activation splash ---- */
  if (state.screen === 'demo-intro') {
    if (key.name === 'enter') return { ...next, screen: 'console', view: 'panels', timelineCount: 1, playing: false };
    if (key.name === 'p') return { ...next, screen: 'console', view: 'panels', timelineCount: 1, playing: true };
    if (key.name === 'n') return { ...next, screen: 'console', view: 'panels', timelineCount: 1, playing: false };
    if (key.name === 'v') return { ...next, view: state.view === 'stream' ? 'panels' : 'stream' };
    if (key.name === 'q' || key.name === 'escape') return { ...next, quit: true };
    if (key.name === '?') return { ...next, previous: 'demo-intro', screen: 'help' };
    return next;
  }

  /* ---- draft flow captures typing first ---- */
  if (state.screen === 'new-project') return reduceDraftKey(next, key, data);

  /* ---- demo playback controls on the console (single-key, empty buffer) ---- */
  if (state.screen === 'console' && data.demo && state.typed === '') {
    const len = data.events.length;
    switch (key.name) {
      case 'p': return { ...next, playing: !state.playing };
      case 'n': return { ...next, playing: false, timelineCount: Math.min(len, state.timelineCount + 1) };
      case 'r': return { ...next, playing: false, timelineCount: 1, message: 'Simulation restarted from the first event.' };
      case '1': return { ...next, speed: 1, message: 'Playback speed 1×.' };
      case '2': return { ...next, speed: 1.5, message: 'Playback speed 1.5×.' };
      case '3': return { ...next, speed: 2, message: 'Playback speed 2×.' };
      default: break;
    }
  }

  /* ---- command-bar typing on the console ---- */
  if (state.screen === 'console') {
    if (key.name === 'enter') return reduceConsoleCommand(next, state.typed, data);
    if (key.name === 'backspace') return { ...next, typed: state.typed.slice(0, -1) };
    if (key.char && key.char.length === 1 && key.name !== 'escape' && key.name !== 'tab') {
      // A single hotkey letter with an empty buffer routes; anything else keeps
      // the command bar — including past the 80-char cap, so a long paste never
      // falls through and fires navigation mid-input.
      const startsCommand = state.typed === '' && /[vhqtmfe?]/i.test(key.char);
      if (!startsCommand) {
        return { ...next, typed: state.typed.length < 80 ? state.typed + key.char : state.typed };
      }
    }
  }

  /* ---- global keys ---- */
  switch (key.name) {
    case 'escape':
      return state.screen === 'home' ? next : { ...next, screen: state.previous, previous: 'home', typed: '' };
    case '?': return { ...next, previous: state.screen, screen: 'help' };
    case 'q':
      return state.screen === 'home' ? { ...next, quit: true } : { ...next, screen: state.previous, previous: 'home', typed: '' };
    case 'h':
      // On the project screen [H] opens History (as advertised); elsewhere the
      // conventional [H]ome. Back-navigation (Q/Esc) still returns to home.
      if (state.screen === 'project') return { ...next, previous: state.screen, screen: 'history' };
      return { ...next, previous: state.screen, screen: 'home' };
    case 'c':
      return { ...next, message: 'Connecting an existing on-disk project is not configured in the CLI yet.' };
    case 'tab':
      if (state.screen === 'console') return { ...next, view: state.view === 'stream' ? 'panels' : 'stream' };
      return { ...next, selection: Math.min(Math.max(0, data.projects.length - 1), state.selection + 1) };
    case 'p': return { ...next, previous: state.screen, screen: 'projects' };
    case 'm': return { ...next, previous: state.screen, screen: 'tasks' };
    case 'f': return { ...next, previous: state.screen, screen: 'findings' };
    case 'e': return { ...next, previous: state.screen, screen: 'evidence' };
    case 't': return { ...next, previous: state.screen, screen: 'console' };
    case 'v':
      if (state.screen === 'console') return { ...next, view: state.view === 'stream' ? 'panels' : 'stream' };
      return next;
    case 'w': return { ...next, previous: state.screen, screen: 'workforce' };
    case 's': return { ...next, previous: state.screen, screen: 'settings' };
    case 'r':
      return state.screen === 'home'
        ? { ...next, previous: state.screen, screen: 'recovery' }
        : { ...next, previous: state.screen, screen: 'research' };
    case 'n':
      if (state.screen === 'home' || state.screen === 'projects') {
        return { ...next, previous: state.screen, screen: 'new-project', draft: {}, draftIndex: 0, draftReview: false, typed: '', selection: 0 };
      }
      return next;
    case 'o':
      if (state.screen === 'home') return { ...next, previous: state.screen, screen: 'projects' };
      return next;
    case 'up': case 'k':
      return { ...next, selection: Math.max(0, state.selection - 1) };
    case 'down': case 'j':
      return { ...next, selection: Math.min(Math.max(0, data.projects.length - 1), state.selection + 1) };
    case 'enter':
      if (state.screen === 'home' || state.screen === 'projects') {
        const project = data.projects[state.selection];
        if (project) return { ...next, selectedProjectId: project.projectId, previous: state.screen, screen: 'project' };
      }
      return next;
    default:
      return next;
  }
}

/** Console command bar: demo playback slash-commands (`/play /pause /next
 * /restart /speed 2x /panels /stream /complete /mission`), the shared
 * contextual navigation commands, and — because natural-language Ask Relay is
 * not configured — an honest help message. Never routes to a provider. */
function reduceConsoleCommand(next: AppState, typed: string, data: AppData): AppState {
  const cleared: AppState = { ...next, typed: '' };
  const raw = typed.trim().toLowerCase();
  if (raw === '') return cleared;
  const [head, arg] = raw.replace(/^\//, '').split(/\s+/);
  if (head === 'quit' || head === 'exit') return { ...cleared, quit: true };
  if (head === 'panels') return { ...cleared, view: 'panels' };
  if (head === 'stream') return { ...cleared, view: 'stream' };
  if (data.demo) {
    const len = data.events.length;
    switch (head) {
      case 'play': return { ...cleared, playing: true };
      case 'pause': return { ...cleared, playing: false };
      case 'next': return { ...cleared, playing: false, timelineCount: Math.min(len, cleared.timelineCount + 1) };
      case 'restart': return { ...cleared, playing: false, timelineCount: 1, message: 'Simulation restarted from the first event.' };
      case 'speed': {
        const s = arg?.startsWith('2') ? 2 : arg?.includes('1.5') ? 1.5 : 1;
        return { ...cleared, speed: s, message: `Playback speed ${s}×.` };
      }
      case 'complete':
        return { ...cleared, message: 'Relay completion only occurs when the simulated CompletionPolicy passes. Use /next or /play to continue the fixture.' };
      case 'mission': return { ...cleared, screen: 'console' };
      default: break;
    }
  }
  if (CONTEXT_COMMANDS.includes(head)) {
    return { ...cleared, previous: 'console', screen: COMMAND_SCREEN[head] ?? cleared.screen };
  }
  return { ...cleared, message: data.demo
    ? 'Ask Relay is not configured for this visual simulation. Commands: /play /pause /next /restart /speed 2x /panels /stream /status /findings /help /quit.'
    : 'Ask Relay is not configured in the CLI yet. Type: help, status, findings, evidence, tasks, home, quit.' };
}

/** Ticks per fixture reveal at 1× speed. Locked with DEMO_PLAYBACK_MS by
 * the Prompt-8.7 acceptance tests (7 × 300ms × 20 reveals ≈ 42s at 1× —
 * the founder-approved duration). Change requires re-approval. */
export const DEMO_STEP_TICKS = 7;

/** Pure playback tick — the ONLY way the offline demo advances. Increments the
 * animation tick and, while `playing` on the console, reveals the next fixture
 * event once enough ticks have elapsed for the current speed. Real missions
 * never set `playing`, so this only animates the offline fixture. */
export function reduceTick(state: AppState, data: AppData): { state: AppState; revealed: boolean } {
  const tick = state.tick + 1;
  let { timelineCount, playing } = state;
  let revealed = false;
  if (playing && state.screen === 'console' && timelineCount < data.events.length) {
    const stepTicks = Math.max(1, Math.round(DEMO_STEP_TICKS / (state.speed || 1)));
    if (tick % stepTicks === 0) { timelineCount += 1; revealed = true; }
  }
  if (timelineCount >= data.events.length) playing = false; // settle at COMPLETE
  return { state: { ...state, tick, timelineCount, playing }, revealed };
}

function reduceDraftKey(state: AppState, key: KeyEvent, _data: AppData): AppState {
  if (key.name === 'escape') {
    // Cancel safely — nothing persisted until an explicit save.
    return { ...state, screen: state.previous, draft: {}, draftIndex: 0, draftReview: false, typed: '', message: 'Draft cancelled. Nothing was saved.' };
  }
  if (state.draftReview) {
    if (key.name === 's' || key.char === 's') return { ...state, message: '__SAVE_DRAFT__' };
    if (key.name === 'b' || key.char === 'b') return { ...state, draftReview: false, draftIndex: DRAFT_FIELDS.length - 1, typed: '' };
    if (key.name === 'c' || key.char === 'c') {
      return { ...state, screen: state.previous, draft: {}, draftIndex: 0, draftReview: false, typed: '', message: 'Draft cancelled. Nothing was saved.' };
    }
    return state;
  }
  const field = DRAFT_FIELDS[state.draftIndex];
  const advance = (draft: Partial<ProjectDraft>): AppState => {
    const nextIndex = state.draftIndex + 1;
    if (nextIndex >= DRAFT_FIELDS.length) return { ...state, draft, draftReview: true, typed: '' };
    return { ...state, draft, draftIndex: nextIndex, typed: '', selection: selectIndexFor(DRAFT_FIELDS[nextIndex], draft) };
  };
  const goBack = (): AppState => {
    const prevIndex = Math.max(0, state.draftIndex - 1);
    return { ...state, draftIndex: prevIndex, typed: '', selection: selectIndexFor(DRAFT_FIELDS[prevIndex], state.draft) };
  };

  // Select fields: choose an option (no typing). Arrows / number keys move the
  // cursor; Enter confirms the highlighted option; Backspace goes back.
  if (isSelectField(field)) {
    const options = field.options;
    const cur = Math.min(Math.max(0, state.selection), Math.max(0, options.length - 1));
    switch (key.name) {
      case 'up': case 'k': case 'left':
        return { ...state, selection: Math.max(0, cur - 1) };
      case 'down': case 'j': case 'right':
        return { ...state, selection: Math.min(options.length - 1, cur + 1) };
      case 'backspace':
        return goBack();
      case 'enter':
        // The cursor always sits on a real option for every shipped field, so
        // `fallback` is the safety net for the one case that would otherwise
        // write `undefined` onto the draft: a select with no applicable option.
        return advance({ ...state.draft, [field.key]: options[cur]?.value ?? field.fallback } as Partial<ProjectDraft>);
      default: {
        const n = key.char && /^[1-9]$/.test(key.char) ? Number(key.char) - 1 : -1;
        if (n >= 0 && n < options.length) return { ...state, selection: n };
        return state; // letters / other keys are inert on a select
      }
    }
  }

  // Text / list fields: typed input.
  if (key.name === 'enter') {
    const raw = state.typed.trim();
    if (raw === '<') return goBack();
    const value = raw === '' ? field.fallback : raw;
    if (!field.optional && value === '') {
      return { ...state, message: `${field.label} is required.` };
    }
    return advance({ ...state.draft, ...assignDraftValue(field, value) });
  }
  if (key.name === 'backspace') return { ...state, typed: state.typed.slice(0, -1) };
  if (key.char && key.char.length === 1) return { ...state, typed: state.typed + key.char };
  return state;
}

function assignDraftValue(field: DraftField, value: string): Partial<ProjectDraft> {
  const clean = safeText(value, { maxLength: 300 });
  if (field.kind === 'list') {
    return { [field.key]: clean === '' ? [] : clean.split(',').map((s) => s.trim()).filter(Boolean) } as Partial<ProjectDraft>;
  }
  return { [field.key]: clean } as Partial<ProjectDraft>;
}

/** Finalize a draft into a durable project record (called by the shell when
 * the reducer signals __SAVE_DRAFT__). */
export function finalizeDraft(draft: Partial<ProjectDraft>, now: string): ProjectDraft {
  const slug = safeText(draft.name ?? 'project', { maxLength: 40 })
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  return {
    projectId: `prj-${slug}`,
    name: safeText(draft.name ?? 'Untitled project', { maxLength: 80 }),
    projectType: draft.projectType ?? 'feature',
    // Re-sanitize every free-text field here too, so a record built by any
    // path (not just the assignDraftValue-gated flow) is safe on disk.
    objective: safeText(draft.objective ?? '', { maxLength: 200 }),
    existingProject: draft.existingProject ?? true,
    repositoryPath: draft.repositoryPath ? safeText(draft.repositoryPath, { maxLength: 200 }) : null,
    stack: (draft.stack ?? []).map((s) => safeText(s, { maxLength: 40 })),
    scopeSummary: safeText(draft.scopeSummary ?? '', { maxLength: 200 }),
    protectedAreas: (draft.protectedAreas ?? []).map((s) => safeText(s, { maxLength: 80 })),
    productionImpact: (draft.productionImpact as ProjectDraft['productionImpact']) ?? 'none',
    architect: safeText(draft.architect ?? 'Sunday Alcatraz', { maxLength: 40 }),
    codingAgent: safeText(draft.codingAgent ?? 'Claude Code', { maxLength: 40 }),
    reviewer: draft.reviewer == null ? 'Codex' : safeText(draft.reviewer, { maxLength: 40 }),
    mode: safeText(draft.mode ?? 'GUIDED', { maxLength: 20 }),
    researchPreference: (draft.researchPreference as ProjectDraft['researchPreference']) ?? 'not_configured',
    evidenceRequirements: (draft.evidenceRequirements ?? []).map((s) => safeText(s, { maxLength: 80 })),
    runtimeLimitMinutes: draft.runtimeLimitMinutes ?? 30,
    callLimit: draft.callLimit ?? 4,
    reviewLimit: draft.reviewLimit ?? 1,
    repairLimit: draft.repairLimit ?? 1,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
  };
}

/* ------------------------------ rendering ----------------------------- */

export function workforceOf(project: ProjectDraft | null): WorkforceVM {
  // Names come straight off a durable record, so sanitize at render time —
  // the mission console renders these without a further boundary pass.
  return {
    architect: { name: safeText(project?.architect ?? 'Sunday Alcatraz', { maxLength: 32 }), online: true },
    coding: { name: safeText(project?.codingAgent ?? 'Claude Code', { maxLength: 32 }), online: true },
    reviewer: { name: safeText(project?.reviewer ?? 'Codex', { maxLength: 32 }), online: true, configured: (project?.reviewer ?? 'Codex') !== '' },
    mode: safeText(project?.mode ?? 'GUIDED', { maxLength: 16 }),
  };
}

export function selectedProject(state: AppState, data: AppData): ProjectDraft | null {
  return data.projects.find((p) => p.projectId === state.selectedProjectId)
    ?? data.projects[state.selection] ?? data.projects[0] ?? null;
}

export function consoleVMFor(state: AppState, data: AppData): MissionConsoleVM {
  const project = selectedProject(state, data);
  const events = data.events.slice(0, Math.max(0, state.timelineCount));
  const consumed = Math.min(4, events.filter((e) => /session started|review active|bounded repair|re-review active/i.test(e.primary)).length
    + (events.some((e) => e.role === 'coding') ? 1 : 0));
  return missionConsoleVM({
    route: 'RLY / 001',
    projectName: project?.name ?? 'Untitled project',
    workforce: workforceOf(project),
    events,
    view: state.view,
    demo: data.demo,
    callBudget: { consumed: Math.min(consumed, 4), max: project?.callLimit ?? 4 },
    outputVisibility: events.some((e) => /verified complete/i.test(e.primary)) ? 'RELEASED'
      : events.some((e) => e.annotation?.kind === 'HELD') ? 'HELD FOR REVIEW' : 'WORKING',
    phase: PHASES.join(' > '),
  });
}

export function renderScreen(state: AppState, data: AppData, caps: CliCaps): string[] {
  const p = paint(caps);
  const project = selectedProject(state, data);
  const header = (route: string, subtitle?: string): string[] =>
    renderHeader({ caps, route, workforce: null, demo: data.demo, subtitle });
  let lines: string[];
  switch (state.screen) {
    case 'home': {
      const vm: HomeVM = data.demo
        ? { ...homeVM({ projects: data.projects, runs: [], selectedProject: project }), demo: true }
        : homeVM({ projects: data.projects, runs: [], selectedProject: project });
      lines = renderHome(vm, caps);
      break;
    }
    case 'projects': {
      lines = [...header('RLY / PROJECTS')];
      if (data.projects.length === 0) lines.push(p.dim('No projects yet. Press [N] to create a project draft.'));
      data.projects.forEach((proj, i) => {
        const marker = i === state.selection ? p.tone('gold', caps.unicode ? '▸ ' : '> ') : '  ';
        lines.push(`${marker}${p.dim(String(i + 1).padStart(2, '0'))}  ${p.tone('cream', proj.name)}  ${p.dim(proj.status.toUpperCase())}`);
      });
      lines.push('', p.dim('[Enter] open · [N] new · [Q] back'));
      break;
    }
    case 'new-project':
      lines = renderDraftScreen(state, caps);
      break;
    case 'project': {
      if (!project) { lines = [...header('RLY / PROJECT'), p.dim('No project selected.')]; break; }
      const vm = projectHomeVM({
        draft: project, reference: 'RLY / 001',
        phaseIndex: project.status === 'verified_complete' ? 5 : 2,
        currentAction: project.status === 'verified_complete' ? 'Mission verified complete.' : 'Coding Agent implementing bounded task.',
        outputVisibility: project.status === 'verified_complete' ? 'RELEASED' : 'HELD FOR INSPECTION',
        callBudget: { consumed: Math.min(1, data.events.length), max: project.callLimit },
      });
      lines = renderProjectHome(vm, caps);
      break;
    }
    case 'demo-intro':
      lines = renderDemoIntro(caps);
      break;
    case 'console':
      lines = renderMissionConsole(consoleVMFor(state, data), caps, state.tick, state.typed);
      if (data.demo) lines.push(demoControls(state, data, caps));
      break;
    case 'tasks': {
      lines = [...header('RLY / MANUAL TASKS')];
      if (data.tasks.length === 0) lines.push(p.dim('No Manual Tasks. Relay has not needed your help.'));
      for (const task of data.tasks) lines.push(...renderManualTask(task, caps), '');
      break;
    }
    case 'findings': {
      lines = [...header('RLY / FINDINGS')];
      if (data.findings.length === 0) lines.push(p.dim('No findings. The Reviewer has not reported any blocking issue.'));
      for (const finding of data.findings) lines.push(...renderFinding(finding, caps), '');
      for (const repair of data.repairs) lines.push(...renderRepair(repair, caps), '');
      break;
    }
    case 'evidence':
      lines = [...header('RLY / EVIDENCE'), ...renderEvidence(data.evidence, caps)];
      break;
    case 'history': {
      lines = [...header('RLY / HISTORY')];
      const events = data.events.slice(0, state.timelineCount);
      if (events.length === 0) lines.push(p.dim('No mission history yet.'));
      for (const event of events) lines.push(`  ${p.dim(safeText(event.at, { maxLength: 8 }))}  ${p.tone('cream', safeText(event.primary, { maxLength: 200 }))}`);
      break;
    }
    case 'recovery':
      lines = [...header('RLY / RECOVERY')];
      if (data.recovery) lines.push(...renderRecovery(data.recovery, caps));
      else lines.push(p.dim('No interrupted runs. Nothing to recover.'));
      break;
    case 'workforce': {
      const wf = workforceOf(project);
      lines = [...header('RLY / WORKFORCE'),
        `${p.dim('PROMPT ARCHITECT')}  ${p.tone('cream', wf.architect.name)}  ${p.tone('green', 'ONLINE')}`,
        `${p.dim('CODING AGENT')}      ${p.tone('cream', wf.coding.name)}  ${p.tone('green', 'ONLINE')}`,
        wf.reviewer.configured
          ? `${p.dim('REVIEWER')}          ${p.tone('cyan', wf.reviewer.name)}  ${p.tone('green', 'ONLINE')}`
          : `${p.dim('REVIEWER')}          ${p.tone('gray', 'NOT CONFIGURED')}`,
        `${p.dim('MODE')}              ${p.boldTone('gold', wf.mode)}`];
      break;
    }
    case 'research': {
      const research = project ? (project.researchPreference === 'active' ? 'RESEARCH ACTIVE' : project.researchPreference === 'monitoring' ? 'RESEARCH MONITORING' : 'RESEARCH NOT CONFIGURED') : 'RESEARCH NOT CONFIGURED';
      lines = [...header('RLY / RESEARCH'),
        `${p.dim('STATUS')}  ${p.tone(research === 'RESEARCH NOT CONFIGURED' ? 'gray' : 'amber', research)}`,
        '',
        p.dim('The Prompt Architect researches only approved project topics.'),
        p.dim('New knowledge requires your approval before it enters the Project Brain.')];
      break;
    }
    case 'settings': {
      lines = [...header('RLY / SETTINGS')];
      if (!project) { lines.push(p.dim('No project selected.')); break; }
      const kv = (k: string, value: string): string => `  ${p.dim(k.padEnd(20))} ${p.tone('cream', safeText(value, { maxLength: 200 }))}`;
      lines.push(kv('Name', project.name), kv('Type', project.projectType),
        kv('Objective', project.objective || '-'), kv('Repository', project.repositoryPath ?? '-'),
        kv('Stack', project.stack.join(', ') || '-'), kv('Protected areas', project.protectedAreas.join(', ') || '-'),
        kv('Production impact', project.productionImpact), kv('Runtime limit', `${project.runtimeLimitMinutes} min`),
        kv('Call limit', String(project.callLimit)), kv('Review limit', String(project.reviewLimit)),
        kv('Repair limit', String(project.repairLimit)));
      break;
    }
    case 'help':
    default:
      lines = [...header('RLY / HELP'),
        p.boldTone('gold', 'KEYS'),
        `  ${p.tone('gold', '[H]')} home  ${p.tone('gold', '[P]')} projects  ${p.tone('gold', '[T]')} terminal  ${p.tone('gold', '[V]')} toggle view  ${p.tone('gold', '[M]')} tasks`,
        `  ${p.tone('gold', '[F]')} findings  ${p.tone('gold', '[E]')} evidence  ${p.tone('gold', '[W]')} workforce  ${p.tone('gold', '[R]')} research/recover  ${p.tone('gold', '[?]')} help`,
        `  ${p.tone('gold', '[N]')} new project  ${p.tone('gold', '[O]')} open  ${p.tone('gold', '[Q]')}/${p.tone('gold', '[Esc]')} back · quit  ${p.tone('gold', '[Ctrl+C]')} exit`,
        '',
        p.boldTone('gold', 'COMMANDS'),
        `  ${p.tone('cream', CONTEXT_COMMANDS.join(' · '))}`,
        '',
        p.dim('Natural-language input: Ask Relay is not configured in the CLI yet.'),
        p.dim('Live runs require: relay supervised run --confirm-live (founder-initiated).')];
      break;
  }
  if (state.message && state.message !== '__SAVE_DRAFT__') {
    lines.push('', p.tone('amber', state.message));
  }
  return fitLines(lines, caps);
}

/** The demo activation splash: the pixel dog + wordmark, the honesty banner,
 * and the start/play/step/view/exit keys. */
function renderDemoIntro(caps: CliCaps): string[] {
  const p = paint(caps);
  const lines = renderHeader({ caps, route: 'RLY / SIMULATION', workforce: null, demo: true });
  lines.push('', p.boldTone('cream', 'ACTIVATE THE RELAY MISSION SIMULATION'), '');
  for (const label of DEMO_SPLASH_LABELS) lines.push(`  ${p.tone('amber', label)}`);
  lines.push('');
  const key = (k: string, what: string): string => `  ${p.tone('gold', k.padEnd(9))} ${p.tone('cream', what)}`;
  lines.push(
    key('[ENTER]', 'activate Relay and watch the roles work'),
    key('[P]', 'play the simulation automatically'),
    key('[N]', 'advance one fixture step'),
    key('[V]', 'switch PANELS / STREAM'),
    key('[Q]/[ESC]', 'exit safely'),
    '',
    p.dim('Offline visual simulation — no Claude, Codex, or any provider is called; no real files change.'),
  );
  return lines;
}

/** The demo playback control bar shown under the console — makes play/pause,
 * step, restart, speed, and progress visible while the fixture animates. */
function demoControls(state: AppState, data: AppData, caps: CliCaps): string {
  const p = paint(caps);
  const total = data.events.length;
  const step = Math.min(state.timelineCount, total);
  const complete = state.timelineCount >= total;
  const dot = caps.unicode ? '▶' : '>';
  const status = complete
    ? p.tone('green', `${caps.unicode ? '✓' : 'OK'} COMPLETE`)
    : state.playing ? p.tone('gold', `${dot} PLAYING`) : p.tone('amber', `${caps.unicode ? '❚❚' : '||'} PAUSED`);
  const keys = p.dim('[P]lay/pause  [N]ext  [R]estart  [1 2 3]speed  [V]iew  [Q]uit');
  return `${status}  ${p.dim(`${state.speed}×`)}   ${keys}   ${p.dim(`step ${step}/${total}`)}`;
}

function renderDraftScreen(state: AppState, caps: CliCaps): string[] {
  const p = paint(caps);
  const lines = renderHeader({ caps, route: 'RLY / NEW PROJECT', workforce: null, demo: false, subtitle: 'PROJECT DRAFT' });
  if (state.draftReview) {
    lines.push(p.boldTone('gold', 'REVIEW DRAFT'), '');
    for (const field of DRAFT_FIELDS) {
      const value = state.draft[field.key as keyof ProjectDraft];
      const display = Array.isArray(value) ? value.join(', ') : value === undefined || value === '' ? '-' : String(value);
      lines.push(`  ${p.dim(field.label.padEnd(24))} ${p.tone('cream', safeText(display, { maxLength: 60 }))}`);
    }
    lines.push('', `  ${p.tone('gold', '[S]')} Save draft   ${p.tone('gold', '[B]')} Back   ${p.tone('gold', '[C]')} Cancel`);
    lines.push('', p.dim('Saving stores a durable draft. No mission starts and no provider is called.'));
    return lines;
  }
  const field = DRAFT_FIELDS[state.draftIndex];
  lines.push(p.dim(`Step ${state.draftIndex + 1} of ${DRAFT_FIELDS.length}${field.optional ? ' (optional)' : ''}`), '');
  lines.push(p.boldTone('cream', field.label));
  lines.push(p.dim(`  ${field.hint}`));
  lines.push('');
  if (field.kind === 'select') {
    // A selectable option list — the founder PICKS, never types a response.
    const options = field.options ?? [];
    const cur = Math.min(Math.max(0, state.selection), Math.max(0, options.length - 1));
    const arrow = caps.unicode ? '▸' : '>';
    options.forEach((option, i) => {
      const chosen = i === cur;
      const marker = chosen ? p.tone('gold', arrow) : ' ';
      const num = p.dim(`${i + 1}`);
      const label = chosen ? p.boldTone('cream', option.label) : p.tone('cream', option.label);
      lines.push(`  ${marker} ${num}  ${label}`);
    });
    lines.push('', p.dim(`[Enter] select · ${caps.unicode ? '↑/↓' : 'up/down'} choose · 1-${Math.min(9, options.length)} jump · [Backspace] back · [Esc] cancel`));
  } else {
    lines.push(`  ${p.tone('gold', '>')} ${p.tone('cream', state.typed)}${p.tone('gold', '_')}`);
    lines.push('', p.dim('[Enter] accept · type < then Enter to go back · [Esc] cancel safely'));
    lines.push(p.dim('Never enter passwords, API keys, tokens, cookies, or recovery codes.'));
  }
  return lines;
}
