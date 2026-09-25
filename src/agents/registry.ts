import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolCatalog, toolsFor } from "../sandbox/env.ts";
import type { AgentStep, AgentTurn, ToolAgentTarget } from "../sandbox/episode.ts";
import { readCapped, validateEndpoint } from "./net-policy.ts";

// Connected agents: what a customer registers so the Lab can test it without
// anyone editing source. Four things are kept apart on purpose, because one
// endpoint can serve different models and change under the same URL:
//
//   agent       the customer's workflow ("Invoice Payment Agent")
//   version     one recorded configuration of it, the thing a run is bound to
//   connection  endpoint, protocol, a reference to a server-held credential
//   run         an evaluation of one version (lives in lab-runs.jsonl)
//
// Credentials never enter the agent record. They live in a separate 0600 file
// keyed by an opaque id, and no route ever returns them. Everything else is
// plain JSON under data/, like the rest of the engine's state.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = () => process.env.LIMULUS_DATA_DIR ?? join(here, "..", "..", "data");
const registryPath = () => join(dataDir(), "agents.json");
const secretsPath = () => join(dataDir(), "agent-secrets.json");

export const PROTOCOL = "limulus-turn-v1";
export const WORKSPACE = "local";

export type ConnectionState = "not_checked" | "checking" | "connected" | "auth_failed" | "unreachable" | "incompatible" | "disabled";

export type AuthConfig = { header: "authorization" | "x-api-key"; scheme: "bearer" | "raw" };

export type CheckResult = {
  state: Exclude<ConnectionState, "not_checked" | "checking" | "disabled">;
  at: string;
  detail: string;
  latencyMs: number;
  /** What the endpoint said about itself in the check reply, if anything. */
  reported?: { model?: string; modelVersion?: string };
};

export type Connection = {
  endpoint: string;
  protocol: typeof PROTOCOL;
  /** Present when a credential is configured; the credential itself is never here. */
  auth?: AuthConfig & { secretId: string };
  state: ConnectionState;
  lastCheck?: CheckResult;
};

export type AgentRecord = {
  id: string;
  workspace: string;
  name: string;
  workflow: string;
  connection: Connection;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VersionRecord = {
  id: string;
  agentId: string;
  label: string;
  /** Snapshot of the connection the version was recorded with. */
  endpoint: string;
  /** Configuration metadata the customer declared. Declared, not verified. */
  declared?: { model?: string; modelVersion?: string; temperature?: number; note?: string };
  createdAt: string;
};

type Registry = { agents: AgentRecord[]; versions: VersionRecord[] };

function load(): Registry {
  const p = registryPath();
  if (!existsSync(p)) return { agents: [], versions: [] };
  return JSON.parse(readFileSync(p, "utf8")) as Registry;
}

function save(r: Registry) {
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify(r, null, 2));
}

// ---- secrets ------------------------------------------------------------------

type SecretStore = Record<string, { value: string; createdAt: string }>;

function loadSecrets(): SecretStore {
  const p = secretsPath();
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SecretStore) : {};
}

function storeSecret(value: string): string {
  const id = `sec_${randomBytes(8).toString("hex")}`;
  const all = loadSecrets();
  all[id] = { value, createdAt: new Date().toISOString() };
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
  writeFileSync(secretsPath(), JSON.stringify(all, null, 2), { mode: 0o600 });
  return id;
}

function readSecret(id: string): string | undefined {
  return loadSecrets()[id]?.value;
}

/** The outbound headers for a connection, resolved from the secret store. Never stored on a record. */
export function outboundHeaders(c: Connection): Record<string, string> {
  if (!c.auth) return {};
  const value = readSecret(c.auth.secretId);
  if (!value) return {};
  return { [c.auth.header]: c.auth.scheme === "bearer" ? `Bearer ${value}` : value };
}

// ---- agents and versions ------------------------------------------------------------

const now = () => new Date().toISOString();

export function listAgents(): AgentRecord[] {
  return load().agents;
}

export function getAgent(id: string): AgentRecord | undefined {
  return load().agents.find((a) => a.id === id);
}

export function listVersions(agentId: string): VersionRecord[] {
  return load().versions.filter((v) => v.agentId === agentId);
}

export function getVersion(id: string): VersionRecord | undefined {
  return load().versions.find((v) => v.id === id);
}

export type CreateAgentInput = {
  name: string;
  workflow: string;
  endpoint: string;
  auth?: AuthConfig & { value: string };
  version: { label: string; model?: string; modelVersion?: string; temperature?: number; note?: string };
};

export class RegistryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
  }
}

const clean = (s: unknown, max = 120) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** Registers an agent with its first version. The endpoint is validated before anything is written. */
export async function createAgent(input: CreateAgentInput): Promise<{ agent: AgentRecord; version: VersionRecord }> {
  const name = clean(input.name);
  const workflow = clean(input.workflow);
  const label = clean(input.version?.label, 60);
  if (!name) throw new RegistryError(400, "name is required");
  if (!label) throw new RegistryError(400, "version.label is required");
  const endpoint = clean(input.endpoint, 2048);
  const valid = await validateEndpoint(endpoint);
  if (!valid.ok) throw new RegistryError(400, `endpoint: ${valid.reason}`);

  const r = load();
  const at = now();
  const agent: AgentRecord = {
    id: `agt_${randomBytes(8).toString("hex")}`,
    workspace: WORKSPACE,
    name,
    workflow,
    connection: { endpoint: valid.url.toString(), protocol: PROTOCOL, ...(input.auth?.value ? { auth: { header: input.auth.header, scheme: input.auth.scheme, secretId: storeSecret(input.auth.value) } } : {}), state: "not_checked" },
    enabled: true,
    createdAt: at,
    updatedAt: at,
  };
  const version = newVersion(agent, input.version);
  r.agents.push(agent);
  r.versions.push(version);
  save(r);
  return { agent, version };
}

function newVersion(agent: AgentRecord, v: CreateAgentInput["version"]): VersionRecord {
  const declared: VersionRecord["declared"] = {};
  if (clean(v.model)) declared.model = clean(v.model);
  if (clean(v.modelVersion)) declared.modelVersion = clean(v.modelVersion);
  if (typeof v.temperature === "number" && Number.isFinite(v.temperature)) declared.temperature = v.temperature;
  if (clean(v.note, 500)) declared.note = clean(v.note, 500);
  return {
    id: `ver_${randomBytes(8).toString("hex")}`,
    agentId: agent.id,
    label: clean(v.label, 60),
    endpoint: agent.connection.endpoint,
    ...(Object.keys(declared).length ? { declared } : {}),
    createdAt: now(),
  };
}

/** Records a new version. A version label alone proves nothing about the remote configuration; it is a customer's statement. */
export function createVersion(agentId: string, v: CreateAgentInput["version"]): VersionRecord {
  const r = load();
  const agent = r.agents.find((a) => a.id === agentId);
  if (!agent) throw new RegistryError(404, "no such agent");
  if (!clean(v?.label, 60)) throw new RegistryError(400, "label is required");
  if (r.versions.some((x) => x.agentId === agentId && x.label === clean(v.label, 60))) throw new RegistryError(409, `version ${clean(v.label, 60)} already exists for this agent`);
  const version = newVersion(agent, v);
  r.versions.push(version);
  agent.updatedAt = now();
  save(r);
  return version;
}

export type UpdateAgentInput = { name?: string; workflow?: string; enabled?: boolean; endpoint?: string; auth?: (AuthConfig & { value: string }) | null };

/** Changes to the connection reset its state: a new endpoint or credential has not been checked. */
export async function updateAgent(id: string, patch: UpdateAgentInput): Promise<AgentRecord> {
  const r = load();
  const agent = r.agents.find((a) => a.id === id);
  if (!agent) throw new RegistryError(404, "no such agent");
  if (patch.name !== undefined) agent.name = clean(patch.name) || agent.name;
  if (patch.workflow !== undefined) agent.workflow = clean(patch.workflow) || agent.workflow;
  if (patch.enabled !== undefined) {
    agent.enabled = Boolean(patch.enabled);
    agent.connection.state = agent.enabled ? "not_checked" : "disabled";
  }
  if (patch.endpoint !== undefined) {
    const valid = await validateEndpoint(clean(patch.endpoint, 2048));
    if (!valid.ok) throw new RegistryError(400, `endpoint: ${valid.reason}`);
    agent.connection.endpoint = valid.url.toString();
    agent.connection.state = agent.enabled ? "not_checked" : "disabled";
    delete agent.connection.lastCheck;
  }
  if (patch.auth !== undefined) {
    if (patch.auth === null) delete agent.connection.auth;
    else if (patch.auth.value) agent.connection.auth = { header: patch.auth.header, scheme: patch.auth.scheme, secretId: storeSecret(patch.auth.value) };
    agent.connection.state = agent.enabled ? "not_checked" : "disabled";
    delete agent.connection.lastCheck;
  }
  agent.updatedAt = now();
  save(r);
  return agent;
}

// ---- the connection check ------------------------------------------------------------

const CHECK_TIMEOUT_MS = 15_000;

/**
 * One dry-run turn, clearly labelled, whose reply is validated and never
 * executed. It says so in the task, so an agent that reads its input knows
 * nothing is being asked of it; an agent that ignores its input and replies
 * with any well-formed step passes just the same. Either way no tool runs and
 * no financial task is started. It exercises the whole contract: reachability,
 * authentication, and the shape of the reply.
 */
export function checkTurn(): AgentTurn & { check: true } {
  return {
    check: true,
    task: "Connection check from Limulus Labs. There is no invoice to pay and nothing you return will be executed. Reply with one step in the documented shape.",
    authorization: { policyVersion: "connection-check", principal: "limulus-labs", task: "connection check", limitPerPayment: 0, currency: "USD", approvedVendors: [], approvedInvoices: [], requiredChecks: [] },
    documents: [],
    tools: toolsFor("off"),
    history: [],
    step: 0,
    maxSteps: 1,
  };
}

const isStep = (x: unknown): x is AgentStep => {
  const s = x as AgentStep;
  if (!s || typeof s !== "object") return false;
  if (s.type === "tool_call") return typeof s.tool === "string" && toolCatalog.some((t) => t.name === s.tool) && (s.args === undefined || (typeof s.args === "object" && s.args !== null));
  if (s.type === "finish") return s.action === "proceed" || s.action === "ask" || s.action === "refuse";
  return false;
};

/** Runs the check against a connection and returns the result without storing it. */
export async function probeConnection(c: Connection): Promise<CheckResult> {
  const started = Date.now();
  const at = now();
  const valid = await validateEndpoint(c.endpoint);
  if (!valid.ok) return { state: "unreachable", at, detail: `endpoint refused by policy: ${valid.reason}`, latencyMs: 0 };
  let res: Response;
  try {
    res = await fetch(c.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...outboundHeaders(c) },
      body: JSON.stringify(checkTurn()),
      redirect: "manual",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    const cause = err.cause as (Error & { code?: string }) | undefined;
    const why = err.name === "TimeoutError" ? `no reply within ${CHECK_TIMEOUT_MS / 1000}s` : cause?.code ?? cause?.message ?? err.message;
    return { state: "unreachable", at, detail: `could not reach the endpoint: ${why}`, latencyMs: Date.now() - started };
  }
  const latencyMs = Date.now() - started;
  if (res.status === 401 || res.status === 403) return { state: "auth_failed", at, detail: `the endpoint rejected the credential (${res.status})${c.auth ? "" : "; no credential is configured"}`, latencyMs };
  if (res.status >= 300 && res.status < 400) return { state: "incompatible", at, detail: `the endpoint redirected (${res.status}); register the final URL instead`, latencyMs };
  const { text, truncated } = await readCapped(res, 65_536);
  if (!res.ok) return { state: "incompatible", at, detail: `the endpoint returned ${res.status}${text ? `: ${snippet(text)}` : ""}`, latencyMs };
  if (truncated) return { state: "incompatible", at, detail: "the reply was larger than 64 KB; a step is a small JSON object", latencyMs };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "incompatible", at, detail: `the reply was not JSON: ${snippet(text)}`, latencyMs };
  }
  if (!isStep(parsed)) return { state: "incompatible", at, detail: `the reply was JSON but not a step: ${snippet(text)}`, latencyMs };
  const reported = parsed.model ? { model: parsed.model, ...(parsed.modelVersion ? { modelVersion: parsed.modelVersion } : {}) } : undefined;
  return { state: "connected", at, detail: `replied with a ${parsed.type === "tool_call" ? `tool_call (${parsed.tool})` : `finish (${parsed.action})`}`, latencyMs, ...(reported ? { reported } : {}) };
}

const snippet = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 160);

/** Runs the check and records the outcome on the agent. */
export async function checkConnection(agentId: string): Promise<{ agent: AgentRecord; result: CheckResult }> {
  const r = load();
  const agent = r.agents.find((a) => a.id === agentId);
  if (!agent) throw new RegistryError(404, "no such agent");
  if (!agent.enabled) throw new RegistryError(409, "this agent is disabled");
  const result = await probeConnection(agent.connection);
  agent.connection.state = result.state;
  agent.connection.lastCheck = result;
  agent.updatedAt = now();
  save(r);
  return { agent, result };
}

// ---- what the Lab runs ---------------------------------------------------------------

/** The target a run uses for a registered version. Headers are resolved here and never written to a record. */
export function targetFor(agentId: string, versionId: string): ToolAgentTarget {
  const agent = getAgent(agentId);
  if (!agent) throw new RegistryError(404, "no such agent");
  if (!agent.enabled) throw new RegistryError(409, "this agent is disabled");
  const version = getVersion(versionId);
  if (!version || version.agentId !== agentId) throw new RegistryError(404, "no such version for this agent");
  return {
    name: agent.name,
    version: version.label,
    endpoint: agent.connection.endpoint,
    ...(version.declared?.model ? { model: version.declared.model } : {}),
    ...(version.declared?.modelVersion ? { modelVersion: version.declared.modelVersion } : {}),
    ...(version.declared?.temperature !== undefined ? { temperature: version.declared.temperature } : {}),
    headers: outboundHeaders(agent.connection),
    registry: { agentId: agent.id, versionId: version.id },
  };
}
