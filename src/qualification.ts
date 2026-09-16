import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { canonical, publicKeyPem, sha256, signHash, verifySignature } from "./record.ts";
import type { ReadinessLevel } from "./sandbox/score.ts";

// A qualification is the thing a customer actually buys: a signed statement
// that this exact agent, at this version, behaved correctly on this suite, and
// is cleared for payments of this shape until this date.
//
// It is narrow on purpose. "This agent is safe" is not a claim anyone can stand
// behind. "Cleared for ACH up to $5,000 to vendors already on file, until
// 14 October 2026, on suite payments-v1 0.2.0" is.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const path = join(dataDir, "qualifications.jsonl");

export type QualificationBinding = {
  agent: {
    name: string;
    /** A new version is a new agent. The qualification does not carry over. */
    version: string;
    /** Hash of the system prompt, if the customer supplies one. */
    promptHash?: string;
    /** Hash of the tool list and their descriptions. */
    toolConfigHash?: string;
  };
  /** The workflow this covers, e.g. "invoice-payment". Not all payments. */
  workflow: string;
  rail: string;
  currency: string;
  /** The ceiling this agent is cleared for, which may be below its own limit. */
  amountLimit: number;
  /** What must still happen with a person involved. */
  approvalPolicy: string;
  /** Which vendors are in scope: "on-file" or "any". */
  payeeScope: "on-file" | "any";
  suite: { id: string; version: string; scenarioCount: number; trials: number };
};

export type Qualification = {
  kind: "limulus.qualification.v1";
  id: string;
  issuedAt: string;
  expiresAt: string;
  level: ReadinessLevel;
  binding: QualificationBinding;
  scores: { safety: number; capability: number; recovery: number; reliability: number | null };
  /** The Lab run this was issued from. */
  runId: string;
  revokedAt?: string;
  revokedReason?: string;
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

/**
 * How long a qualification lasts. More autonomy means a shorter window: the
 * further a person is from each payment, the sooner we want to see the agent
 * prove itself again.
 */
const VALIDITY_DAYS: Record<ReadinessLevel, number> = {
  experimental: 180,
  "shadow-ready": 180,
  "human-supervised": 90,
  "limited-autonomous": 30,
  "expanded-autonomous": 30,
};

export function readQualifications(): Qualification[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Qualification);
}

export function issueQualification(input: {
  level: ReadinessLevel;
  binding: QualificationBinding;
  scores: Qualification["scores"];
  runId: string;
  validityDays?: number;
}): Qualification {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const issuedAt = new Date();
  const days = input.validityDays ?? VALIDITY_DAYS[input.level];
  const previous = readQualifications().at(-1) ?? null;

  const body = {
    kind: "limulus.qualification.v1" as const,
    id: `qual_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + days * 86_400_000).toISOString(),
    level: input.level,
    binding: input.binding,
    scores: input.scores,
    runId: input.runId,
    prevHash: previous ? previous.hash : null,
  };

  const hash = sha256(canonical(body));
  const qualification: Qualification = { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };
  appendFileSync(path, `${JSON.stringify(qualification)}\n`);
  return qualification;
}

export function revokeQualification(id: string, reason: string): Qualification | null {
  const all = readQualifications();
  const target = all.find((q) => q.id === id);
  if (!target || target.revokedAt) return null;

  // Revocation is recorded on the qualification itself, so a stale copy held by
  // a customer can be caught when it is checked against us.
  const revoked: Qualification = { ...target, revokedAt: new Date().toISOString(), revokedReason: reason };
  writeFileSync(path, all.map((q) => JSON.stringify(q.id === id ? revoked : q)).join("\n") + "\n");
  return revoked;
}

/** Why a payment fell outside a qualification. These codes go into decisions. */
export type ScopeCode =
  | "qualification_not_found"
  | "qualification_revoked"
  | "qualification_expired"
  | "level_requires_human_approval"
  | "level_not_cleared_for_release"
  | "agent_version_changed"
  | "prompt_changed"
  | "tool_config_changed"
  | "workflow_not_qualified"
  | "rail_not_qualified"
  | "currency_not_qualified"
  | "amount_above_qualified_limit"
  | "payee_not_on_file";

export type ScopeRequest = {
  agentName: string;
  agentVersion: string;
  promptHash?: string;
  toolConfigHash?: string;
  workflow: string;
  rail: string;
  currency: string;
  amount: number;
  payeeOnFile: boolean;
  at?: Date;
};

export type ScopeCheck = {
  /** True only when the agent may release without a person. */
  withinScope: boolean;
  /** True when the qualification covers this payment but still needs approval. */
  requiresApproval: boolean;
  codes: ScopeCode[];
  reasons: string[];
  qualificationId?: string;
  level?: ReadinessLevel;
};

/**
 * Checks a payment against a qualification. This is the join between the Lab
 * and the release gate: testing an agent means nothing unless what was tested
 * is what is allowed to run.
 */
export function checkScope(qualificationId: string, request: ScopeRequest): ScopeCheck {
  const at = request.at ?? new Date();
  const qualification = readQualifications().find((q) => q.id === qualificationId);

  if (!qualification) {
    return {
      withinScope: false,
      requiresApproval: true,
      codes: ["qualification_not_found"],
      reasons: [`No qualification ${qualificationId}.`],
    };
  }

  const codes: ScopeCode[] = [];
  const reasons: string[] = [];
  const fail = (code: ScopeCode, reason: string) => {
    codes.push(code);
    reasons.push(reason);
  };

  if (qualification.revokedAt) {
    fail("qualification_revoked", `Revoked ${qualification.revokedAt}: ${qualification.revokedReason ?? "no reason given"}.`);
  }
  if (Date.parse(qualification.expiresAt) < at.getTime()) {
    fail("qualification_expired", `Expired ${qualification.expiresAt.slice(0, 10)}. Re-run the suite to renew it.`);
  }

  const binding = qualification.binding;
  if (binding.agent.version !== request.agentVersion) {
    fail(
      "agent_version_changed",
      `Qualified at ${binding.agent.name} v${binding.agent.version}, running v${request.agentVersion}. A version change means a new run.`,
    );
  }
  if (binding.agent.promptHash && request.promptHash && binding.agent.promptHash !== request.promptHash) {
    fail("prompt_changed", "The system prompt differs from the one that was tested.");
  }
  if (binding.agent.toolConfigHash && request.toolConfigHash && binding.agent.toolConfigHash !== request.toolConfigHash) {
    fail("tool_config_changed", "The tool configuration differs from the one that was tested.");
  }
  if (binding.workflow !== request.workflow) {
    fail("workflow_not_qualified", `Qualified for ${binding.workflow}, not ${request.workflow}.`);
  }
  if (binding.rail.toLowerCase() !== request.rail.toLowerCase()) {
    fail("rail_not_qualified", `Qualified for ${binding.rail}, not ${request.rail}.`);
  }
  if (binding.currency !== request.currency) {
    fail("currency_not_qualified", `Qualified for ${binding.currency}, not ${request.currency}.`);
  }
  if (request.amount > binding.amountLimit) {
    fail(
      "amount_above_qualified_limit",
      `${request.amount.toLocaleString()} ${request.currency} is above the qualified ceiling of ${binding.amountLimit.toLocaleString()}.`,
    );
  }
  if (binding.payeeScope === "on-file" && !request.payeeOnFile) {
    fail("payee_not_on_file", "This qualification covers vendors already on file.");
  }

  const autonomous = qualification.level === "limited-autonomous" || qualification.level === "expanded-autonomous";
  if (!autonomous) {
    if (qualification.level === "human-supervised") {
      fail("level_requires_human_approval", "Qualified for human-supervised operation: a person approves each payment.");
    } else {
      fail(
        "level_not_cleared_for_release",
        `Qualified level is ${qualification.level}, which does not carry release authority.`,
      );
    }
  }

  return {
    withinScope: codes.length === 0,
    requiresApproval: codes.length > 0,
    codes,
    reasons,
    qualificationId: qualification.id,
    level: qualification.level,
  };
}

export function verifyQualification(qualification: Qualification): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const { hash, signature, publicKey, ...body } = qualification;
  const recomputed = sha256(canonical(body));
  if (recomputed !== hash) problems.push("qualification contents do not match its hash");
  if (!verifySignature(recomputed, signature, publicKey)) problems.push("signature does not cover these contents");
  return { ok: problems.length === 0, problems };
}

export const qualificationsFile = path;
