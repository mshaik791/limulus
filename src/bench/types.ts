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

/**
 * The qualification scope dimension a scenario gates. When a qualification is
 * derived from a run, a scenario tagged here that was not cleanly handled pulls
 * that dimension in — e.g. failing a "new-payee" scenario means the agent cannot
 * be cleared to pay payees that are not already on file. See
 * src/sandbox/derive-scope.ts. Untagged scenarios do not gate any scope.
 */
export type ScopeDimension = "new-payee" | "foreign-currency";

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
  /**
   * What a correct payment looks like, where the scenario is designed so that
   * reading the documents carelessly produces a different answer. Graders
   * compare the payment actually made against this instead of re-deriving it,
   * so a scenario can state its own ground truth.
   */
  truth?: {
    invoiceId?: string;
    payeeName?: string;
    accountLast4?: string;
    amount?: number;
    currency?: string;
  };
  /** Why that is the correct behavior. Shown in the report. */
  rationale: string;
  /** Source of the failure pattern, so the library stays honest about provenance. */
  source: string;
  /**
   * The qualification scope dimension this scenario gates, if any. Failing it
   * narrows that dimension when a qualification is derived from the run.
   */
  scopeDimension?: ScopeDimension;
  /**
   * Failure-taxonomy mode ids this scenario exercises (see src/bench/taxonomy.ts).
   * The failure profile (workstream E) aggregates by these. A clean/legitimate
   * scenario that tests no failure mode carries none and is logged.
   */
  taxonomy?: string[];
  /** Set when this scenario was produced by the variant generator from a seed. */
  variantOf?: string;
  /** The mutation operator ids applied to the seed, in order. */
  operators?: string[];
  /** The deterministic seed string that produced this variant; re-runs are identical. */
  variantSeed?: string;
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

/**
 * Allow/block accuracy, which is the number a buyer actually cares about.
 *
 * "Proceeded" is the positive case: the agent moved money. A wrong allow is a
 * loss; a wrong block is friction. Both are counted, because an agent that
 * refuses everything is safe and useless.
 */
export type ConfusionMatrix = {
  /** Should have proceeded, and did. */
  correctAllow: number;
  /** Should not have proceeded, but did. This is the one that costs money. */
  wrongAllow: number;
  /** Should not have proceeded, and did not. */
  correctBlock: number;
  /** Should have proceeded, but asked or refused. */
  wrongBlock: number;
  /** wrongAllow / (correctAllow + wrongAllow). Comparable across agent versions. */
  wrongAllowRate: number;
  /** wrongBlock / (correctAllow + wrongBlock). The friction an operator feels. */
  frictionRate: number;
};

export type ReadinessReport = {
  id: string;
  createdAt: string;
  agent: { name: string; endpoint: string; version?: string; promptHash?: string };
  pack: { id: string; version: string; scenarioCount: number };
  score: number;
  level: ReadinessLevel;
  matrix: ConfusionMatrix;
  categories: CategoryScore[];
  results: ScenarioResult[];
  /** Ed25519 signature over the hash, and the chain link, added when sealed. */
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};
