import { NextResponse } from "next/server";
import { candidates, gates, labRuns, records, shadowRecords } from "@/lib/api";
import { suiteName } from "@/lib/names";
import { money, when } from "@/lib/format";

// Search across what the engine has sealed. Reads the same lists the screens
// read; matches on agent names, ids, scenario ids, invoices and payees.

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json([]);
  const hits: { kind: string; label: string; sub?: string; href: string }[] = [];
  const has = (s: unknown) => String(s ?? "").toLowerCase().includes(q);

  try {
    const [runs, gt, chain, shadow, cands] = await Promise.all([labRuns(), gates(), records(), shadowRecords(), candidates()]);

    const agents = new Map<string, (typeof runs)[number]>();
    for (const r of runs) agents.set(`${r.agent.name}@${r.agent.version}`, r);
    for (const r of agents.values()) if (has(r.agent.name) || has(r.agent.version)) hits.push({ kind: "agent", label: `${r.agent.name} v${r.agent.version}`, sub: `latest run ${when(r.createdAt)}`, href: `/labs/tests/${r.id}` });

    for (const r of [...runs].reverse()) {
      if (has(r.id) || has(r.suite.id)) hits.push({ kind: "test run", label: `${r.agent.name} v${r.agent.version} · ${suiteName(r.suite.id).name}`, sub: r.id, href: `/labs/tests/${r.id}` });
      for (const c of r.axes.criticalViolations) if (has(c.scenarioId)) hits.push({ kind: "scenario", label: c.scenarioId, sub: `critical in ${r.id}`, href: `/labs/tests/${r.id}/scenarios/${c.scenarioId}` });
    }
    for (const g of [...gt].reverse()) if (has(g.id) || has(g.agent.name)) hits.push({ kind: "release gate", label: `${g.agent.name} v${g.agent.version} · ${g.verdict}`, sub: g.id, href: `/labs/releases/${g.id}` });
    for (const r of [...chain].reverse()) {
      if (has(r.id) || has(r.declaration.invoiceId) || has(r.paymentOrder.payeeName) || has(r.declaration.agentId)) {
        hits.push({ kind: "decision", label: `${money(r.paymentOrder.amount, r.paymentOrder.currency)} to ${r.paymentOrder.payeeName} · ${r.outcome}`, sub: r.declaration.invoiceId, href: `/decisions/${r.id}` });
      }
    }
    for (const s of [...shadow].reverse()) if (has(s.id) || has(s.payment.invoiceId) || has(s.payment.payeeName) || has(s.agentId)) hits.push({ kind: "shadow", label: `${money(s.payment.amount, s.payment.currency)} to ${s.payment.payeeName} · ${s.agreement.replaceAll("_", " ")}`, sub: s.id, href: `/production/${s.id}` });
    for (const c of cands) if (has(c.id) || has(c.taxonomyNode) || has(c.scenario.title)) hits.push({ kind: "incident", label: c.scenario.title, sub: c.status, href: "/incidents" });
  } catch {
    return NextResponse.json([]);
  }

  const seen = new Set<string>();
  return NextResponse.json(hits.filter((h) => (seen.has(h.href + h.label) ? false : (seen.add(h.href + h.label), true))).slice(0, 24));
}
