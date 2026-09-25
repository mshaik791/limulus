import type { EpisodeTrace, Scenario, Violation } from "./api";
import type { GraphEdge, GraphNode } from "@/components/blocks";
import { money } from "./format";

// The execution map's data: the path a payment took through authorization,
// evidence, policy and simulated execution, built from one episode's records.
// Every node and badge is a recorded fact; the map decides nothing. Each node
// answers one question, and the same finding is never painted on two nodes:
//
//   Policy     the limits in the authorization           exceeded_limit, exceeded_daily_limit
//   Approval   whether a person approved this invoice    paid_unapproved_invoice, amount_exceeds_approval
//   Beneficiary where the money was sent                 account codes
//   Execution  what the simulated rail did with the last attempt

export function buildGraph(agent: { name: string; version: string }, scenario: Scenario | null, trace: EpisodeTrace, violations: Violation[], critical: boolean, subject?: { name: string; version: string; fixture?: boolean }): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const attempts = trace.calls.filter((x) => x.tool === "create_payment");
  const pay = attempts.at(-1);
  const lookup = trace.calls.find((x) => x.tool === "lookup_vendor");
  const taskInvoice = scenario?.task.match(/INV-[\w-]+/)?.[0];
  const docInvoice = scenario?.documents.map((d) => `${d.text} ${d.hiddenText ?? ""}`.match(/INV-[\w-]+/)?.[0]).find(Boolean);
  const proposedInvoice = pay ? String(pay.args.invoiceId ?? "") : "";
  const invoiceId = taskInvoice ?? proposedInvoice;
  const approved = scenario?.authorization.approvedInvoices.find((i) => i.invoiceId === invoiceId);
  const vendorName = scenario?.authorization.approvedVendors[0]?.name ?? String(pay?.args.payeeName ?? lookup?.args.name ?? "vendor");
  const onFile = scenario?.authorization.approvedVendors.find((v) => v.name.toLowerCase() === vendorName.toLowerCase())?.accountLast4 ?? String(lookup?.result.accountLast4 ?? "");
  const paidTo = String(pay?.args.payeeAccountLast4 ?? "");
  const settled = pay?.result.state === "settled";
  const attempted = Boolean(pay);
  const codes = new Set(violations.map((v) => v.code));
  const beneficiaryRisk = codes.has("paid_wrong_account") || codes.has("changed_bank_details_unverified") || codes.has("ignored_stale_bank_change") || codes.has("acted_on_document_instruction") || codes.has("paid_unapproved_payee") || Boolean(paidTo && onFile && paidTo !== onFile);
  const docSaysOtherAccount = Boolean(
    scenario?.documents.some((d) => {
      const t = `${d.text} ${d.hiddenText ?? ""}`;
      const m = t.match(/account ending (\d{4})/i);
      return m && onFile && m[1] !== onFile;
    }),
  );
  const limitRisk = codes.has("exceeded_limit") || codes.has("exceeded_daily_limit");
  const approvalRisk = codes.has("paid_unapproved_invoice") || codes.has("amount_exceeds_approval");
  const escalated = trace.calls.some((x) => x.tool === "request_human_approval");
  const amount = pay ? `${String(pay.args.currency ?? "USD")} ${Number(pay.args.amount ?? 0).toLocaleString()}` : "";

  // Different conditions, different words: the task named an invoice; the
  // payment named one the task did not; the payment omitted the invoice id
  // although a document carries one; no invoice anywhere.
  const invoiceSub = taskInvoice
    ? taskInvoice
    : pay && !proposedInvoice
      ? `No invoice id on the payment${docInvoice ? ` · document: ${docInvoice}` : ""}`
      : proposedInvoice
        ? `${proposedInvoice} · from the payment, not the task`
        : docInvoice
          ? `${docInvoice} in the document · none in the task`
          : "No invoice named in the task or documents";
  const approvalSub = approved ? `${approved.invoiceId} by ${approved.approvedBy}` : escalated ? "asked a person" : !scenario ? "not shown (scenario held out)" : invoiceId ? `${invoiceId} not on the approved list` : "no invoice to approve";
  const approvalBadge = approvalRisk ? (codes.has("amount_exceeds_approval") ? "ABOVE APPROVED AMOUNT" : "PAID WITHOUT APPROVAL") : escalated ? "ESCALATED" : undefined;
  const who: { name: string; version: string; fixture?: boolean } = subject ?? agent;

  const nodes: GraphNode[] = [
    { id: "agent", label: who.fixture ? "Test fixture" : "Financial agent", sub: who.name, tone: "accent", x: 8, y: 50, badge: who.version },
    { id: "invoice", label: "Invoice", sub: invoiceSub, x: 29, y: 24, tone: docSaysOtherAccount ? "warn" : pay && !proposedInvoice ? "warn" : undefined, badge: docSaysOtherAccount ? "NEW ACCOUNT IN DOCUMENT" : pay && !proposedInvoice ? "PAYMENT OMITTED INVOICE ID" : undefined },
    { id: "policy", label: "Policy", sub: scenario ? `${scenario.authorization.policyVersion} · limit ${money(scenario.authorization.limitPerPayment, scenario.authorization.currency)}${scenario.authorization.limitPerDay ? ` · day ${money(scenario.authorization.limitPerDay, scenario.authorization.currency)}` : ""}` : "limits not shown (scenario held out)", x: 29, y: 76, tone: limitRisk ? "crit" : undefined, badge: limitRisk ? (codes.has("exceeded_daily_limit") ? "DAILY CEILING EXCEEDED" : "LIMIT EXCEEDED") : undefined },
    { id: "vendor", label: "Vendor", sub: vendorName, x: 50, y: 24 },
    { id: "approval", label: "Approval", sub: approvalSub, x: 50, y: 76, tone: approvalRisk ? "crit" : escalated ? "good" : undefined, badge: approvalBadge },
    { id: "bank", label: "Beneficiary", sub: paidTo ? `account ****${paidTo}` : onFile ? `on file ****${onFile}` : "not resolved", x: 71, y: 50, tone: beneficiaryRisk ? "crit" : undefined, badge: beneficiaryRisk ? (paidTo && onFile && paidTo !== onFile ? "DOES NOT MATCH RECORD" : codes.has("paid_unapproved_payee") ? "NOT AN APPROVED VENDOR" : "BANK DETAILS CHANGED · RISKY") : undefined },
    {
      id: "rail",
      label: "Simulated execution",
      sub: pay ? `${String(pay.result.rail ?? pay.args.rail ?? "ach").toUpperCase()} · ${amount}${attempts.length > 1 ? ` · attempt ${attempts.length}` : ""}` : "no payment attempted",
      x: 92,
      y: 50,
      tone: settled ? (critical ? "crit" : "good") : attempted ? "warn" : escalated ? "warn" : "neutral",
      badge: settled ? (critical ? "WOULD HAVE EXECUTED · WRONGFUL" : "WOULD HAVE EXECUTED") : attempted ? `ATTEMPTED · ${String(pay?.result.state ?? pay?.result.error ?? "not settled").toUpperCase()}` : escalated ? "HELD FOR A PERSON" : "NOT REACHED",
    },
  ];
  const edges: GraphEdge[] = [
    { from: "agent", to: "invoice" },
    { from: "agent", to: "policy" },
    { from: "invoice", to: "vendor" },
    { from: "policy", to: "approval", tone: limitRisk ? "crit" : undefined },
    { from: "vendor", to: "bank", tone: beneficiaryRisk ? "crit" : undefined },
    { from: "approval", to: "bank", tone: approvalRisk ? "crit" : undefined },
    { from: "bank", to: "rail", tone: critical && settled ? "crit" : settled ? "good" : attempted ? "warn" : undefined, broken: !settled },
  ];
  return { nodes, edges };
}
