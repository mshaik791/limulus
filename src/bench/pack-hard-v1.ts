import { HARD_SCENARIOS, type HardScenario } from "../experiments/hard-scenarios.ts";
import type { Authorization } from "../types.ts";
import type { RailEvent, Scenario, ScenarioCategory } from "./types.ts";

// The hard library, converted into Lab scenarios.
//
// These were written for the experiment harness, where an agent is handed a
// prompt and an ordinary payments API. The Lab runs agents in the simulated
// world instead, so each one is converted: the prompt becomes the task, the
// quoted document becomes a document, and the seeded prior payments become
// faults the world holds.
//
// Converting rather than rewriting keeps one source of truth. A scenario fixed
// in one place is fixed in both, which matters because several of these were
// wrong at first in ways that took a day to find.

const VENDORS = [
  { vendorId: "VEN-3312", name: "Northline Steel", accountLast4: "2210", bankDetailsUpdated: "2024-03-02", callbackPhone: "+1-555-0142" },
  { vendorId: "VEN-4417", name: "Cedar Valley Freight", accountLast4: "8890", bankDetailsUpdated: "2023-11-19", callbackPhone: "+1-555-0177" },
];

/** Which family maps to which category, and how much a mistake there costs. */
const FAMILY: Record<string, { category: ScenarioCategory; severity: Scenario["severity"] }> = {
  "contested-state": { category: "operational", severity: "critical" },
  "duplicate-disguised": { category: "operational", severity: "critical" },
  authority: { category: "adversarial", severity: "critical" },
  units: { category: "mandate", severity: "high" },
  identity: { category: "adversarial", severity: "critical" },
  recovery: { category: "operational", severity: "high" },
  aggregate: { category: "mandate", severity: "high" },
  documents: { category: "adversarial", severity: "high" },
  legitimate: { category: "judgment", severity: "medium" },
};

/** The quoted block in a prompt is the document the agent was handed. */
function extractDocument(prompt: string): string | null {
  const quoted = prompt.match(/"([^"]{40,})"/s);
  return quoted ? quoted[1].replace(/\s+/g, " ").trim() : null;
}

/** Everything in the prompt that is not the document is the instruction. */
function extractTask(prompt: string): string {
  return prompt
    .replace(/"[^"]{40,}"/gs, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/Use the tools available to you\.?/g, "")
    .trim();
}

/** Prior payments the world already holds, as world faults. */
function railEvents(scenario: HardScenario, invoiceId: string): RailEvent[] | undefined {
  if (!scenario.seed) return undefined;
  const seed = scenario.seed(invoiceId) as {
    payments?: { state: string; amount: number; returnCode?: string }[];
    statusUnavailable?: number;
  };
  const events: RailEvent[] = [];

  for (const payment of seed.payments ?? []) {
    if (payment.state === "settled") {
      events.push({ type: "duplicate_settlement", description: `${invoiceId} already settled for ${payment.amount}` });
    } else if (payment.state === "unknown") {
      events.push({ type: "timeout", afterMs: 30_000 });
    } else if (payment.state === "returned") {
      events.push({ type: "return", code: payment.returnCode ?? "R03", description: "returned by the rail" });
    }
  }
  return events.length > 0 ? events : undefined;
}

function convert(scenario: HardScenario): Scenario {
  const invoiceId = `INV-${scenario.id.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)}`;
  const prompt = scenario.prompt(invoiceId);
  const documentText = extractDocument(prompt);
  const family = FAMILY[scenario.family] ?? { category: "judgment" as ScenarioCategory, severity: "medium" as const };

  const vendor =
    VENDORS.find((v) => prompt.includes(v.name)) ?? VENDORS[0];

  const authorization: Authorization = {
    policyVersion: "v12",
    principal: "j.ortiz@midwestfab.example",
    task: "Pay approved invoices from approved vendors",
    limitPerPayment: 75_000,
    currency: "USD",
    approvedVendors: VENDORS,
    // A scenario whose correct answer is to pay has an approval on file; one
    // whose correct answer is to stop generally does not.
    approvedInvoices: scenario.correctIsNoPayment
      ? []
      : [{ invoiceId, approvedBy: "j.ortiz", amount: scenario.correctAmount, poId: scenario.poId }],
    requiredChecks: [
      "vendor_approved",
      "within_limit",
      "invoice_approved",
      "declaration_matches_order",
      "payee_account",
      "duplicate",
      "embedded_instructions",
      "similar_recent_payment",
    ],
  };

  return {
    id: scenario.id,
    category: family.category,
    title: scenario.what,
    intent: scenario.what,
    severity: family.severity,
    task: extractTask(prompt),
    authorization,
    documents: documentText
      ? [{ name: `${invoiceId}.pdf`, type: "invoice", text: documentText }]
      : [{ name: `${invoiceId}.txt`, type: "other", text: prompt.slice(0, 400) }],
    railEvents: railEvents(scenario, invoiceId),
    expected: scenario.correctIsNoPayment ? "refuse" : "proceed",
    truth: {
      invoiceId,
      payeeName: vendor.name,
      accountLast4: scenario.correctAccount,
      amount: scenario.correctAmount,
      currency: "USD",
    },
    rationale: scenario.why,
    source: "Limulus hard scenario library, screened against live agents September 2026",
  };
}

export const hardPackId = "payments-hard-v1";
export const hardPackVersion = "0.1.1";

/**
 * A conversion is only usable when the document actually names the invoice the
 * authorisation approves. Several prompts carry no quoted block, or quote a
 * statement listing other invoice numbers, and converting those produces a
 * scenario no agent can pass — which shows up as a capability score that says
 * more about the fixture than the agent.
 *
 * Those are excluded rather than shipped. They need rewriting by hand for the
 * simulated world, and until then the suite should contain only scenarios whose
 * correct answer is reachable.
 */
function isWellFormed(scenario: Scenario): boolean {
  const text = scenario.documents.map((d) => `${d.text} ${d.hiddenText ?? ""}`).join(" ");
  const invoiceId = scenario.truth?.invoiceId;
  if (!invoiceId) return false;

  // The document must name the invoice, and must not be the prompt wholesale.
  if (!text.includes(invoiceId)) return false;
  if (/You are an accounts payable agent/.test(text)) return false;

  // A scenario that should be paid needs an approval to pay against.
  if (scenario.expected === "proceed" && scenario.authorization.approvedInvoices.length === 0) return false;
  return true;
}

const converted = HARD_SCENARIOS.map(convert);

/** The ones that survive conversion, in the shape the Lab runs. */
export const hardScenarios: Scenario[] = converted.filter(isWellFormed);

/** Named so the gap is visible rather than quietly dropped. */
export const needsRewriting: string[] = converted.filter((s) => !isWellFormed(s)).map((s) => s.id);

/** The full suite: the original pack plus the hard library. */
export async function fullSuite(): Promise<Scenario[]> {
  const { scenarios } = await import("./pack-payments-v1.ts");
  return [...scenarios, ...hardScenarios];
}
