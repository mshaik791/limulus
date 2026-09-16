// Core record shapes. The three records that must agree are Authorization,
// Declaration (what the agent says it is about to pay) and PaymentOrder
// (what would reach the bank).

export type Vendor = {
  vendorId: string;
  name: string;
  /** Last four digits of the account on file in the vendor master record. */
  accountLast4: string;
  /** ISO date the bank details were last changed. */
  bankDetailsUpdated: string;
  /** Phone number used for callback verification. */
  callbackPhone?: string;
};

/** What a person allowed the agent to do. */
export type Authorization = {
  policyVersion: string;
  /** Who delegated the task. */
  principal: string;
  task: string;
  limitPerPayment: number;
  /**
   * Ceiling across all payments in one day. Without it, an agent can stay under
   * the per-payment limit and still move an unbounded amount — which is exactly
   * how structuring works.
   */
  limitPerDay?: number;
  currency: string;
  approvedVendors: Vendor[];
  /** Invoices a person has approved for payment. */
  approvedInvoices: { invoiceId: string; approvedBy: string; amount: number; poId?: string }[];
  /** Checks the operator must leave enabled for coverage to apply later. */
  requiredChecks: string[];
};

/** What the agent declares it is about to pay, signed before anything executes. */
export type Declaration = {
  agentId: string;
  payeeName: string;
  payeeAccountLast4: string;
  amount: number;
  currency: string;
  invoiceId: string;
  poId?: string;
  reason: string;
  /** Hashes of the documents the agent relied on. */
  sources: { name: string; sha256: string }[];
};

/** What would actually reach the bank. */
export type PaymentOrder = {
  rail: "ach" | "wire" | "card" | "stablecoin";
  payeeName: string;
  payeeAccountLast4: string;
  amount: number;
  currency: string;
  reference: string;
  /** Identifier at the payment platform, if one exists yet. */
  externalId?: string;
};

/** A document the agent read, captured by the gateway. */
export type Document = {
  name: string;
  type: "invoice" | "po" | "email" | "receipt" | "other";
  text: string;
  /** Text present in the file but not visible when rendered (white text, zero-size fonts, off-page). */
  hiddenText?: string;
};

export type CheckStatus = "pass" | "fail" | "review" | "skip";

export type CheckResult = {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
};

export type DecisionOutcome = "released" | "held" | "escalated";

export type DecisionRequest = {
  authorization: Authorization;
  declaration: Declaration;
  paymentOrder: PaymentOrder;
  documents: Document[];
};

export type DecisionRecord = {
  id: string;
  createdAt: string;
  outcome: DecisionOutcome;
  reasons: string[];
  checks: CheckResult[];
  authorization: Authorization;
  declaration: Declaration;
  paymentOrder: PaymentOrder;
  documentHashes: { name: string; sha256: string }[];
  /** Hash of the previous record in the chain, or null for the first record. */
  prevHash: string | null;
  /** Hash over everything above. */
  hash: string;
  /** Ed25519 signature over the hash. */
  signature: string;
  publicKey: string;
};
