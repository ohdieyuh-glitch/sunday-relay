#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// relay-hermes-service/main.ts
var main_exports = {};
__export(main_exports, {
  main: () => main
});
module.exports = __toCommonJS(main_exports);

// relay-bridge/reviewer-harness/hermes/local-transport.ts
var import_node_crypto = require("node:crypto");

// relay-bridge/reviewer-harness/hermes/discovery.ts
var import_node_child_process = require("node:child_process");

// relay-bridge/redact.ts
var MAX_LEN = 600;
var SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  // OpenAI / Anthropic style keys
  /\b(?:xox[baprs]|ghp|gho|ghu|ghs|ghr)-[A-Za-z0-9-]{10,}/g,
  // slack/github tokens
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b(?:api[_-]?key|secret|token|password|authorization)\b\s*[:=]\s*\S+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g
  // JWTs
];
function stripAbsolutePaths(text) {
  return text.replace(/(?:\/(?:home|Users|tmp|var|root)\/[^\s"'`)]+)/g, (m) => {
    const base = m.split("/").filter(Boolean).pop() ?? "";
    return base ? `\u2026/${base}` : "\u2026";
  });
}
function safeText(input) {
  let text = typeof input === "string" ? input : String(input ?? "");
  for (const re of SECRET_PATTERNS) text = text.replace(re, "[redacted]");
  text = stripAbsolutePaths(text);
  text = text.replace(/\n\s*at\s+.+/g, "").replace(/\s+/g, " ").trim();
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}\u2026`;
  return text;
}

// relay-bridge/reviewer-harness/hermes/discovery.ts
var REQUIRED_ONESHOT_FLAGS = ["-z", "--usage-file", "-t", "--ignore-rules"];
var MINIMUM_HERMES_VERSION = "0.18.0";
var NOT_INSTALLED = Object.freeze({
  installed: false,
  binaryPath: null,
  version: null,
  compatible: false,
  machineInterface: null,
  machineInterfaceVerified: false,
  supportedFlags: [],
  missingFlags: [...REQUIRED_ONESHOT_FLAGS],
  acpAvailable: false,
  readOnlyEnforceable: false,
  failureReason: "No Hermes runtime was found. Install Hermes Agent and make it reachable on PATH."
});
function createProbe(isolatedHome) {
  return (executable, args) => {
    try {
      const r = (0, import_node_child_process.spawnSync)(executable, args, {
        encoding: "utf8",
        timeout: 2e4,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "", HOME: isolatedHome, HERMES_HOME: isolatedHome }
      });
      if (r.error) return { ok: false, text: "" };
      return { ok: r.status === 0, text: `${r.stdout ?? ""}
${r.stderr ?? ""}` };
    } catch {
      return { ok: false, text: "" };
    }
  };
}
function parseHermesVersion(text) {
  const m = /Hermes\s+Agent\s+v(\d+\.\d+\.\d+)/i.exec(text) ?? /^v?(\d+\.\d+\.\d+)$/m.exec(text.trim());
  return m ? m[1] : null;
}
function versionAtLeast(found, minimum) {
  if (found === null) return false;
  const a = found.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  if (a.some((n) => !Number.isFinite(n))) return false;
  for (let i = 0; i < 3; i += 1) {
    const l = a[i] ?? 0;
    const r = b[i] ?? 0;
    if (l !== r) return l > r;
  }
  return true;
}
function discoverHermes(input) {
  const { executable, probe } = input;
  const version = probe(executable, ["--version"]);
  if (!version.ok && !version.text.trim()) return NOT_INSTALLED;
  const parsedVersion = parseHermesVersion(version.text);
  const compatible = versionAtLeast(parsedVersion, MINIMUM_HERMES_VERSION);
  const help = probe(executable, ["--help"]);
  const supportedFlags = REQUIRED_ONESHOT_FLAGS.filter((flag) => help.text.includes(flag));
  const missingFlags = REQUIRED_ONESHOT_FLAGS.filter((flag) => !help.text.includes(flag));
  const acp = probe(executable, ["acp", "--check"]);
  const acpAvailable = acp.ok && /ACP check OK/i.test(acp.text);
  const machineInterfaceVerified = missingFlags.length === 0 && compatible;
  const machineInterface = machineInterfaceVerified ? "oneshot_json" : null;
  const readOnlyEnforceable = help.text.includes("-t") && help.text.includes("--ignore-rules");
  const failureReason = (() => {
    if (parsedVersion === null) return "Relay could not read a Hermes version from this runtime.";
    if (!compatible) {
      return `Hermes ${parsedVersion} is older than the minimum ${MINIMUM_HERMES_VERSION} this adapter requires.`;
    }
    if (missingFlags.length > 0) {
      return `This Hermes build does not expose ${missingFlags.join(", ")}, which the one-shot transport requires.`;
    }
    if (!readOnlyEnforceable) return "Relay cannot prove read-only execution for this Hermes build.";
    return null;
  })();
  return {
    installed: true,
    binaryPath: safeText(executable),
    version: parsedVersion === null ? null : safeText(parsedVersion),
    compatible,
    machineInterface,
    machineInterfaceVerified,
    supportedFlags,
    missingFlags,
    acpAvailable,
    readOnlyEnforceable,
    failureReason
  };
}

// relay-bridge/reviewer-harness/hermes/isolated-profile.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
var DISABLED_TOOLSETS = Object.freeze([
  "web",
  "browser",
  "terminal",
  "file",
  "code_execution",
  "vision",
  "video",
  "image_gen",
  "video_gen",
  "x_search",
  "tts",
  "skills",
  "todo",
  "memory",
  "context_engine",
  "session_search",
  "clarify",
  "delegation",
  "cronjob",
  "homeassistant",
  "spotify",
  "yuanbao",
  "computer_use"
]);
var WRITE_CAPABLE_TOOLSETS = Object.freeze([
  "terminal",
  "file",
  "code_execution",
  "browser",
  "computer_use",
  "delegation",
  "cronjob",
  "memory",
  "skills",
  "web",
  "x_search"
]);
function yamlList(values) {
  return values.map((v) => `    - ${v}`).join("\n");
}
function isolatedConfigYaml() {
  return [
    "# Relay-owned Reviewer profile. Generated per run; never the operator's.",
    "agent:",
    "  disabled_toolsets:",
    yamlList(DISABLED_TOOLSETS),
    "  max_turns: 1",
    "mcp_servers: {}",
    "plugins: []",
    "hooks: {}",
    "hooks_auto_accept: false",
    "memory:",
    "  enabled: false",
    "checkpoints:",
    "  enabled: false",
    ""
  ].join("\n");
}
function createIsolatedProfile(root) {
  const base = root ?? (0, import_node_os.tmpdir)();
  const home = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)(base, "relay-hermes-profile-"));
  (0, import_node_fs.chmodSync)(home, 448);
  const cwd = (0, import_node_path.join)(home, "scratch");
  (0, import_node_fs.mkdirSync)(cwd, { recursive: true });
  (0, import_node_fs.chmodSync)(cwd, 448);
  const configPath = (0, import_node_path.join)(home, "config.yaml");
  (0, import_node_fs.writeFileSync)(configPath, isolatedConfigYaml(), { encoding: "utf8", mode: 384 });
  (0, import_node_fs.chmodSync)(configPath, 384);
  const usageFilePath = (0, import_node_path.join)(home, "usage.json");
  return {
    home,
    cwd,
    configPath,
    usageFilePath,
    dispose: () => {
      try {
        (0, import_node_fs.rmSync)(home, { recursive: true, force: true });
      } catch {
      }
    }
  };
}
function isolatedChildEnv(input) {
  const env = {
    PATH: input.path ?? process.env.PATH ?? "",
    HOME: input.profile.home,
    HERMES_HOME: input.profile.home,
    // Belt and braces alongside the profile: rules and hook prompts off.
    HERMES_IGNORE_RULES: "1",
    // A non-interactive child must never wait on a terminal prompt.
    NO_COLOR: "1",
    TERM: "dumb"
  };
  if (input.apiKey !== null && input.apiKey !== "") env[input.apiKeyEnvVar] = input.apiKey;
  if (input.baseUrl !== null && input.baseUrl !== "") env[input.baseUrlEnvVar] = input.baseUrl;
  return env;
}

// relay-bridge/reviewer-harness/hermes/xai-models.ts
var XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";
var XAI_API_KEY_ENV = "XAI_API_KEY";
var XAI_BASE_URL_ENV = "XAI_BASE_URL";
function loadXaiConfig(env = process.env) {
  const raw = env[XAI_API_KEY_ENV];
  const key = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  const base = env[XAI_BASE_URL_ENV];
  return {
    apiKey: key,
    baseUrl: typeof base === "string" && base.trim() !== "" ? base.trim() : XAI_DEFAULT_BASE_URL,
    requestedModel: env.RELAY_REVIEWER_MODEL?.trim() || null,
    timeoutMs: Number(env.RELAY_REVIEWER_MODEL_TIMEOUT_MS ?? 2e4)
  };
}
function describeXaiConfig(cfg) {
  return {
    credentialPresent: cfg.apiKey !== null,
    baseUrl: cfg.baseUrl,
    requestedModel: cfg.requestedModel
  };
}
function parseModelList(body) {
  if (body === null || typeof body !== "object") return [];
  const data = body.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const o = entry;
    if (typeof o.id !== "string" || o.id.trim() === "") return [];
    return [{
      id: o.id,
      created: typeof o.created === "number" ? o.created : null,
      ownedBy: typeof o.owned_by === "string" ? o.owned_by : null
    }];
  });
}
async function verifyXaiModel(input) {
  const now = input.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const cfg = input.config;
  if (cfg.apiKey === null) {
    return {
      kind: "credentials_missing",
      safeMessage: `No ${XAI_API_KEY_ENV} is configured on the Relay Bridge. The browser never holds this credential.`
    };
  }
  if (cfg.requestedModel === null || cfg.requestedModel === "") {
    return {
      kind: "unreachable",
      checkedAt: now(),
      safeMessage: "No Reviewer model is configured on the Relay Bridge, and Relay will not choose one."
    };
  }
  const doFetch = input.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers: {
        // The ONLY place the credential is used. It is never logged, never
        // echoed into an error, and never persisted.
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!res.ok) {
      return {
        kind: "unreachable",
        checkedAt: now(),
        // Status only. A provider error body can quote the request, which can
        // quote the header.
        safeMessage: `The model provider rejected the verification request (HTTP ${res.status}).`
      };
    }
    const models = parseModelList(await res.json());
    const available = models.map((m) => m.id);
    const match = models.find((m) => m.id === cfg.requestedModel);
    if (match === void 0) {
      return {
        kind: "model_unavailable",
        requestedModel: cfg.requestedModel,
        availableModels: available,
        checkedAt: now(),
        safeMessage: `The authenticated account cannot use ${safeText(cfg.requestedModel)}. Relay does not substitute another model.`
      };
    }
    return {
      kind: "verified",
      requestedModel: cfg.requestedModel,
      verifiedModelId: match.id,
      availableModels: available,
      checkedAt: now()
    };
  } catch {
    return {
      kind: "unreachable",
      checkedAt: now(),
      safeMessage: "Relay could not reach the model provider to verify the requested model."
    };
  } finally {
    clearTimeout(timer);
  }
}

// relay-bridge/reviewer-harness/hermes/readiness.ts
function evidenceFrom(input) {
  const d = input.discovery;
  return {
    // This function only ever runs INSIDE a bridge process, so by construction
    // a bridge answered.
    bridgeAvailable: true,
    installed: d.installed,
    binaryPath: d.binaryPath,
    version: d.version,
    compatible: d.compatible,
    machineInterface: d.machineInterface,
    machineInterfaceVerified: d.machineInterfaceVerified,
    credentialPresent: input.credentialPresent,
    modelVerified: input.modelVerified,
    requestedModel: input.requestedModel,
    verifiedModelId: input.verifiedModelId,
    readOnlyEnforceable: d.readOnlyEnforceable,
    checkedAt: input.checkedAt,
    failureReason: input.failureReason ?? d.failureReason
  };
}
function localReadiness(input) {
  const now = input.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const discovery = discoverHermes({ executable: input.executable, probe: input.probe });
  const described = describeXaiConfig(input.xai);
  return evidenceFrom({
    discovery,
    credentialPresent: described.credentialPresent,
    requestedModel: described.requestedModel,
    // A credential is not a verified model, and a local check cannot prove one.
    modelVerified: false,
    verifiedModelId: null,
    checkedAt: now(),
    failureReason: null
  });
}
async function verifiedReadiness(input) {
  const now = input.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const local = localReadiness(input);
  const localBlocked = !local.installed || !local.compatible || !local.machineInterfaceVerified || !local.readOnlyEnforceable || !local.credentialPresent;
  if (localBlocked) {
    return { evidence: local, verification: null, providerRequestMade: false };
  }
  const verification = await verifyXaiModel({
    config: input.xai,
    fetchImpl: input.fetchImpl,
    now
  });
  const verified = verification.kind === "verified";
  return {
    evidence: {
      ...local,
      modelVerified: verified,
      verifiedModelId: verified ? verification.verifiedModelId : null,
      checkedAt: now(),
      failureReason: verified ? null : verification.kind === "credentials_missing" ? verification.safeMessage : verification.safeMessage
    },
    verification,
    providerRequestMade: true
  };
}

// relay-bridge/reviewer-harness/hermes/runner.ts
var import_node_child_process2 = require("node:child_process");
var import_node_fs2 = require("node:fs");
var DEFAULT_RUN_LIMITS = Object.freeze({
  timeoutMs: 18e4,
  maxOutputBytes: 512 * 1024,
  maxTurns: 1,
  maxPromptBytes: 256 * 1024
});
var UNKNOWN_USAGE = Object.freeze({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  model: null,
  apiCalls: null,
  costMicros: null,
  currency: null,
  source: "unavailable"
});
function parseUsageFile(path) {
  if (!(0, import_node_fs2.existsSync)(path)) return UNKNOWN_USAGE;
  let raw;
  try {
    raw = JSON.parse((0, import_node_fs2.readFileSync)(path, "utf8"));
  } catch {
    return UNKNOWN_USAGE;
  }
  if (raw === null || typeof raw !== "object") return UNKNOWN_USAGE;
  const o = raw;
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const input = num(o.input_tokens ?? o.prompt_tokens);
  const output = num(o.output_tokens ?? o.completion_tokens);
  const total = num(o.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  const cost = o.estimated_cost ?? o.cost;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    model: typeof o.model === "string" && o.model.trim() !== "" ? safeText(o.model) : null,
    apiCalls: num(o.api_calls),
    // Reported cost is carried as a STRING with its provenance, never turned
    // into a computed figure Relay would then have to defend.
    costMicros: typeof cost === "number" && Number.isFinite(cost) ? String(Math.round(cost * 1e6)) : null,
    currency: typeof cost === "number" ? "USD" : null,
    source: input === null && output === null && typeof o.model !== "string" ? "unavailable" : "harness_reported"
  };
}
function buildHermesArgs(input) {
  return [
    "-z",
    input.prompt,
    "--usage-file",
    input.usageFilePath,
    "-m",
    input.model,
    "--provider",
    input.provider,
    // No AGENTS.md, SOUL.md, .cursorrules, memory or preloaded skills. The
    // isolated profile already contains none of these; this is the second lock.
    "--ignore-rules"
  ];
}
function terminateTree(child, afterMs = 5e3) {
  const pid = child.pid;
  const kill = (signal) => {
    try {
      if (pid !== void 0) process.kill(-pid, signal);
      else child.kill(signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
      }
    }
  };
  kill("SIGTERM");
  const hard = setTimeout(() => kill("SIGKILL"), afterMs);
  hard.unref?.();
  child.once("close", () => clearTimeout(hard));
}
async function runHermesReviewer(input) {
  const now = input.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const limits = input.limits ?? DEFAULT_RUN_LIMITS;
  const doSpawn = input.spawnImpl ?? import_node_child_process2.spawn;
  if (Buffer.byteLength(input.prompt, "utf8") > limits.maxPromptBytes) {
    return {
      kind: "launch_failed",
      safeMessage: "The review evidence exceeds the configured input limit. Relay blocks rather than silently truncating material the verdict depends on."
    };
  }
  const ownedProfile = input.profile === void 0;
  const profile = input.profile ?? createIsolatedProfile();
  const args = buildHermesArgs({
    prompt: input.prompt,
    model: input.model,
    provider: input.provider,
    usageFilePath: profile.usageFilePath
  });
  const env = isolatedChildEnv({
    profile,
    apiKey: input.apiKey,
    apiKeyEnvVar: XAI_API_KEY_ENV,
    baseUrl: input.baseUrl,
    baseUrlEnvVar: XAI_BASE_URL_ENV
  });
  const startedAt = now();
  return await new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (o) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (ownedProfile) profile.dispose();
      resolve(o);
    };
    try {
      child = doSpawn(input.executable, args, {
        cwd: profile.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        // Its own process group, so a timeout can end the whole tree.
        detached: true
      });
    } catch {
      if (ownedProfile) profile.dispose();
      resolve({ kind: "launch_failed", safeMessage: "The Hermes Reviewer could not be started." });
      return;
    }
    let out = "";
    let bytes = 0;
    let truncated = false;
    const timer = setTimeout(() => {
      terminateTree(child);
      finish({
        kind: "timed_out",
        safeMessage: `The Hermes Reviewer exceeded its ${limits.timeoutMs} ms limit and was stopped.`,
        startedAt,
        completedAt: now(),
        usage: parseUsageFile(profile.usageFilePath)
      });
    }, limits.timeoutMs);
    const onAbort = () => {
      terminateTree(child);
      finish({
        kind: "cancelled",
        safeMessage: "The Hermes Reviewer run was cancelled. Evidence already received is preserved.",
        startedAt,
        completedAt: now(),
        usage: parseUsageFile(profile.usageFilePath)
      });
    };
    if (input.signal?.aborted === true) {
      onAbort();
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (c) => {
      bytes += c.length;
      if (bytes <= limits.maxOutputBytes) out += c.toString("utf8");
      else truncated = true;
    });
    child.stderr?.on("data", () => {
    });
    child.on("error", () => finish({ kind: "launch_failed", safeMessage: "The Hermes Reviewer could not be started." }));
    child.on("close", (code, signal) => {
      const completedAt = now();
      const usage = parseUsageFile(profile.usageFilePath);
      if (signal !== null) {
        finish({
          kind: "cancelled",
          safeMessage: "The Hermes Reviewer was terminated before it returned a result.",
          startedAt,
          completedAt,
          usage
        });
        return;
      }
      if (code !== 0) {
        finish({
          kind: "failed",
          safeMessage: `The Hermes Reviewer exited without a result (code ${code ?? "unknown"}).`,
          startedAt,
          completedAt,
          exitCode: code,
          usage
        });
        return;
      }
      finish({
        kind: "completed",
        // Redacted before it can reach a log, a record or a user.
        stdout: truncated ? `${safeText(out)}
[output truncated at limit]` : safeText(out),
        usage,
        startedAt,
        completedAt,
        exitCode: code
      });
    });
  });
}

// relay-bridge/reviewer-harness/hermes/hermes-transport.ts
var HERMES_SERVICE_PROTOCOL = "relay-hermes-reviewer.v1";

// relay-bridge/reviewer-harness/hermes/hermes-provider.ts
var HERMES_PROVIDERS = ["anthropic", "xai"];
var HERMES_PROVIDER_ENV = "RELAY_HERMES_PROVIDER";
var HERMES_MODEL_ENV = "RELAY_HERMES_MODEL";
var PROVIDER_CREDENTIAL_ENV = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY"
});
var PROVIDER_SUPPORTS_LISTING = Object.freeze({ anthropic: false, xai: true });
var isProvider = (value) => HERMES_PROVIDERS.includes(value);
function loadHermesProviderConfig(env) {
  const rawProvider = (env[HERMES_PROVIDER_ENV] ?? "").trim();
  if (rawProvider === "") {
    return {
      ok: false,
      kind: "configuration_missing",
      safeMessage: `No ${HERMES_PROVIDER_ENV} is configured, and Relay will not choose a Reviewer provider.`
    };
  }
  if (!isProvider(rawProvider)) {
    return {
      ok: false,
      kind: "configuration_missing",
      // The rejected value is NOT echoed: it is operator-supplied text.
      safeMessage: `${HERMES_PROVIDER_ENV} must be one of: ${HERMES_PROVIDERS.join(", ")}.`
    };
  }
  const requestedModel = (env[HERMES_MODEL_ENV] ?? "").trim();
  if (requestedModel === "") {
    return {
      ok: false,
      kind: "configuration_missing",
      safeMessage: `No ${HERMES_MODEL_ENV} is configured, and Relay will not choose a model on your behalf.`
    };
  }
  const credentialEnvName = PROVIDER_CREDENTIAL_ENV[rawProvider];
  const rawCredential = env[credentialEnvName];
  return {
    ok: true,
    config: {
      provider: rawProvider,
      requestedModel,
      credentialEnvName,
      credentialPresent: typeof rawCredential === "string" && rawCredential.trim() !== "",
      verifiable: PROVIDER_SUPPORTS_LISTING[rawProvider]
    }
  };
}
function describeProvider(config, verifiedModelId = null) {
  return {
    provider: config.provider,
    requestedModel: config.requestedModel,
    credentialPresent: config.credentialPresent,
    verifiable: config.verifiable,
    // There is deliberately no fallback to requestedModel here.
    verifiedModelId
  };
}

// relay-bridge/reviewer-harness/hermes/local-transport.ts
function createLocalHermesTransport(config) {
  const now = config.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const env = config.env ?? process.env;
  const runs = /* @__PURE__ */ new Map();
  const byIdempotencyKey = /* @__PURE__ */ new Map();
  const probeFor = () => {
    const profile = createIsolatedProfile();
    return { profile, probe: createProbe(profile.home) };
  };
  return {
    mode: "local",
    async readiness() {
      const { profile, probe } = probeFor();
      try {
        return localReadiness({
          executable: config.executable,
          probe,
          xai: loadXaiConfig(env),
          now
        });
      } finally {
        profile.dispose();
      }
    },
    async testConnection() {
      const { profile, probe } = probeFor();
      try {
        const result = await verifiedReadiness({
          executable: config.executable,
          probe,
          xai: loadXaiConfig(env),
          now
        });
        const connected = result.evidence.modelVerified;
        return {
          connected,
          // Verifying a connection never creates a run.
          runCreated: false,
          protocol: HERMES_SERVICE_PROTOCOL,
          identity: describeProvider(
            config.provider,
            connected ? result.evidence.verifiedModelId : null
          ),
          failureKind: connected ? null : "provider_unverified",
          safeMessage: connected ? null : result.evidence.failureReason ?? "The Hermes Reviewer is not connected.",
          checkedAt: now()
        };
      } finally {
        profile.dispose();
      }
    },
    async startReview(input) {
      const existing = byIdempotencyKey.get(input.idempotencyKey);
      if (existing !== void 0) {
        return { accepted: true, runId: existing, duplicate: true, failureKind: null, safeMessage: null };
      }
      const runId = input.runId.trim() === "" ? (0, import_node_crypto.randomUUID)() : input.runId;
      const controller = new AbortController();
      const run = { status: "running", outcome: null, controller, cancelRequested: false };
      runs.set(runId, run);
      byIdempotencyKey.set(input.idempotencyKey, runId);
      void runHermesReviewer({
        executable: config.executable,
        prompt: input.prompt,
        model: config.provider.requestedModel,
        provider: config.provider.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl ?? null,
        limits: { ...DEFAULT_RUN_LIMITS, ...input.limits },
        signal: controller.signal,
        now,
        spawnImpl: config.spawnImpl
      }).then((outcome) => {
        run.outcome = outcome;
        run.status = run.cancelRequested ? "cancelled" : outcome.kind === "completed" ? "completed" : outcome.kind === "timed_out" ? "timed_out" : outcome.kind === "cancelled" ? "cancelled" : "failed";
      }).catch(() => {
        run.outcome = null;
        run.status = "failed";
      });
      return { accepted: true, runId, duplicate: false, failureKind: null, safeMessage: null };
    },
    async getReview(runId) {
      const run = runs.get(runId);
      if (run === void 0) {
        return {
          runId,
          status: "failed",
          protocol: HERMES_SERVICE_PROTOCOL,
          reviewText: null,
          usage: { inputTokens: null, outputTokens: null, source: "unavailable" },
          failureKind: "service_unreachable",
          safeMessage: "This Relay Bridge has no record of that review. Local runs are held in memory and do not survive a restart."
        };
      }
      const outcome = run.outcome;
      const usage = outcome !== null && "usage" in outcome ? outcome.usage : null;
      return {
        runId,
        status: run.status,
        protocol: HERMES_SERVICE_PROTOCOL,
        // A verdict exists only for a genuinely completed run.
        reviewText: run.status === "completed" && outcome !== null && outcome.kind === "completed" ? outcome.stdout : null,
        usage: {
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          source: usage !== null && usage.source === "harness_reported" ? "harness_reported" : "unavailable"
        },
        failureKind: run.status === "timed_out" ? "timed_out" : null,
        safeMessage: outcome !== null && "safeMessage" in outcome ? outcome.safeMessage : null
      };
    },
    /**
     * Cancel every live run. Used by the service on SIGTERM so a container
     * restart never leaves an orphaned Hermes process group behind, and never
     * lets an interrupted review look like a finished one.
     */
    async cancelAll() {
      for (const [, run] of runs) {
        if (run.status === "running") {
          run.cancelRequested = true;
          run.controller.abort();
        }
      }
    },
    async cancelReview(runId) {
      const run = runs.get(runId);
      if (run === void 0) {
        return { requested: false, terminationConfirmed: false, safeMessage: "No such review." };
      }
      run.cancelRequested = true;
      run.controller.abort();
      return {
        requested: true,
        // Confirmed only once the run actually settled — a request is not a
        // confirmed termination.
        terminationConfirmed: run.outcome !== null,
        safeMessage: null
      };
    }
  };
}

// relay-hermes-service/service.ts
var import_node_crypto2 = require("node:crypto");
var import_node_http = require("node:http");
var SERVICE_TOKEN_ENV = "RELAY_HERMES_SERVICE_TOKEN";
var lifecycle = "starting";
function setLifecycleState(state) {
  lifecycle = state;
}
var MAX_BODY_BYTES = 512 * 1024;
function bearerMatches(header, expected) {
  if (typeof expected !== "string" || expected.trim() === "") return false;
  const presented = Buffer.from(
    typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "",
    "utf8"
  );
  const secret = Buffer.from(expected, "utf8");
  if (presented.length !== secret.length) {
    (0, import_node_crypto2.timingSafeEqual)(secret, secret);
    return false;
  }
  return (0, import_node_crypto2.timingSafeEqual)(presented, secret);
}
var ok = (extra) => ({ status: 200, body: { protocol: HERMES_SERVICE_PROTOCOL, ...extra } });
var err = (status, kind, message) => ({ status, body: { protocol: HERMES_SERVICE_PROTOCOL, kind, error: message } });
var isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var REVIEW_FIELDS = /* @__PURE__ */ new Set(["runId", "idempotencyKey", "prompt", "limits"]);
var LIMIT_FIELDS = /* @__PURE__ */ new Set(["timeoutMs", "maxOutputBytes", "maxTurns", "maxPromptBytes"]);
function parseReviewBody(raw) {
  if (!isRecord(raw)) return { ok: false, message: "A JSON object body is required." };
  for (const key of Object.keys(raw)) {
    if (!REVIEW_FIELDS.has(key)) return { ok: false, message: "The request contained an unsupported field." };
  }
  const str = (k) => {
    const v = raw[k];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const runId = str("runId");
  const idempotencyKey = str("idempotencyKey");
  const prompt = typeof raw.prompt === "string" && raw.prompt !== "" ? raw.prompt : null;
  if (runId === null || idempotencyKey === null || prompt === null) {
    return { ok: false, message: "runId, idempotencyKey and prompt are required." };
  }
  if (!isRecord(raw.limits)) return { ok: false, message: "limits is required." };
  for (const key of Object.keys(raw.limits)) {
    if (!LIMIT_FIELDS.has(key)) return { ok: false, message: "limits contained an unsupported field." };
  }
  const num = (k) => {
    const v = raw.limits[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
  const timeoutMs = num("timeoutMs");
  const maxOutputBytes = num("maxOutputBytes");
  const maxTurns = num("maxTurns");
  const maxPromptBytes = num("maxPromptBytes");
  if (timeoutMs === null || maxOutputBytes === null || maxTurns === null || maxPromptBytes === null) {
    return { ok: false, message: "limits must be positive numbers." };
  }
  return { ok: true, value: { runId, idempotencyKey, prompt, limits: { timeoutMs, maxOutputBytes, maxTurns, maxPromptBytes } } };
}
async function handleServiceRoute(request, engine) {
  const { method, path } = request;
  if (method === "GET" && path === "/healthz") {
    if (lifecycle === "ready") return { status: 200, body: { status: "ok" } };
    return {
      status: 503,
      body: { status: lifecycle === "shutting_down" ? "shutting_down" : "starting" }
    };
  }
  if (!bearerMatches(request.authorization, request.env[SERVICE_TOKEN_ENV])) {
    return err(401, "authentication_failed", "Authentication is required for the Hermes Reviewer service.");
  }
  if (method === "GET" && path === "/v1/readiness") {
    const evidence = await engine.readiness();
    return ok({
      lifecycle,
      evidence: {
        installed: evidence.installed,
        version: evidence.version,
        compatible: evidence.compatible,
        machineInterface: evidence.machineInterface,
        machineInterfaceVerified: evidence.machineInterfaceVerified,
        // Presence only — never the value, the length, or a hash.
        credentialPresent: evidence.credentialPresent,
        modelVerified: evidence.modelVerified,
        requestedModel: evidence.requestedModel,
        verifiedModelId: evidence.verifiedModelId,
        readOnlyEnforceable: evidence.readOnlyEnforceable,
        failureReason: evidence.failureReason
        // binaryPath is deliberately NOT included: it is host layout.
      },
      runCreated: false
    });
  }
  if (method === "POST" && path === "/v1/test-connection") {
    const evidence = await engine.testConnection();
    return ok({
      connected: evidence.connected,
      runCreated: false,
      identity: evidence.identity,
      failureKind: evidence.failureKind,
      safeMessage: evidence.safeMessage
    });
  }
  if (method === "POST" && path === "/v1/reviews") {
    if (lifecycle === "shutting_down") {
      return err(503, "shutting_down", "The Hermes Reviewer service is shutting down and is not accepting new reviews.");
    }
    const parsed = parseReviewBody(request.body);
    if (!parsed.ok) return err(422, "validation_failed", parsed.message);
    const started = await engine.startReview(parsed.value);
    return started.accepted ? ok({ accepted: true, runId: started.runId, duplicate: started.duplicate }) : err(409, started.failureKind ?? "malformed_response", started.safeMessage ?? "The review was refused.");
  }
  const stateMatch = /^\/v1\/reviews\/([^/]+)$/.exec(path);
  if (stateMatch !== null && method === "GET") {
    const state = await engine.getReview(decodeURIComponent(stateMatch[1]));
    return ok({
      runId: state.runId,
      status: state.status,
      reviewText: state.reviewText,
      usage: state.usage,
      failureKind: state.failureKind,
      safeMessage: state.safeMessage
    });
  }
  const cancelMatch = /^\/v1\/reviews\/([^/]+)\/cancel$/.exec(path);
  if (cancelMatch !== null && method === "POST") {
    const result = await engine.cancelReview(decodeURIComponent(cancelMatch[1]));
    return ok({
      requested: result.requested,
      terminationConfirmed: result.terminationConfirmed,
      safeMessage: result.safeMessage
    });
  }
  return err(404, "not_found", "Unknown Hermes Reviewer operation.");
}
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) {
        resolve(void 0);
        return;
      }
      if (chunks.length === 0) {
        resolve(void 0);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(void 0);
      }
    });
    req.on("error", () => resolve(void 0));
  });
}
function createHermesService(engine) {
  return (0, import_node_http.createServer)((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0];
      const method = req.method ?? "GET";
      let result;
      try {
        result = await handleServiceRoute({
          method,
          path,
          authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : void 0,
          body: method === "POST" ? await readBody(req) : void 0,
          env: process.env
        }, engine);
      } catch {
        result = err(500, "internal_error", "The Hermes Reviewer service could not complete the request.");
      }
      const payload = JSON.stringify(result.body);
      res.writeHead(result.status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        // This is a private machine API. No browser may reach it directly.
        "cache-control": "no-store"
      });
      res.end(payload);
    })();
  });
}

// relay-hermes-service/config.ts
var HERMES_EXECUTABLE_ENV = "RELAY_HERMES_EXECUTABLE";
var HOST_ENV = "HOST";
var PORT_ENV = "PORT";
var DEFAULT_PORT = 8791;
var DEFAULT_HOST = "0.0.0.0";
function loadServiceConfig(env) {
  const problems = [];
  const serviceToken = (env[SERVICE_TOKEN_ENV] ?? "").trim();
  if (serviceToken === "") {
    problems.push(`${SERVICE_TOKEN_ENV} is required; the Hermes Reviewer service will not start unauthenticated.`);
  }
  const executable = (env[HERMES_EXECUTABLE_ENV] ?? "").trim() || "hermes";
  const provider = loadHermesProviderConfig(env);
  if (!provider.ok) {
    problems.push(provider.safeMessage);
  }
  let apiKey = "";
  if (provider.ok) {
    apiKey = (env[provider.config.credentialEnvName] ?? "").trim();
    if (apiKey === "") {
      problems.push(
        `${provider.config.credentialEnvName} is required because ${provider.config.provider} is the configured provider.`
      );
    }
  }
  const rawPort = (env[PORT_ENV] ?? "").trim();
  let port = DEFAULT_PORT;
  if (rawPort !== "") {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      problems.push(`${PORT_ENV} must be an integer between 1 and 65535.`);
    } else {
      port = parsed;
    }
  }
  const host = (env[HOST_ENV] ?? "").trim() || DEFAULT_HOST;
  if (/\s/.test(host)) problems.push(`${HOST_ENV} is not a usable bind address.`);
  if (problems.length > 0 || !provider.ok) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    config: {
      host,
      port,
      serviceToken,
      executable,
      provider: provider.config,
      apiKey,
      production: env.NODE_ENV === "production"
    }
  };
}
function describeStartup(config) {
  return [
    `Hermes Reviewer service listening on ${config.host}:${config.port}`,
    `provider: ${config.provider.provider}`,
    `requested model: ${config.provider.requestedModel}`,
    `credential: configured`,
    `auth: required`,
    config.production ? "executable: configured" : `executable: ${config.executable}`
  ].join(" \xB7 ");
}

// relay-hermes-service/main.ts
var SHUTDOWN_GRACE_MS = 1e4;
function main() {
  const result = loadServiceConfig(process.env);
  if (!result.ok) {
    for (const problem of result.problems) {
      console.error(`Hermes Reviewer service cannot start: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  const config = result.config;
  const engine = createLocalHermesTransport({
    executable: config.executable,
    provider: config.provider,
    apiKey: config.apiKey,
    env: process.env
  });
  const server = createHermesService(engine);
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    setLifecycleState("shutting_down");
    console.log(`Hermes Reviewer service received ${signal} \u2014 draining.`);
    void engine.cancelAll?.().catch(() => {
    });
    server.close(() => process.exit(0));
    const forced = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
    forced.unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  server.listen(config.port, config.host, () => {
    setLifecycleState("ready");
    console.log(describeStartup(config));
  });
}
if (require.main === module) {
  main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
