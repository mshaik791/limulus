// Pre-deployment testing: run a payment agent against a pack of scenarios and
// score how it behaves. The agent under test is any HTTP endpoint that accepts
// a task and returns what it would do.

import type { Authorization, Document, PaymentOrder } from "../types.ts";

export type ScenarioCategory =
  | "adversarial" // prompt injection, poisoned documents, impersonation
  | "operational" // returns, reversals, duplicates, timeouts, partial failures
  | "judgment" // should it proceed, ask a person, or refuse
  | "context" // long workflows: memory loss, changed intent, approval drift
  | "mandate"; // does the proposed payment match what was authorized

/** What a correct agent should do in this scenario. */
export type ExpectedAction = "proceed" | "ask" | "refuse";

export type Scenario = {
  id: string;
  category: ScenarioCategory;
  title: string;
  /** What the scenario is testing, in one sentence. */
  intent: string;
  severity: "low" | "medium" | "high" | "critical";
  /** The task the agent is given. */
  task: string;
  authorization: Authorization;
  documents: Document[];
  /** Rail events the sandbox replays after a payment is submitted, if any. */
  railEvents?: RailEvent[];
  expected: ExpectedAction;
  /** Why that is the correct behavior. Shown in the report. */
  rationale: string;
  /** Source of the failure pattern, so the library stays honest about provenance. */
  source: string;
};

/** Simulated rail behavior. No money moves; this is a sandbox. */
export type RailEvent =
  | { type: "return"; code: string; description: string }
  | { type: "reversal"; reason: string }
  | { type: "timeout"; afterMs: number }
  | { type: "duplicate_settlement"; description: string }
  | { type: "partial_settlement"; settledAmount: number };

/** What the agent under test replies with. */
export type AgentResponse = {
  action: ExpectedAction;
  /** Present when the agent decides to proceed. */
  payment?: Partial<PaymentOrder> & { payeeAccountLast4?: string; amount?: number };
  /** The agent's stated reason. Recorded, never trusted. */
  reason?: string;
  /** What the agent asked, when action is "ask". */
  question?: string;
};

export type ScenarioResult = {
  scenarioId: string;
  category: ScenarioCategory;
  severity: Scenario["severity"];
  expected: ExpectedAction;
  actual: ExpectedAction | "error";
  passed: boolean;
  /** Set when the agent proceeded and the payment itself was also wrong. */
  paymentProblems: string[];
  agentReason?: string;
  latencyMs: number;
  note: string;
};

export type CategoryScore = {
  category: ScenarioCategory;
  passed: number;
  total: number;
  criticalFailures: number;
};

export type ReadinessLevel = "not ready" | "shadow mode" | "human-approved" | "bounded autonomy";

export type ReadinessReport = {
  id: string;
  createdAt: string;
  agent: { name: string; endpoint: string; version?: string; promptHash?: string };
  pack: { id: string; version: string; scenarioCount: number };
  score: number;
  level: ReadinessLevel;
  categories: CategoryScore[];
  results: ScenarioResult[];
  /** Ed25519 signature over the hash, and the chain link, added when sealed. */
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};
