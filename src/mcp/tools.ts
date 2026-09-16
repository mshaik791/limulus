import { decide } from "../decide.ts";
import { recordSettlement, verifyOutcomeForDecision } from "../outcome.ts";
import { buildReceipt, verifyReceipt } from "../receipt.ts";
import { loadAuthorization, policyId } from "../policy-store.ts";
import { verdictFor } from "../verdict.ts";
import { readQualifications } from "../qualification.ts";
import { gatePayment } from "../rails/gate.ts";
import type { Declaration, Document, PaymentOrder } from "../types.ts";

// Tools an agent calls before, during and after it moves money.
//
// The important one is check_payment. An agent declares what it intends to pay
// and why; Limulus compares that with the authorization and the payment order
// and answers ALLOW, BLOCK, ESCALATE or WAIT. The agent's stated reason is
// recorded as a commitment, never treated as proof.
//
// Two tools are deliberately absent. An agent cannot set its own policy, and it
// cannot issue itself a qualification. It may read both.

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
      "Declare a payment before making it, and get a verdict. Provide what you intend to pay and why, the payment order you would submit, and the documents you relied on. Returns ALLOW, BLOCK, ESCALATE or WAIT, with explanation codes, the checks that ran, and a signed decision id. Submit only on ALLOW. On WAIT, poll and do not submit anything: an earlier payment has not been confirmed and submitting again is how an invoice gets paid twice.",
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
        qualificationId: str(
          "The qualification you are operating under, if you have one. Get it from get_qualification. Without it this payment is checked against policy only, and cannot be released on your authority alone.",
        ),
        agentVersion: str("Your version, so the qualification can be checked against what was actually tested"),
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
    name: "pay_invoice",
    description:
      "Actually make a payment. The payment is created at the bank in a held state, checked against the authorization, and then either approved or cancelled — you do not get to skip the check. Returns the verdict, the bank's transfer id and its status. Use this when you have decided to pay; use check_payment first if you want to know the answer without creating anything.",
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
        qualificationId: str("The qualification you are operating under, if you have one"),
        agentVersion: str("Your version, so the qualification can be checked against what was tested"),
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
    name: "get_qualification",
    description:
      "Find out what you are cleared to do on your own: which workflow, which rail, up to what amount, to which payees, and until when. Call this once at the start of a run and pass the qualificationId to check_payment. If you are not qualified, you can still work — payments needing judgment will go to a person.",
    inputSchema: {
      type: "object",
      properties: { agentName: str("Your agent name, if you know it") },
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

      const verdict = verdictFor(record, {
        qualificationId: args.qualificationId,
        scope: args.qualificationId
          ? {
              agentName: declaration.agentId,
              agentVersion: args.agentVersion ?? "unknown",
              workflow: "invoice-payment",
              rail: paymentOrder.rail,
              payeeOnFile: authorization.approvedVendors.some(
                (v) => v.name.toLowerCase() === paymentOrder.payeeName.toLowerCase(),
              ),
            }
          : undefined,
      });

      const guidance = {
        ALLOW: "Submit this payment, then report what the rail did with report_settlement.",
        BLOCK: "Do not submit this payment, and do not try a variation of it. Tell the person who gave you this task.",
        ESCALATE: "A person has to decide. Do not submit anything until they answer.",
        WAIT: "An earlier payment for this invoice has not been confirmed. Poll get_receipt or check again later. Do not submit another payment.",
      }[verdict.verdict];

      return asText({
        verdict: verdict.verdict,
        guidance,
        explanation: verdict.explanation,
        decisionId: verdict.decisionId,
        decisionHash: verdict.decisionHash,
        qualification: verdict.qualification,
        retryAfterMs: verdict.retryAfterMs,
        checks: record.checks.map((c) => ({ check: c.name, status: c.status, detail: c.detail })),
        policyId: policyId(authorization),
      });
    }

    case "pay_invoice": {
      // The agent is making the payment, not asking about it. The transfer is
      // created held at the bank before anything is checked, so the check is
      // not something the agent can route around.
      const authorization = loadAuthorization();

      const result = await gatePayment({
        request: {
          authorization,
          declaration: {
            agentId: args.agentId ?? "mcp-agent",
            payeeName: args.payeeName,
            payeeAccountLast4: String(args.payeeAccountLast4),
            amount: Number(args.amount),
            currency: args.currency,
            invoiceId: args.invoiceId,
            poId: args.poId,
            reason: args.reason,
            sources: (args.documents ?? []).map((d: Document) => ({ name: d.name, sha256: "declared" })),
          },
          paymentOrder: {
            rail: "ach",
            payeeName: args.payeeName,
            payeeAccountLast4: String(args.payeeAccountLast4),
            amount: Number(args.amount),
            currency: args.currency,
            reference: args.invoiceId,
          },
          documents: (args.documents ?? []) as Document[],
        },
        accountId: process.env.INCREASE_ACCOUNT_ID ?? "account_sandbox_demo",
        routingNumber: "101050001",
        accountNumber: "987654321",
        qualificationId: args.qualificationId,
        agent: { name: args.agentId ?? "mcp-agent", version: args.agentVersion },
      });

      const paid = result.verdict.verdict === "ALLOW";
      return asText({
        paid,
        verdict: result.verdict.verdict,
        outcome: result.action,
        transfer: {
          id: result.transfer.id,
          status: result.transfer.statusAfter,
          stillStoppable: result.transfer.stoppable,
        },
        rail: result.rail,
        explanation: result.verdict.explanation,
        decisionId: result.verdict.decisionId,
        guidance: paid
          ? "The payment was approved at the bank. Report what the rail does with report_settlement."
          : result.verdict.verdict === "BLOCK"
            ? "The payment was cancelled at the bank and no money moved. Do not try a variation of it — tell the person who gave you this task what happened and why."
            : "The payment is held at the bank and will expire unsent unless a person approves it. Stop here and wait.",
      });
    }

    case "get_qualification": {
      // Read-only on purpose. An agent may know what it is cleared for; it may
      // not grant itself more. Issuing a qualification requires a Lab run.
      const all = readQualifications().filter((q) => !q.revokedAt && Date.parse(q.expiresAt) > Date.now());
      const mine = args.agentName ? all.filter((q) => q.binding.agent.name === args.agentName) : all;
      const current = mine.at(-1);

      if (!current) {
        return asText({
          qualified: false,
          note: "No qualification is in force. Payments will be checked against policy, and anything needing judgment goes to a person. To be qualified, this agent version has to be run through the Lab.",
        });
      }

      return asText({
        qualified: true,
        qualificationId: current.id,
        level: current.level,
        expiresAt: current.expiresAt,
        cleared: {
          workflow: current.binding.workflow,
          rail: current.binding.rail,
          upTo: `${current.binding.amountLimit.toLocaleString()} ${current.binding.currency}`,
          payees: current.binding.payeeScope === "on-file" ? "vendors already on file" : "any payee",
        },
        boundTo: {
          agent: `${current.binding.agent.name} v${current.binding.agent.version}`,
          suite: `${current.binding.suite.id} ${current.binding.suite.version}`,
        },
        note: "Pass this qualificationId to check_payment. Anything outside this scope goes to a person, which is expected and not an error.",
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
