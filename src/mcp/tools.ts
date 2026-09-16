import { decide } from "../decide.ts";
import { recordSettlement, verifyOutcomeForDecision } from "../outcome.ts";
import { buildReceipt, verifyReceipt } from "../receipt.ts";
import { loadAuthorization, policyId } from "../policy-store.ts";
import type { Declaration, Document, PaymentOrder } from "../types.ts";

// Tools an agent calls before, during and after it moves money.
//
// The important one is check_payment. An agent declares what it intends to pay
// and why; Limulus compares that with the authorization and the payment order
// and answers proceed, hold or escalate. The agent's stated reason is recorded
// as a commitment, never treated as proof.

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_authorization",
    description:
      "Read the authorization currently in force: spending limit, approved vendors and their accounts on file, and which invoices a person has approved. Call this before proposing any payment.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_payment",
    description:
      "Declare a payment before making it, and get a decision. Provide what you intend to pay and why, the payment order you would submit, and the documents you relied on. Returns proceed, hold or escalate, the checks that ran, and a signed decision id. Never submit a payment that returns hold or escalate.",
    inputSchema: {
      type: "object",
      properties: {
        payeeName: str("Vendor being paid, exactly as it appears in the vendor record"),
        payeeAccountLast4: str("Last four digits of the destination account"),
        amount: num("Amount to pay"),
        currency: str("ISO currency code, for example USD"),
        invoiceId: str("Invoice being paid, for example INV-2291"),
        poId: str("Purchase order, if there is one"),
        reason: str("Why you are paying this, in one sentence"),
        rail: str("Payment rail: ach, wire, card or stablecoin"),
        reference: str("Reference that will appear on the payment order"),
        documents: {
          type: "array",
          description: "The documents you read: invoice, email, purchase order, receipt.",
          items: {
            type: "object",
            properties: {
              name: str("File or message name"),
              type: str("invoice, po, email, receipt or other"),
              text: str("Visible text of the document"),
              hiddenText: str("Any text present in the file but not visible when rendered"),
            },
            required: ["name", "type", "text"],
          },
        },
      },
      required: ["payeeName", "payeeAccountLast4", "amount", "currency", "invoiceId", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "report_settlement",
    description:
      "Report what the payment rail did with a payment: settled, returned, reversed or pending. Limulus compares it with the decision and flags duplicates, wrong amounts, wrong accounts, and payments that settled although they were held.",
    inputSchema: {
      type: "object",
      properties: {
        decisionId: str("The decision id returned by check_payment"),
        status: str("settled, returned, reversed or pending"),
        amount: num("Amount the rail reports"),
        currency: str("ISO currency code"),
        payeeAccountLast4: str("Account the rail actually paid"),
        railReference: str("Rail identifier, for example an ACH trace number"),
        returnCode: str("Return code, when the status is returned"),
      },
      required: ["decisionId", "status", "amount", "currency", "payeeAccountLast4", "railReference"],
      additionalProperties: false,
    },
  },
  {
    name: "get_receipt",
    description:
      "Get the portable signed receipt for a decision. Hand it to a customer, an auditor or a bank; anyone can verify it without contacting Limulus.",
    inputSchema: {
      type: "object",
      properties: { decisionId: str("The decision id returned by check_payment") },
      required: ["decisionId"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_receipt",
    description:
      "Verify a receipt someone gave you. Recomputes the hash over the contents and checks the signature against it, so an edited receipt fails.",
    inputSchema: {
      type: "object",
      properties: { receipt: { type: "object", description: "The receipt JSON, exactly as received" } },
      required: ["receipt"],
      additionalProperties: false,
    },
  },
];

type ToolResult = { text: string; isError?: boolean };

const asText = (value: unknown): ToolResult => ({ text: JSON.stringify(value, null, 2) });

export async function callTool(name: string, args: Record<string, any>): Promise<ToolResult> {
  switch (name) {
    case "get_authorization": {
      const authorization = loadAuthorization();
      return asText({
        policyId: policyId(authorization),
        policyVersion: authorization.policyVersion,
        principal: authorization.principal,
        limitPerPayment: authorization.limitPerPayment,
        currency: authorization.currency,
        approvedVendors: authorization.approvedVendors.map((v) => ({
          name: v.name,
          accountLast4: v.accountLast4,
          bankDetailsUpdated: v.bankDetailsUpdated,
        })),
        approvedInvoices: authorization.approvedInvoices,
        note: "Pay only these vendors, only these invoices, only to the account on file, and only up to the limit.",
      });
    }

    case "check_payment": {
      const authorization = loadAuthorization();

      const declaration: Declaration = {
        agentId: args.agentId ?? "mcp-agent",
        payeeName: args.payeeName,
        payeeAccountLast4: String(args.payeeAccountLast4),
        amount: Number(args.amount),
        currency: args.currency,
        invoiceId: args.invoiceId,
        poId: args.poId,
        reason: args.reason,
        sources: (args.documents ?? []).map((d: Document) => ({ name: d.name, sha256: "declared" })),
      };

      const paymentOrder: PaymentOrder = {
        rail: (args.rail ?? "ach") as PaymentOrder["rail"],
        payeeName: args.payeeName,
        payeeAccountLast4: String(args.payeeAccountLast4),
        amount: Number(args.amount),
        currency: args.currency,
        reference: args.reference ?? args.invoiceId,
      };

      const record = decide({
        authorization,
        declaration,
        paymentOrder,
        documents: (args.documents ?? []) as Document[],
      });

      const verdict =
        record.outcome === "released"
          ? "proceed"
          : record.outcome === "escalated"
            ? "escalate to a person"
            : "hold, do not submit this payment";

      return asText({
        decisionId: record.id,
        verdict,
        outcome: record.outcome,
        reasons: record.reasons,
        checks: record.checks.map((c) => ({ check: c.name, status: c.status, detail: c.detail })),
        policyId: policyId(authorization),
        recordHash: record.hash,
      });
    }

    case "report_settlement": {
      const settlement = recordSettlement({
        decisionId: args.decisionId,
        status: args.status,
        amount: Number(args.amount),
        currency: args.currency,
        payeeAccountLast4: String(args.payeeAccountLast4),
        railReference: args.railReference,
        returnCode: args.returnCode,
        occurredAt: new Date().toISOString(),
      });
      const outcome = verifyOutcomeForDecision(args.decisionId);
      return asText({
        settlementId: settlement.id,
        outcomeStatus: outcome.status,
        findings: outcome.findings,
        guidance:
          outcome.status === "unauthorized"
            ? "This payment settled although it was not released. Escalate to a person now."
            : outcome.status === "returned"
              ? "Reconcile with the vendor using the number on file. Never retry to a new account."
              : "No action needed.",
      });
    }

    case "get_receipt":
      return asText(buildReceipt(args.decisionId));

    case "verify_receipt":
      return asText(verifyReceipt(args.receipt));

    default:
      return { text: `Unknown tool: ${name}`, isError: true };
  }
}
