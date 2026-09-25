// The console reads the engine over HTTP and never computes a number the engine
// did not. Every screen is a projection of a signed record; if a figure is not
// in a record, it is not on a screen.
//
// LIMULUS_API      base URL of src/server.ts (default http://localhost:8787)
// LIMULUS_API_KEY  bearer key, when the server runs with LIMULUS_REQUIRE_AUTH=1

const BASE = (process.env.LIMULUS_API ?? "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.LIMULUS_API_KEY;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `${res.status} from ${path}`);
  return body as T;
}

export const get = <T>(path: string) => call<T>(path);
export const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

/** The engine, or null when it is not running. Screens say so rather than showing zeros. */
export async function health(): Promise<{ ok: boolean; version: string; authRequired: boolean } | null> {
  try {
    return await get("/health");
  } catch {
    return null;
  }
}

// ---- types, mirrored from src/ ------------------------------------------------

export type ExpectedAction = "proceed" | "ask" | "refuse";
export type Severity = "low" | "medium" | "high" | "critical";
export type ControlMode = "off" | "advisory" | "enforced";
export type ReadinessLevel = "experimental" | "shadow-ready" | "human-supervised" | "limited-autonomous" | "expanded-autonomous";

export type Dimension = { score: number; sampleSize: number; detail: string };

export type FourAxes = {
  safety: Dimension;
  capability: Dimension;
  recovery: Dimension;
  reliability: Dimension | null;
  criticalViolations: { code: string; scenarioId: string; detail: string }[];
  inconsistentScenarios: { scenarioId: string; outcomes: string[] }[];
  level: ReadinessLevel;
  levelReason: string;
  trials: number;
  unusableEpisodes: number;
};

export type Violation = { code: string; severity: "medium" | "high" | "critical"; detail: string; evidence?: { seq: number; tool: string } };

export type EpisodeGrade = {
  episodeId: string;
  scenarioId: string;
  trial: number;
  effective: ExpectedAction | "stalled" | "unusable";
  expected: ExpectedAction;
  violations: Violation[];
  criticalCount: number;
  completedTask: boolean;
  recovered: boolean | null;
  toolCalls: number;
  durationMs: number;
  taxonomy?: string[];
  paidAmount?: number;
  unusable?: boolean;
};

export type SubjectIdentity = { model?: string; modelVersion?: string; temperature?: number; source: "configured" | "self-reported" | "unknown"; fixture?: boolean; inconsistent?: string[] };

export type LabRunAgent = { name: string; version: string; endpoint: string; promptHash?: string; toolConfigHash: string; subject: SubjectIdentity; registry?: { agentId: string; versionId: string } };

export type LabRunBase = {
  kind: "limulus.labrun.v1";
  id: string;
  createdAt: string;
  agent: LabRunAgent;
  controls: { mode: ControlMode; description: string; simulatedWrongfulAmount: number; falseBlocks: number; skippedControl: number | null; episodes: number };
  suite: { id: string; version: string; scenarioCount: number; trials: number; episodes: number };
  axes: FourAxes;
  pool: "open" | "held-out";
  cohort?: string;
  durationMs: number;
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};
export type LabRunSummary = LabRunBase & { episodes: number };
export type LabRun = LabRunBase & { grades: EpisodeGrade[]; verification?: { ok: boolean; problems: string[] } };

export type ToolCall = { seq: number; at: string; tool: string; args: Record<string, unknown>; result: Record<string, unknown>; elapsedMs: number };

export type EpisodeTrace = {
  runId: string;
  episodeId: string;
  scenarioId: string;
  trial: number;
  startedAt: string;
  durationMs: number;
  calls: ToolCall[];
  declared?: { action: ExpectedAction; reason?: string };
  effective: ExpectedAction | "stalled" | "unusable";
  payments: { id: string; payeeName: string; payeeAccountLast4: string; amount: number; currency: string; invoiceId: string; state: string; createdAt: string }[];
  approvalRequests: { question?: string; context?: string }[];
  error?: string;
  unusable?: boolean;
  subject: SubjectIdentity;
  control: { mode: ControlMode; skippedControl: boolean | null; falseBlock: boolean; simulatedWrongfulAmount: number; verdicts: string[] };
};

export type Document = { name: string; type: string; text: string; hiddenText?: string };
export type Vendor = { vendorId: string; name: string; accountLast4: string; bankDetailsUpdated: string; callbackPhone?: string };
export type Authorization = {
  policyVersion: string;
  principal: string;
  task: string;
  limitPerPayment: number;
  limitPerDay?: number;
  currency: string;
  approvedVendors: Vendor[];
  approvedInvoices: { invoiceId: string; approvedBy: string; amount: number; poId?: string }[];
  requiredChecks: string[];
};

export type Scenario = {
  id: string;
  category: string;
  title: string;
  intent: string;
  severity: Severity;
  task: string;
  authorization: Authorization;
  documents: Document[];
  railEvents?: { type: string; [k: string]: unknown }[];
  expected: ExpectedAction;
  truth?: { invoiceId?: string; payeeName?: string; accountLast4?: string; amount?: number; currency?: string };
  rationale: string;
  source: string;
  taxonomy?: string[];
  compiledFrom?: { policyId: string; controlId: string; controlType: string; case: string; asOf: string };
};

export type Rate = { score: number; n: number };
export type ArmResult = {
  label: string;
  runId: string;
  agent: LabRunAgent;
  controls: { mode: ControlMode; description: string };
  axes: { safety: Rate; capability: Rate; recovery: Rate; reliability: Rate | null };
  criticalViolations: number;
  criticalEpisodes: number;
  episodes: number;
  simulatedWrongfulAmount: number;
  falseBlocks: number;
  skippedControl: number | null;
  skippedControlLabel: string;
  measuresSkipBehaviour: boolean;
  durationMs: number;
  scenarios: Record<string, { verdict: "pass" | "fail" | "critical" | "flaky"; criticals: number; outcomes: string[] }>;
};
export type CompareRecord = {
  kind: "limulus.compare.v1";
  id: string;
  createdAt: string;
  suite: { id: string; version: string; scenarioCount: number; trials: number };
  arms: ArmResult[];
  differences: { scenarioId: string; expected: ExpectedAction; severity: Severity; byArm: Record<string, ArmResult["scenarios"][string]["verdict"]> }[];
  recommendation: { label: string | null; reason: string; rule: string };
  notes: string[];
  durationMs: number;
  hash: string;
  verification?: { ok: boolean; problems: string[] };
};

export type GateRecord = {
  kind: "limulus.gate.v1";
  id: string;
  createdAt: string;
  runId: string;
  agent: { name: string; version: string };
  suite: { id: string; fingerprint: string; scenarioCount: number; trials: number };
  baseline: { updatedAt: string; fingerprint: string; trials: number };
  verdict: "pass" | "fail" | "overridden";
  axes: Record<string, { baseline: number | null; now: number | null }>;
  newCriticals: string[];
  newlyFailing: string[];
  regressions: string[];
  fixed: string[];
  newScenarios: string[];
  flaky: string[];
  override?: { id: string; actor: string; reason: string; expiresAt: string };
  hash: string;
  verification?: { ok: boolean; problems: string[] };
};

export type Qualification = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  level: ReadinessLevel;
  binding: {
    agent: { name: string; version: string; promptHash?: string; toolConfigHash?: string };
    workflow: string;
    rail: string;
    currency: string;
    amountLimit: number;
    approvalPolicy: string;
    payeeScope: "on-file" | "any";
    suite: { id: string; version: string; scenarioCount: number; trials: number };
  };
  scores: { safety: number; capability: number; recovery: number; reliability: number | null };
  scopeNarrowing?: { dimension: string; from: string; to: string; reason: string; evidence: string[] }[];
  runId: string;
  revokedAt?: string;
  revokedReason?: string;
  hash: string;
  state?: string;
  verification?: { ok: boolean; problems: string[] };
};

export type CheckResult = { id: string; name: string; status: "pass" | "fail" | "review" | "skip"; detail: string };

export type ShadowRecord = {
  id: string;
  createdAt: string;
  agentId: string;
  org: string;
  wouldHave: "released" | "held" | "escalated";
  production: { outcome: "released" | "held" | "escalated"; reference?: string; at?: string };
  agreement: "agree" | "would_have_held" | "would_have_escalated" | "would_have_released";
  checks?: CheckResult[];
  reasons: string[];
  exposure: number | null;
  payment: { payeeName: string; payeeAccountLast4: string; amount: number; currency: string; invoiceId: string; rail: string };
  authorizationPolicyId: string;
  documentHashes: { name: string; sha256: string }[];
  review?: { verdict: "false_positive" | "confirmed" | "unsure"; note: string; at: string };
  hash: string;
  verification?: { ok: boolean; problems: string[] };
};
export type Counted = { value: number; of: number };
export type ShadowSummary = {
  org: string;
  evaluated: number;
  agreed: Counted;
  wouldHaveHeld: Counted;
  wouldHaveEscalated: Counted;
  wouldHaveReleased: Counted;
  exposureWeWouldHaveStopped: { amount: number; payments: number; currency: string | null };
  reviewed: { falsePositives: number; confirmed: number; unsure: number; of: number };
  falsePositiveRate: Counted | null;
  topChecks: { id: string; name: string; count: number }[];
  note: string;
};

export type DecisionRecord = {
  id: string;
  createdAt: string;
  outcome: "released" | "held" | "escalated";
  reasons: string[];
  checks: CheckResult[];
  authorization: Authorization;
  declaration: { agentId: string; payeeName: string; payeeAccountLast4: string; amount: number; currency: string; invoiceId: string; poId?: string; reason: string; sources: { name: string; sha256: string }[] };
  paymentOrder: { rail: string; payeeName: string; payeeAccountLast4: string; amount: number; currency: string; reference: string; externalId?: string };
  documentHashes: { name: string; sha256: string }[];
  preview?: boolean;
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

export type Receipt = {
  kind: "limulus.receipt.v1";
  receiptId: string;
  issuedAt: string;
  decision: { id: string; at: string; outcome: string; recordHash: string; reasons: string[] };
  payment: { payee: string; accountLast4: string; amount: number; currency: string; invoiceId: string; rail: string };
  checks: { id: string; status: string; detail: string }[];
  authorization: { policyVersion: string; principal: string; limitPerPayment: number };
  [k: string]: unknown;
};
export type ReceiptVerification = { valid: boolean; checks: { name: string; ok: boolean; detail: string }[]; matchesOurRecord?: boolean };

export type ControlTypeInfo = { summary: string; parameters: string[]; cases: number };

export type FailureProfile = {
  config: { name: string; version: string };
  runIds: string[];
  totalEpisodes: number;
  nodes: { node: string; trials: number; failures: number; rate: number; ci: { low: number; high: number }; wrongfulAmountSimulated: number; worst?: { runId: string; scenarioId: string }; enoughData: boolean }[];
  findings: string[];
};

export type Candidate = {
  id: string;
  status: "pending" | "approved" | "rejected";
  org: string;
  sourceEventId: string;
  taxonomyNode: string;
  preservedProperty: string;
  kind: "refuse" | "pay";
  count: number;
  scenario: Scenario;
  createdAt: string;
  decidedAt?: string;
};

export type Outcome = {
  id: string;
  createdAt: string;
  decisionId: string;
  decisionHash: string;
  decisionOutcome: "released" | "held" | "escalated";
  status: "verified" | "unauthorized" | "duplicate" | "mismatch" | "returned" | "unsettled";
  findings: { code?: string; detail?: string; [k: string]: unknown }[];
  settlements: { decisionId: string; status: string; amount: number; currency: string; payeeAccountLast4?: string; reference?: string; at?: string }[];
  [k: string]: unknown;
};

export type PolicyListing = {
  file: string;
  error?: string;
  name?: string;
  version?: string | null;
  source?: string | null;
  policyId?: string;
  asOf?: string;
  controls?: { type: string; id: string; name: string; severity?: string; amount?: number; verifyWithinDays?: number; scenarios: number; traps: number; scenarioIds: string[] }[];
};

// ---- reads --------------------------------------------------------------------

const list = <T>(body: unknown, key: string): T[] => {
  if (Array.isArray(body)) return body as T[];
  const b = body as Record<string, unknown>;
  return (b?.[key] as T[]) ?? [];
};

export const labRuns = async () => list<LabRunSummary>(await get("/v1/lab/runs"), "runs");
export const labRun = (id: string) => get<LabRun>(`/v1/lab/runs/${id}`);
export const episodes = async (runId: string, scenarioId?: string) =>
  list<EpisodeTrace>(await get(`/v1/lab/episodes?runId=${encodeURIComponent(runId)}${scenarioId ? `&scenarioId=${encodeURIComponent(scenarioId)}` : ""}`), "episodes");
export const compares = async () => list<CompareRecord>(await get("/v1/lab/compares"), "compares");
export const compare = (id: string) => get<CompareRecord>(`/v1/lab/compares/${id}`);
export const gates = async () => list<GateRecord>(await get("/v1/gates"), "gates");
export const gate = (id: string) => get<GateRecord>(`/v1/gates/${id}`);
export const qualifications = async () => list<Qualification>(await get("/v1/qualifications"), "qualifications");
export const referenceAgents = async () => list<{ key: string; name: string; version: string }>(await get("/v1/lab/agents"), "agents");
export const scenario = (id: string) => get<Scenario & { pool?: string }>(`/v1/lab/scenarios/${encodeURIComponent(id)}`);
export const packScenarios = async () => list<Scenario>(await get("/v1/bench/scenarios"), "scenarios");
export const shadowSummary = (org = "default") => get<ShadowSummary>(`/v1/shadow/summary?org=${encodeURIComponent(org)}`);
export const shadowRecords = async (org?: string, agreement?: string) => {
  const q = new URLSearchParams();
  if (org) q.set("org", org);
  if (agreement) q.set("agreement", agreement);
  return list<ShadowRecord>(await get(`/v1/shadow${q.size ? `?${q}` : ""}`), "records");
};
export const shadowRecord = (id: string) => get<ShadowRecord>(`/v1/shadow/${id}`);
export const records = async () => list<DecisionRecord>(await get("/v1/records"), "records");
export const record = (id: string) => get<DecisionRecord>(`/v1/records/${id}`);
export const receipt = (decisionId: string) => get<Receipt>(`/v1/receipts/${decisionId}`);
export const verifyReceipt = (r: Receipt) => post<ReceiptVerification>("/v1/receipts/verify", r);
export const chainVerify = () => get<{ ok: boolean; count?: number; problems?: unknown[]; [k: string]: unknown }>("/v1/verify");
export const profile = async (name: string, version: string): Promise<FailureProfile | null> => {
  try {
    return await get<FailureProfile>(`/v1/profiles/${encodeURIComponent(name)}?version=${encodeURIComponent(version)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
};
export const candidates = async () => list<Candidate>(await get("/v1/monitor/candidates"), "candidates");
export const outcomes = async () => list<Outcome>(await get("/v1/outcomes"), "outcomes");
export const policies = async () => list<PolicyListing>(await get("/v1/policies"), "policies");
export type RailStatus = { rail: string; mode: "simulated" | "live" | string; live: boolean; note?: string };
/** Which rail the engine is wired to. Drives every piece of sandbox-versus-production copy. */
export async function environment(): Promise<{ sandbox: boolean; rail: string; note?: string }> {
  try {
    const r = await get<RailStatus>("/v1/rails/status");
    return { sandbox: !r.live, rail: r.rail, note: r.note };
  } catch {
    return { sandbox: true, rail: "unknown" };
  }
}
export const controlTypes = async () => ((await get<{ types: Record<string, ControlTypeInfo> }>("/v1/policies/control-types")).types ?? {});

// ---- writes (called from server actions only) ---------------------------------

export const runCompare = (body: { arms: { label?: string; agent?: string; endpoint?: string; controls: ControlMode }[]; trials: number }) =>
  post<CompareRecord>("/v1/lab/compare", body);
export const compilePolicy = (profile: unknown, asOf?: string) =>
  post<{ policyId: string; asOf: string; scenarios: Scenario[]; summary: { controlId: string; type: string; name: string; scenarios: number; traps: number; controls: number }[] }>(
    "/v1/policies/compile",
    { profile, asOf },
  );
export const runLab = (body: { agent?: string; endpoint?: string; version?: string; trials: number }) => post<{ run: LabRun }>("/v1/lab/runs", body);
export const decideCandidate = (id: string, decision: "approve" | "reject", reason?: string) => post<unknown>(`/v1/monitor/candidates/${id}/${decision}`, { reason });
export const reviewShadow = (id: string, verdict: string, note: string) => post<ShadowRecord>(`/v1/shadow/${id}/review`, { verdict, note });

// ---- connected agents and jobs -------------------------------------------------
// Mirrors src/agents/registry.ts and src/sandbox/jobs.ts. No credential ever
// arrives here: a connection carries a secret reference, nothing more.

export type ConnectionState = "not_checked" | "checking" | "connected" | "auth_failed" | "unreachable" | "incompatible" | "disabled";
export type ConnectionCheck = { state: Exclude<ConnectionState, "not_checked" | "checking" | "disabled">; at: string; detail: string; latencyMs: number; reported?: { model?: string; modelVersion?: string; fixture?: boolean } };
export type AgentRecord = {
  id: string;
  workspace: string;
  name: string;
  workflow: string;
  connection: { endpoint: string; protocol: string; auth?: { header: string; scheme: string; secretId: string }; state: ConnectionState; lastCheck?: ConnectionCheck };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type VersionRecord = { id: string; agentId: string; label: string; endpoint: string; declared?: { model?: string; modelVersion?: string; temperature?: number; note?: string }; createdAt: string };
export type JobState = "queued" | "running" | "completed" | "failed" | "interrupted";
export type Job = {
  id: string;
  state: JobState;
  request: { agentId?: string; versionId?: string; demo?: "careful" | "naive"; trials: number; controls: ControlMode; suite: "open-pool" };
  subject: { name: string; version: string; endpoint?: string };
  suite: { id: string; scenarioCount: number; trials: number; total: number };
  progress: { completed: number; total: number; unusable: number; scenarioId?: string };
  runId?: string;
  error?: { kind: "refused" | "pool" | "transport" | "engine" | "cancelled" | "restart"; message: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};
export type Suite = { id: "open-pool"; name: string; suiteId: string; scenarioCount: number; families: string[]; categories: string[]; description: string };

export const agents = () => get<{ agents: AgentRecord[]; versions: VersionRecord[] }>("/v1/agents");
export const agent = (id: string) => get<{ agent: AgentRecord; versions: VersionRecord[]; runs: LabRunSummary[] }>(`/v1/agents/${encodeURIComponent(id)}`);
export const createAgent = (body: { name: string; workflow: string; endpoint: string; auth?: { header: "authorization" | "x-api-key"; scheme: "bearer" | "raw"; value: string }; version: { label: string; model?: string; modelVersion?: string; temperature?: number; note?: string } }) =>
  post<{ agent: AgentRecord; version: VersionRecord }>("/v1/agents", body);
export const updateAgent = (id: string, patch: { name?: string; workflow?: string; enabled?: boolean; endpoint?: string; auth?: { header: "authorization" | "x-api-key"; scheme: "bearer" | "raw"; value: string } | null }) =>
  call<{ agent: AgentRecord }>(`/v1/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const checkAgent = (id: string) => post<{ agent: AgentRecord; result: ConnectionCheck }>(`/v1/agents/${encodeURIComponent(id)}/check`, {});
export const createVersion = (id: string, body: { label: string; model?: string; modelVersion?: string; temperature?: number; note?: string }) => post<{ version: VersionRecord }>(`/v1/agents/${encodeURIComponent(id)}/versions`, body);
export const submitJob = (body: { agentId?: string; versionId?: string; demo?: "careful" | "naive"; trials: number; controls: ControlMode; suite: "open-pool" }, submissionKey: string) =>
  call<{ job: Job }>("/v1/lab/jobs", { method: "POST", body: JSON.stringify(body), headers: { "idempotency-key": submissionKey } });
export const jobs = async () => list<Job>(await get("/v1/lab/jobs"), "jobs");
export const job = (id: string) => get<{ job: Job }>(`/v1/lab/jobs/${encodeURIComponent(id)}`);
export const cancelJob = (id: string) => post<{ job: Job }>(`/v1/lab/jobs/${encodeURIComponent(id)}/cancel`, {});
export const suites = async () => list<Suite>(await get("/v1/lab/suites"), "suites");
