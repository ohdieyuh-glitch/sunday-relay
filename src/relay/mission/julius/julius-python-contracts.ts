import {
  JULIUS_BRAIN_RECORD_KINDS,
  canonicalJuliusBrainJson,
  isJuliusBrainId,
  juliusBrainProvenance,
  juliusBrainSha256,
  validateJuliusBrainObject,
  validateJuliusBrainPrincipal,
  JULIUS_BRAIN_BODY_SCHEMAS,
  type JuliusBrainDraft,
  type JuliusBrainJson,
  type JuliusBrainLink,
  type JuliusBrainPrincipal,
  type JuliusBrainRecordKind,
} from './julius-brain-contracts';
import { JULIUS_BRAIN_OBSERVATION_KINDS, type JuliusBrainWriteGrant } from './julius-brain-policy';
import { containsJuliusSecret } from './julius-brain-secrets';
import { validateJuliusBrainStateModePolicy, type JuliusBrainStateModePolicy } from './julius-brain-state-modes';
import { evaluateJuliusPolicy, type JuliusCardPolicy, type JuliusPolicyDecision } from './julius-policy';

/**
 * PYTHON AS A GOVERNED JULIUS TOOL — THE CONTRACT.
 *
 * Python is a capability of Julius, not a fourth tier and not an authority. A
 * worker (or Julius) REQUESTS an execution; Julius AUTHORISES it against the
 * run's C.A.R.D.; a host runs it in a scoped sandbox; and Julius SETTLES it —
 * deciding, after the process is gone, what of its staged output becomes Brain
 * record, under which principal, with which provenance.
 *
 * WHAT THE SANDBOX RECEIVES: a script (hashed), JSON inputs, content-addressed
 * input files (hash-verified), a scoped hashed Brain snapshot, a schema, and —
 * only if granted by capability — named secrets in named variables. Never the
 * host environment, never a database connection, never a network by default.
 *
 * WHAT COMES BACK IS UNTRUSTED. Everything the process wrote is parsed and
 * validated here as data from outside Julius. Facts only the host observed —
 * exit status, wall time, stream and artifact hashes, the code and environment
 * identity — are never taken from the process.
 */

export const JULIUS_PYTHON_TOOL_ID = 'python.run' as const;
export const JULIUS_PYTHON_REQUEST_FORMAT = 'julius-python-request.v1' as const;
export const JULIUS_PYTHON_CAPABILITY = 'python' as const;

const MiB = 1024 * 1024;

export interface JuliusPythonLimits {
  readonly timeoutMs: number;
  readonly memoryBytes: number;
  /** Retained per stream; beyond it bytes are counted and hashed, not kept. */
  readonly outputBytes: number;
  readonly maxArtifacts: number;
  readonly maxArtifactBytes: number;
  readonly maxProposals: number;
}

export const JULIUS_PYTHON_LIMIT_CEILINGS: JuliusPythonLimits = Object.freeze({
  timeoutMs: 15 * 60_000, memoryBytes: 8 * 1024 * MiB, outputBytes: 4 * MiB, maxArtifacts: 64, maxArtifactBytes: 256 * MiB, maxProposals: 500,
});

export const JULIUS_PYTHON_DEFAULT_LIMITS: JuliusPythonLimits = Object.freeze({
  timeoutMs: 60_000, memoryBytes: 512 * MiB, outputBytes: 256_000, maxArtifacts: 16, maxArtifactBytes: 32 * MiB, maxProposals: 100,
});

export const JULIUS_PYTHON_MAX_RESULT_BYTES = MiB;
export const JULIUS_PYTHON_MAX_PROPOSAL_BYTES = 2 * MiB;

export type JuliusPythonScript =
  | { readonly kind: 'INLINE'; readonly source: string }
  | { readonly kind: 'ARTIFACT'; readonly storageRef: string; readonly contentHash: string };

export interface JuliusPythonFileGrant {
  /** A plain file name the script finds under its inputs directory. */
  readonly name: string;
  readonly storageRef: string;
  readonly contentHash: string;
}

export type JuliusPythonNetworkPolicy =
  | { readonly mode: 'DENY' }
  | { readonly mode: 'ALLOWLIST'; readonly destinations: readonly { readonly host: string; readonly port: number | null }[] };

export interface JuliusPythonSecretGrant {
  readonly capabilityId: string;
  readonly envName: string;
}

export interface JuliusPythonRequirement { readonly name: string; readonly version: string }

export interface JuliusPythonExecutionRequest {
  readonly format: typeof JULIUS_PYTHON_REQUEST_FORMAT;
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly brainId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly runId: string | null;
  readonly taskId: string;
  readonly requestedBy: JuliusBrainPrincipal;
  readonly purpose: string;
  readonly script: JuliusPythonScript;
  readonly argv: readonly string[];
  readonly inputs: JuliusBrainJson;
  readonly files: readonly JuliusPythonFileGrant[];
  readonly brainRead: {
    readonly kinds: readonly JuliusBrainRecordKind[]; readonly taskScoped: boolean; readonly includeHistory: boolean;
    /**
     * Which prior state this execution may draw on. When present it must name
     * this execution's mission and run; absent means grant-only (no mode), and
     * the snapshot records that too.
     */
    readonly stateMode?: JuliusBrainStateModePolicy | null;
  };
  readonly brainWrite: { readonly kinds: readonly JuliusBrainRecordKind[]; readonly maxRecords: number };
  readonly environment: { readonly environmentId: string; readonly requirements: readonly JuliusPythonRequirement[] };
  readonly network: JuliusPythonNetworkPolicy;
  readonly secrets: readonly JuliusPythonSecretGrant[];
  readonly limits: JuliusPythonLimits;
  readonly requestedAt: string;
}

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const RESERVED_ENV = /^(PYTHON|JULIUS_|PATH$|HOME$|TEMP$|TMP$|TMPDIR$|SYSTEMROOT$|USERPROFILE$|LANG$|LC_)/;
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION = /^[0-9][A-Za-z0-9.+!-]{0,63}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;

export function validateJuliusPythonRequest(request: JuliusPythonExecutionRequest): string[] {
  const errors: string[] = [];
  const id = (value: unknown, path: string) => { if (!isJuliusBrainId(value)) errors.push(`${path}: invalid`); };
  if (request.format !== JULIUS_PYTHON_REQUEST_FORMAT) errors.push('format: unsupported');
  id(request.executionId, 'executionId'); id(request.idempotencyKey, 'idempotencyKey'); id(request.brainId, 'brainId');
  id(request.projectId, 'projectId'); id(request.missionId, 'missionId'); id(request.taskId, 'taskId');
  if (request.runId !== null) id(request.runId, 'runId');
  errors.push(...validateJuliusBrainPrincipal(request.requestedBy).map((error) => `requestedBy.${error}`));
  if (request.requestedBy.kind !== 'JULIUS' && request.requestedBy.kind !== 'WORKER') errors.push('requestedBy: only Julius or a worker requests an execution');
  if (typeof request.purpose !== 'string' || !request.purpose.trim() || request.purpose.length > 2_048) errors.push('purpose: required, at most 2048');
  if (request.script.kind === 'INLINE') {
    if (typeof request.script.source !== 'string' || request.script.source.length === 0 || request.script.source.length > 512_000) errors.push('script.source: required, at most 512000');
  } else if (request.script.kind === 'ARTIFACT') {
    if (!SHA.test(request.script.contentHash)) errors.push('script.contentHash: invalid');
    if (typeof request.script.storageRef !== 'string' || request.script.storageRef.length > 2_048) errors.push('script.storageRef: invalid');
  } else errors.push('script.kind: unknown');
  if (!Array.isArray(request.argv) || request.argv.length > 64 || request.argv.some((arg) => typeof arg !== 'string' || arg.length > 4_096 || arg.includes('\u0000'))) errors.push('argv: at most 64 strings');
  try {
    if (canonicalJuliusBrainJson(request.inputs).length > JULIUS_PYTHON_MAX_RESULT_BYTES) errors.push('inputs: larger than 1 MiB');
  } catch { errors.push('inputs: must be finite JSON'); }
  const names = new Set<string>();
  for (const [index, file] of request.files.entries()) {
    if (!FILE_NAME.test(file.name)) errors.push(`files[${index}].name: a plain file name`);
    if (names.has(file.name)) errors.push(`files[${index}].name: duplicate`);
    names.add(file.name);
    if (!SHA.test(file.contentHash)) errors.push(`files[${index}].contentHash: invalid`);
  }
  if (request.files.length > 64) errors.push('files: at most 64');
  for (const kind of request.brainRead.kinds) if (!(JULIUS_BRAIN_RECORD_KINDS as readonly string[]).includes(kind)) errors.push(`brainRead.kinds: unknown ${kind}`);
  const mode = request.brainRead.stateMode ?? null;
  if (mode !== null) {
    errors.push(...validateJuliusBrainStateModePolicy(mode).map((error) => `brainRead.stateMode.${error}`));
    if (mode.missionId !== request.missionId) errors.push('brainRead.stateMode.missionId: must be this execution\'s mission');
    if (request.runId === null || mode.runId !== request.runId) errors.push('brainRead.stateMode.runId: must be this execution\'s run');
  }
  for (const kind of request.brainWrite.kinds) if (!JULIUS_BRAIN_OBSERVATION_KINDS.includes(kind)) errors.push(`brainWrite.kinds: ${kind} is not an observation kind`);
  if (!Number.isSafeInteger(request.brainWrite.maxRecords) || request.brainWrite.maxRecords < 0) errors.push('brainWrite.maxRecords: invalid');
  id(request.environment.environmentId, 'environment.environmentId');
  const packages = new Set<string>();
  for (const [index, requirement] of request.environment.requirements.entries()) {
    if (!PACKAGE.test(requirement.name) || !VERSION.test(requirement.version)) errors.push(`environment.requirements[${index}]: an exact name==version pin`);
    const key = requirement.name.toLowerCase().replace(/[-_.]+/g, '-');
    if (packages.has(key)) errors.push(`environment.requirements[${index}]: duplicate`);
    packages.add(key);
  }
  if (request.network.mode === 'ALLOWLIST') {
    if (request.network.destinations.length === 0 || request.network.destinations.length > 32) errors.push('network.destinations: 1 to 32');
    for (const [index, destination] of request.network.destinations.entries()) {
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(destination.host)) errors.push(`network.destinations[${index}].host: invalid`);
      if (destination.port !== null && (!Number.isSafeInteger(destination.port) || destination.port < 1 || destination.port > 65_535)) errors.push(`network.destinations[${index}].port: invalid`);
    }
  } else if (request.network.mode !== 'DENY') errors.push('network.mode: unknown');
  const envNames = new Set<string>();
  for (const [index, secret] of request.secrets.entries()) {
    id(secret.capabilityId, `secrets[${index}].capabilityId`);
    if (!ENV_NAME.test(secret.envName) || RESERVED_ENV.test(secret.envName)) errors.push(`secrets[${index}].envName: invalid or reserved`);
    if (envNames.has(secret.envName)) errors.push(`secrets[${index}].envName: duplicate`);
    envNames.add(secret.envName);
  }
  for (const key of Object.keys(JULIUS_PYTHON_LIMIT_CEILINGS) as (keyof JuliusPythonLimits)[]) {
    const value = request.limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > JULIUS_PYTHON_LIMIT_CEILINGS[key]) errors.push(`limits.${key}: 1..${JULIUS_PYTHON_LIMIT_CEILINGS[key]}`);
  }
  if (Number.isNaN(Date.parse(request.requestedAt))) errors.push('requestedAt: must be an ISO timestamp');
  // The request is persisted as provenance. A credential inside it would be a
  // credential in the database; secrets travel by capability, never by value.
  if (request.script.kind === 'INLINE' && containsJuliusSecret(request.script.source, [], 'SOURCE')) errors.push('script.source: contains a credential literal; pass secrets by capability');
  try { if (containsJuliusSecret(canonicalJuliusBrainJson({ inputs: request.inputs, argv: request.argv, purpose: request.purpose }))) errors.push('inputs: contain credential-shaped content'); } catch { /* reported above */ }
  return errors;
}

/** Everything a replay must agree on; the clock is not part of it. */
export function juliusPythonRequestDigest(request: JuliusPythonExecutionRequest): string {
  const { requestedAt: _requestedAt, ...rest } = request;
  return juliusBrainSha256(canonicalJuliusBrainJson(rest));
}

export function juliusPythonInputsHash(request: JuliusPythonExecutionRequest): string {
  return juliusBrainSha256(canonicalJuliusBrainJson({ argv: request.argv, inputs: request.inputs, files: request.files.map(({ name, contentHash }) => ({ name, contentHash })) }));
}

export function juliusPythonScriptHash(script: JuliusPythonScript): string {
  return script.kind === 'INLINE' ? juliusBrainSha256(script.source) : script.contentHash;
}

/** A resolved, verified interpreter environment. `executable` is host-local and never persisted. */
export interface JuliusPythonResolvedEnvironment {
  readonly environmentId: string;
  readonly executable: string;
  readonly version: string;
  readonly implementation: string;
  readonly platform: string;
  readonly executableHash: string | null;
  readonly environmentHash: string;
  readonly distributions: readonly JuliusPythonRequirement[];
}

const normalisePackage = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

export type JuliusPythonAuthorization =
  | { readonly allowed: true; readonly decisions: readonly JuliusPolicyDecision[] }
  | { readonly allowed: false; readonly reasonCode: string; readonly detail: string; readonly decisions: readonly JuliusPolicyDecision[] };

/**
 * MAY THIS EXECUTION RUN. C.A.R.D. first — the `python` tool capability,
 * process execution, filesystem reads for input files, network only for an
 * allowlist and only if the card allows network, and each secret as its own
 * `secret:<capability>` capability — then the environment: it must exist, be
 * Python 3.11 or newer, and satisfy every exact pin.
 */
export function authorizeJuliusPythonExecution(input: {
  readonly request: JuliusPythonExecutionRequest;
  readonly card: JuliusCardPolicy;
  readonly environment: JuliusPythonResolvedEnvironment | null;
  readonly secretAvailable: (capabilityId: string) => boolean;
}): JuliusPythonAuthorization {
  const { request, card } = input;
  const decisions: JuliusPolicyDecision[] = [];
  const check = (decision: JuliusPolicyDecision): JuliusPythonAuthorization | null => {
    decisions.push(decision);
    if (decision.effect === 'DENY') return { allowed: false, reasonCode: decision.reasonCode, detail: decision.safeRationale, decisions };
    if (decision.effect === 'REQUIRE_APPROVAL') return { allowed: false, reasonCode: 'CARD_APPROVAL_REQUIRED', detail: 'This execution needs an authorised approval first.', decisions };
    return null;
  };
  const refusals = [
    check(evaluateJuliusPolicy(card, { operation: 'USE_TOOL', capability: JULIUS_PYTHON_CAPABILITY })),
    check(evaluateJuliusPolicy(card, { operation: 'EXECUTE_PROCESS' })),
    ...(request.files.length > 0 ? [check(evaluateJuliusPolicy(card, { operation: 'READ_FILESYSTEM' }))] : []),
    ...(request.network.mode === 'ALLOWLIST' ? [check(evaluateJuliusPolicy(card, { operation: 'ACCESS_NETWORK' }))] : []),
    ...request.secrets.map((secret) => check(evaluateJuliusPolicy(card, { operation: 'USE_CAPABILITY', capability: `secret:${secret.capabilityId}` }))),
  ];
  const refused = refusals.find((value) => value !== null);
  if (refused) return refused;
  for (const secret of request.secrets) {
    if (!input.secretAvailable(secret.capabilityId)) return { allowed: false, reasonCode: 'SECRET_UNAVAILABLE', detail: `No secret is configured for capability ${secret.capabilityId}.`, decisions };
  }
  const environment = input.environment;
  if (environment === null) return { allowed: false, reasonCode: 'ENVIRONMENT_UNKNOWN', detail: `No verified environment ${request.environment.environmentId}.`, decisions };
  const [major, minor] = environment.version.split('.').map(Number);
  if (environment.implementation !== 'CPython' || major !== 3 || (minor ?? 0) < 11) {
    return { allowed: false, reasonCode: 'ENVIRONMENT_UNSUPPORTED', detail: `${environment.implementation} ${environment.version} is not CPython 3.11+.`, decisions };
  }
  const installed = new Map(environment.distributions.map((dist) => [normalisePackage(dist.name), dist.version]));
  const unsatisfied = request.environment.requirements.filter((requirement) => installed.get(normalisePackage(requirement.name)) !== requirement.version);
  if (unsatisfied.length > 0) {
    return {
      allowed: false, reasonCode: 'DEPENDENCY_UNSATISFIED',
      detail: unsatisfied.map((requirement) => `${requirement.name}==${requirement.version} (installed: ${installed.get(normalisePackage(requirement.name)) ?? 'none'})`).join(', '),
      decisions,
    };
  }
  return { allowed: true, decisions };
}

/* -------------------------------------------------------------- the run */

export interface JuliusPythonStream {
  /** Redacted, and bounded to the retained byte limit. */
  readonly text: string;
  /** Every byte the stream produced, retained or not. */
  readonly bytes: number;
  readonly truncated: boolean;
  /** sha256 of the raw stream as produced — never of the redacted text. */
  readonly hash: string;
  readonly redactions: number;
}

export interface JuliusPythonCollectedArtifact {
  readonly name: string;
  readonly byteSize: number;
  /** null when the artifact was quarantined and its bytes were not stored. */
  readonly contentHash: string | null;
  readonly storageRef: string | null;
  readonly quarantined: 'too_large' | 'contains_secret' | 'not_a_regular_file' | 'over_artifact_limit' | null;
}

export type JuliusPythonTermination = 'EXITED' | 'TIMED_OUT' | 'CANCELLED' | 'SPAWN_FAILED' | 'OUTPUT_LIMIT';

export interface JuliusPythonRunOutcome {
  readonly termination: JuliusPythonTermination;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly scriptHash: string;
  readonly stdout: JuliusPythonStream;
  readonly stderr: JuliusPythonStream;
  /** Raw files the runner wrote, or null when absent / too large (see `*TooLarge`). */
  readonly resultText: string | null;
  readonly resultTooLarge: boolean;
  readonly proposalsText: string | null;
  readonly proposalsTooLarge: boolean;
  readonly usageText: string | null;
  readonly artifacts: readonly JuliusPythonCollectedArtifact[];
  readonly spawnError: string | null;
}

export interface JuliusPythonRunInput {
  readonly request: JuliusPythonExecutionRequest;
  readonly environment: JuliusPythonResolvedEnvironment;
  readonly context: unknown;
  readonly schema: unknown;
  readonly secrets: readonly { readonly envName: string; readonly value: string }[];
  readonly writeGrant: { readonly kinds: readonly JuliusBrainRecordKind[]; readonly maxRecords: number };
}

export interface JuliusPythonRunnerPort {
  run(input: JuliusPythonRunInput, signal: AbortSignal): Promise<JuliusPythonRunOutcome>;
}

/* ------------------------------------------------------- untrusted output */

export interface JuliusPythonUsage {
  readonly interpreter: { readonly version: string; readonly implementation: string; readonly platform: string } | null;
  readonly enforcement: Readonly<Record<string, string>>;
  readonly denialCount: number | null;
  readonly scriptError: string | null;
  readonly structuredOutputError: string | null;
  readonly dependencies: JuliusBrainJson | null;
  readonly unsatisfiedRequirements: JuliusBrainJson | null;
  readonly peakMemoryBytes: number | null;
  readonly cpuSeconds: number | null;
}

const asObject = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
const finiteOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const stringOrNull = (value: unknown, max = 256): string | null => (typeof value === 'string' ? value.slice(0, max) : null);

/** The runner's self-report, read defensively: anything malformed is Unknown. */
export function parseJuliusPythonUsage(text: string | null): JuliusPythonUsage | null {
  if (text === null) return null;
  let raw: Record<string, unknown> | null;
  try { raw = asObject(JSON.parse(text)); } catch { return null; }
  if (raw === null || raw.format !== 'julius-python-usage.v1') return null;
  const interpreter = asObject(raw.interpreter);
  const enforcement: Record<string, string> = {};
  for (const [key, value] of Object.entries(asObject(raw.enforcement) ?? {}).slice(0, 12)) if (typeof value === 'string') enforcement[key.slice(0, 64)] = value.slice(0, 64);
  const json = (value: unknown): JuliusBrainJson | null => { try { canonicalJuliusBrainJson(value); return value as JuliusBrainJson; } catch { return null; } };
  return {
    interpreter: interpreter === null ? null : { version: String(interpreter.version ?? 'Unknown').slice(0, 64), implementation: String(interpreter.implementation ?? 'Unknown').slice(0, 64), platform: String(interpreter.platform ?? 'Unknown').slice(0, 256) },
    enforcement,
    denialCount: Number.isSafeInteger(raw.denialCount) ? raw.denialCount as number : null,
    scriptError: stringOrNull(raw.scriptError, 128),
    structuredOutputError: stringOrNull(raw.structuredOutputError, 128),
    dependencies: json(raw.dependencies),
    unsatisfiedRequirements: json(raw.unsatisfiedRequirements),
    peakMemoryBytes: Number.isSafeInteger(raw.peakMemoryBytes) ? raw.peakMemoryBytes as number : null,
    cpuSeconds: finiteOrNull(raw.cpuSeconds),
  };
}

export interface JuliusPythonStructuredResult {
  readonly status: 'VALID' | 'INVALID' | 'ABSENT';
  readonly errors: readonly string[];
  readonly valueSet: boolean;
  readonly value: JuliusBrainJson | null;
  readonly metrics: readonly { readonly name: string; readonly value: number | null; readonly unit: string | null }[];
  readonly proposalCount: number | null;
}

export function parseJuliusPythonResult(executionId: string, text: string | null, tooLarge: boolean): JuliusPythonStructuredResult {
  const empty = { valueSet: false, value: null, metrics: [], proposalCount: null };
  if (tooLarge) return { status: 'INVALID', errors: ['result: larger than 1 MiB'], ...empty };
  if (text === null) return { status: 'ABSENT', errors: [], ...empty };
  let raw: Record<string, unknown> | null;
  try { raw = asObject(JSON.parse(text)); } catch { return { status: 'INVALID', errors: ['result: not JSON'], ...empty }; }
  if (raw === null || raw.format !== 'julius-python-result.v1') return { status: 'INVALID', errors: ['result: unsupported format'], ...empty };
  if (raw.executionId !== executionId) return { status: 'INVALID', errors: ['result: belongs to another execution'], ...empty };
  const errors: string[] = [];
  try { canonicalJuliusBrainJson(raw.value); } catch { errors.push('result.value: not finite JSON'); }
  const metrics: { name: string; value: number | null; unit: string | null }[] = [];
  if (!Array.isArray(raw.metrics)) errors.push('result.metrics: must be a list');
  else for (const [index, metric] of raw.metrics.slice(0, 256).entries()) {
    const item = asObject(metric);
    if (item === null || typeof item.name !== 'string' || (item.value !== null && (typeof item.value !== 'number' || !Number.isFinite(item.value))) || (item.unit !== null && typeof item.unit !== 'string')) {
      errors.push(`result.metrics[${index}]: {name, value: number|null, unit: string|null}`);
    } else metrics.push({ name: item.name.slice(0, 256), value: item.value as number | null, unit: item.unit === null ? null : String(item.unit).slice(0, 64) });
  }
  if (errors.length > 0) return { status: 'INVALID', errors, ...empty };
  return { status: 'VALID', errors: [], valueSet: raw.valueSet === true, value: (raw.value ?? null) as JuliusBrainJson, metrics, proposalCount: Number.isSafeInteger(raw.proposalCount) ? raw.proposalCount as number : null };
}

export const juliusPythonExecutionEntityId = (executionId: string): string => `python-execution:${executionId}`;
export const juliusPythonToolPrincipalId = (executionId: string): string => `python.run:${executionId}`;
export const juliusPythonGrantId = (executionId: string): string => `python-grant:${executionId}`;

export interface JuliusPythonProposalConversion {
  readonly status: 'NONE' | 'VALID' | 'INVALID';
  readonly staged: number | null;
  readonly errors: readonly string[];
  readonly drafts: readonly JuliusBrainDraft[];
}

const ALLOWED_TOOL_RELATIONS: readonly JuliusBrainLink['relation'][] = ['CONTRADICTS', 'SUPPORTS', 'DERIVED_FROM', 'RESOLVES', 'EVIDENCED_BY', 'ANSWERS', 'PRODUCED_BY', 'RELATES_TO'];

/**
 * STAGED PROPOSALS → BRAIN DRAFTS, ALL OR NOTHING. One invalid proposal
 * rejects the batch: admitting "the valid half" of a script's output would
 * record a picture of the analysis the script never produced.
 *
 * The host overwrites what only the host observed: artifact hash, size and
 * storage reference; eval reproducibility (code, inputs, environment, run);
 * provenance; scope. A link may point only at an entity the execution was
 * allowed to see, or at another proposal of the same execution.
 */
export function convertJuliusPythonProposals(input: {
  readonly request: JuliusPythonExecutionRequest;
  readonly text: string | null;
  readonly tooLarge: boolean;
  readonly visibleEntityIds: ReadonlySet<string>;
  readonly artifacts: readonly JuliusPythonCollectedArtifact[];
  readonly scriptHash: string;
  readonly environmentHash: string | null;
  readonly occurredAt: string;
}): JuliusPythonProposalConversion {
  const { request } = input;
  const fail = (errors: string[], staged: number | null): JuliusPythonProposalConversion => ({ status: 'INVALID', staged, errors: errors.slice(0, 16), drafts: [] });
  if (input.tooLarge) return fail(['proposals: larger than 2 MiB'], null);
  if (input.text === null || input.text.trim() === '') return { status: 'NONE', staged: 0, errors: [], drafts: [] };
  const lines = input.text.split('\n').filter((line) => line.trim() !== '');
  const cap = Math.min(request.brainWrite.maxRecords, request.limits.maxProposals);
  if (lines.length > cap) return fail([`proposals: ${lines.length} staged, the grant allows ${cap}`], lines.length);
  const parsed: Record<string, unknown>[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      const item = asObject(JSON.parse(line));
      if (item === null || item.format !== 'julius-python-proposal.v1') return fail([`proposals[${index}]: unsupported format`], lines.length);
      parsed.push(item);
    } catch { return fail([`proposals[${index}]: not JSON`], lines.length); }
  }
  const executionEntityId = juliusPythonExecutionEntityId(request.executionId);
  const entityIdFor = new Map<string, string>();
  for (const [index, item] of parsed.entries()) {
    if (typeof item.proposalId !== 'string' || !/^p\d{4}$/.test(item.proposalId)) return fail([`proposals[${index}].proposalId: invalid`], lines.length);
    if (entityIdFor.has(item.proposalId)) return fail([`proposals[${index}].proposalId: duplicate`], lines.length);
    entityIdFor.set(item.proposalId, `python:${request.executionId}:${item.proposalId}`);
  }
  const errors: string[] = [];
  const drafts: JuliusBrainDraft[] = [];
  const usedArtifacts = new Set<string>();
  for (const [index, item] of parsed.entries()) {
    const at = `proposals[${index}]`;
    const kind = item.kind as JuliusBrainRecordKind;
    if (!request.brainWrite.kinds.includes(kind) || !JULIUS_BRAIN_OBSERVATION_KINDS.includes(kind)) { errors.push(`${at}.kind: ${String(item.kind)} is not granted`); continue; }
    let body = asObject(item.body);
    if (body === null) { errors.push(`${at}.body: must be an object`); continue; }
    if (kind === 'ARTIFACT') {
      const artifact = input.artifacts.find((candidate) => candidate.name === item.artifactName);
      if (artifact === undefined || artifact.quarantined !== null || artifact.contentHash === null || artifact.storageRef === null) {
        errors.push(`${at}.artifactName: ${String(item.artifactName)} was not collected${artifact?.quarantined ? ` (${artifact.quarantined})` : ''}`);
        continue;
      }
      if (usedArtifacts.has(artifact.name)) { errors.push(`${at}.artifactName: registered twice`); continue; }
      usedArtifacts.add(artifact.name);
      body = { ...body, name: artifact.name, byteSize: artifact.byteSize, contentHash: artifact.contentHash, storageRef: artifact.storageRef };
    }
    if (kind === 'EVAL') {
      const reproducibility = asObject(body.reproducibility) ?? {};
      body = { ...body, reproducibility: {
        seed: Number.isSafeInteger(reproducibility.seed) ? reproducibility.seed : null,
        codeHash: input.scriptHash, inputsHash: juliusPythonInputsHash(request), environmentHash: input.environmentHash,
        commit: null, command: null, environmentRunId: request.executionId,
      } };
    }
    const bodyErrors = validateJuliusBrainObject(JULIUS_BRAIN_BODY_SCHEMAS[kind], body, `${at}.body`);
    if (bodyErrors.length > 0) { errors.push(...bodyErrors.slice(0, 4)); continue; }
    const links: JuliusBrainLink[] = [];
    for (const [linkIndex, raw] of (Array.isArray(item.links) ? item.links : []).entries()) {
      const link = asObject(raw);
      const relation = link?.relation as JuliusBrainLink['relation'];
      const target = typeof link?.target === 'string' ? link.target : '';
      if (link === null || !ALLOWED_TOOL_RELATIONS.includes(relation)) { errors.push(`${at}.links[${linkIndex}].relation: not permitted`); continue; }
      const resolved = target.startsWith('proposal:') ? entityIdFor.get(target.slice('proposal:'.length)) : (input.visibleEntityIds.has(target) ? target : undefined);
      if (resolved === undefined) { errors.push(`${at}.links[${linkIndex}].target: ${target.slice(0, 128)} is not a granted entity or a proposal of this execution`); continue; }
      links.push({ relation, target: resolved, targetVersion: null });
    }
    if (!Array.isArray(item.links) && item.links !== undefined) errors.push(`${at}.links: must be a list`);
    links.push({ relation: 'PRODUCED_BY', target: executionEntityId, targetVersion: null });
    const confidence = item.confidence === null || item.confidence === undefined ? null : Number(item.confidence);
    if (confidence !== null && !(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) { errors.push(`${at}.confidence: must be null or within 0..1`); continue; }
    const retention = item.retention === 'WORKING' ? 'WORKING' : item.retention === 'DURABLE' || item.retention === undefined ? 'DURABLE' : null;
    if (retention === null) { errors.push(`${at}.retention: DURABLE or WORKING`); continue; }
    drafts.push({
      kind, op: 'CREATE', entityId: entityIdFor.get(String(item.proposalId))!, expectedVersion: 0,
      body: body as JuliusBrainDraft['body'],
      links, scope: { missionId: request.missionId, runId: request.runId, taskId: request.taskId },
      retention, confidence, sensitivity: 'INTERNAL',
      provenance: juliusBrainProvenance('tool_observed', { tool: JULIUS_PYTHON_TOOL_ID, executionId: request.executionId }),
      idempotencyKey: `python:${request.executionId}:${String(item.proposalId)}`,
      occurredAt: input.occurredAt,
    });
  }
  if (errors.length > 0) return fail(errors, lines.length);
  return { status: 'VALID', staged: lines.length, errors: [], drafts };
}

/** The per-execution write grant the tool principal writes under. */
export function juliusPythonWriteGrant(request: JuliusPythonExecutionRequest, expiresAt: string): JuliusBrainWriteGrant {
  return {
    grantId: juliusPythonGrantId(request.executionId),
    brainId: request.brainId,
    principalId: juliusPythonToolPrincipalId(request.executionId),
    issuedBy: 'julius',
    kinds: request.brainWrite.kinds.filter((kind) => JULIUS_BRAIN_OBSERVATION_KINDS.includes(kind)),
    missionId: request.missionId,
    taskId: request.taskId,
    maxRecords: Math.min(request.brainWrite.maxRecords, request.limits.maxProposals),
    expiresAt,
  };
}
