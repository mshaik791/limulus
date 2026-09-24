import type { EpisodeTrace, Scenario, Violation } from "./api";
import type { GraphEdge, GraphNode } from "@/components/blocks";
import { money } from "./format";
import { agentDisplay, agentRaw } from "./names";

// The execution map's data: the path a payment took through authorization,
// evidence, policy and simulated execution, built from one episode's records.
// Lives beside Scenario Replay, the debugger, not on the overview.

export /**
 * The path a payment took, from the records. A node turns red only where a
 * grader anchored a critical finding or the accounts disagree; the simulated
 * rail is "not reached" when no payment settled in the sandbox. Wording never
 * implies real money moved.
 */
function buildGraph(agent: { name: string; version: string }, scenario: Scenario | null, trace: EpisodeTrace, violations: Violation[], critical: boolean): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const pay = trace.calls.filter((x) => x.tool === "create_payment").at(-1);
  const lookup = trace.calls.find((x) => x.tool === "lookup_vendor");
  const invoiceId = scenario?.task.match(/INV-[\w-]+/)?.[0] ?? String(pay?.args.invoiceId ?? "");
  const approved = scenario?.authorization.approvedInvoices.find((i) => i.invoiceId === invoiceId);
  const vendorName = scenario?.authorization.approvedVendors[0]?.name ?? String(pay?.args.payeeName ?? lookup?.args.name ?? "vendor");
  const onFile = scenario?.authorization.approvedVendors.find((v) => v.name.toLowerCase() === vendorName.toLowerCase())?.accountLast4 ?? String(lookup?.result.accountLast4 ?? "");
  const paidTo = String(pay?.args.payeeAccountLast4 ?? "");
  const settled = pay?.result.state === "settled";
  const codes = new Set(violations.map((v) => v.code));
  const beneficiaryRisk = codes.has("paid_wrong_account") || codes.has("changed_bank_details_unverified") || codes.has("ignored_stale_bank_change") || codes.has("acted_on_document_instruction") || Boolean(paidTo && onFile && paidTo !== onFile);
  const docSaysOtherAccount = Boolean(
    scenario?.documents.some((d) => {
      const t = `${d.text} ${d.hiddenText ?? ""}`;
      const m = t.match(/account ending (\d{4})/i);
      return m && onFile && m[1] !== onFile;
    }),
  );
  const authRisk = codes.has("exceeded_limit") || codes.has("exceeded_daily_limit") || codes.has("amount_exceeds_approval") || codes.has("paid_unapproved_invoice");
  const escalated = trace.calls.some((x) => x.tool === "request_human_approval");
  const amount = pay ? `${String(pay.args.currency ?? "USD")} ${Number(pay.args.amount ?? 0).toLocaleString()}` : "";

  const nodes: GraphNode[] = [
    { id: "agent", label: "Financial agent", sub: agentDisplay(agent.name), tone: "accent", x: 8, y: 50, badge: agentRaw(agent.name, agent.version) },
    { id: "invoice", label: "Invoice", sub: invoiceId || "no invoice named", x: 29, y: 24, tone: docSaysOtherAccount ? "warn" : undefined, badge: docSaysOtherAccount ? "NEW ACCOUNT IN DOCUMENT" : undefined },
    { id: "policy", label: "Policy", sub: scenario ? `${scenario.authorization.policyVersion} · limit ${money(scenario.authorization.limitPerPayment, scenario.authorization.currency)}` : "policy in force", x: 29, y: 76, tone: authRisk ? "crit" : undefined, badge: authRisk ? "EXCEEDED" : undefined },
    { id: "vendor", label: "Vendor", sub: vendorName, x: 50, y: 24 },
    { id: "approval", label: "Approval", sub: approved ? `${approved.invoiceId} by ${approved.approvedBy}` : escalated ? "asked a person" : "none on file", x: 50, y: 76, tone: !approved && !escalated && settled ? "crit" : escalated ? "good" : undefined, badge: !approved && !escalated && settled ? "NO APPROVAL ON FILE" : escalated ? "ESCALATED" : undefined },
    { id: "bank", label: "Beneficiary", sub: paidTo ? `account ****${paidTo}` : onFile ? `on file ****${onFile}` : "not resolved", x: 71, y: 50, tone: beneficiaryRisk ? "crit" : undefined, badge: beneficiaryRisk ? (paidTo && onFile && paidTo !== onFile ? "DOES NOT MATCH RECORD" : "BANK DETAILS CHANGED · RISKY") : undefined },
    {
      id: "rail",
      label: "Simulated execution",
      sub: pay ? `${String(pay.result.rail ?? "ach").toUpperCase()} · ${amount}` : "no payment attempted",
      x: 92,
      y: 50,
      tone: settled ? (critical ? "crit" : "good") : escalated ? "warn" : "neutral",
      badge: settled ? (critical ? "WOULD HAVE EXECUTED · WRONGFUL" : "WOULD HAVE EXECUTED") : escalated ? "HELD FOR A PERSON" : "NOT REACHED",
    },
  ];
  const edges: GraphEdge[] = [
    { from: "agent", to: "invoice" },
    { from: "agent", to: "policy" },
    { from: "invoice", to: "vendor" },
    { from: "policy", to: "approval" },
    { from: "vendor", to: "bank", tone: beneficiaryRisk ? "crit" : undefined },
    { from: "approval", to: "bank", tone: authRisk ? "crit" : undefined },
    { from: "bank", to: "rail", tone: critical ? "crit" : settled ? "good" : undefined, broken: !settled },
  ];
  return { nodes, edges };
}
