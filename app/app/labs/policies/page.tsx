import Link from "next/link";
import { controlTypes, labRun, labRuns, policies, type EpisodeGrade } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, ofN, pct } from "@/lib/format";
import { Card, EmptyState, Note, Offline, PageHeader, Pill } from "@/components/ui";
import { CompileForm } from "./compile-form";

export const metadata = { title: "Policies" };

// Financial guardrails, not settings. Each control is a sentence a customer
// would say, with what it compiles into and how the agent did on it the last
// time those tests ran.

function describe(c: { type: string; name: string; amount?: number; verifyWithinDays?: number }): string {
  return c.name;
}

export default async function Policies() {
  const [list, types, runs] = await Promise.all([safe(policies()), safe(controlTypes()), safe(labRuns())]);
  if (!list || !types || !runs) return <Offline />;

  // Last result per control: the most recent run whose grades include any of
  // the control's scenario ids. Grades are on the full run record.
  const ids = new Set(list.flatMap((p) => p.controls?.flatMap((c) => c.scenarioIds) ?? []));
  const lastGrades = new Map<string, { at: string; runId: string; agent: string; grades: EpisodeGrade[] }>();
  for (const r of [...runs].reverse().slice(0, 40)) {
    if (lastGrades.size >= ids.size && ids.size > 0) break;
    const full = await safe(labRun(r.id));
    if (!full) continue;
    for (const g of full.grades) {
      if (ids.has(g.scenarioId) && !lastGrades.has(g.scenarioId)) lastGrades.set(g.scenarioId, { at: r.createdAt, runId: r.id, agent: `${r.agent.name} v${r.agent.version}`, grades: [] });
      if (ids.has(g.scenarioId) && lastGrades.get(g.scenarioId)!.runId === r.id) lastGrades.get(g.scenarioId)!.grades.push(g);
    }
  }

  return (
    <>
      <PageHeader title="Policies" subtitle="A customer's rule is one sentence. Each control compiles into the edges of the rule, plus a payment that is legitimate under it, and those tests run like any others." />

      {list.length === 0 ? (
        <EmptyState title="No controls files yet." body="Controls live in policies/*.controls.json in the repository. Write one, or paste one below to see what it compiles into." />
      ) : (
        list.map((p) => (
          <div key={p.file} className="mb-6">
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-[16px] font-semibold">{p.name ?? p.file}</h2>
              <span className="text-[12px] text-ink-3">
                <span className="mono">{p.file}</span>
                {p.policyId && (
                  <>
                    {" "}
                    · <span className="mono">{p.policyId}</span>
                  </>
                )}
                {p.source && ` · ${p.source}`}
              </span>
            </div>
            {p.error ? (
              <Note tone="crit">{p.error}</Note>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {p.controls?.map((c) => {
                  const tested = c.scenarioIds.map((id) => lastGrades.get(id)).filter(Boolean) as { at: string; runId: string; agent: string; grades: EpisodeGrade[] }[];
                  const latestAt = tested.map((t) => t.at).sort().at(-1);
                  const latestRun = tested.find((t) => t.at === latestAt)?.runId;
                  const latestAgent = tested.find((t) => t.at === latestAt)?.agent;
                  const gs = tested.filter((t) => t.at === latestAt).flatMap((t) => t.grades);
                  const passed = gs.filter((g) => g.effective === g.expected && g.criticalCount === 0).length;
                  const crit = gs.reduce((n, g) => n + g.criticalCount, 0);
                  const exposure = gs.reduce((n, g) => n + (g.criticalCount ? (g.paidAmount ?? 0) : 0), 0);
                  return (
                    <Card key={c.id} emphasis={crit > 0 ? "crit" : undefined}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-medium leading-snug">{describe(c)}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                            <span className="mono">{c.type}</span>
                            <span className="mono">{c.id}</span>
                            {c.severity && <Pill tone={c.severity === "critical" ? "crit" : c.severity === "high" ? "warn" : "neutral"}>{c.severity}</Pill>}
                          </div>
                        </div>
                        <Pill tone="good">active</Pill>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
                        <div>
                          <div className="text-ink-3">tests generated</div>
                          <div className="mt-0.5 text-[18px] font-semibold tabular">{int(c.scenarios)}</div>
                          <div className="text-ink-3">{int(c.traps)} trap · {int(c.scenarios - c.traps)} pay</div>
                        </div>
                        <div>
                          <div className="text-ink-3">last tested</div>
                          <div className="mt-0.5 text-[18px] font-semibold">{latestAt ? ago(latestAt) : "never"}</div>
                          {latestRun && (
                            <Link href={`/labs/tests/${latestRun}`} className="text-ink-3">
                              {latestAgent}
                            </Link>
                          )}
                        </div>
                        <div>
                          <div className="text-ink-3">pass rate</div>
                          <div className={`mt-0.5 text-[18px] font-semibold tabular ${crit ? "text-crit-ink" : gs.length ? "text-good-ink" : ""}`}>{gs.length ? pct(passed, gs.length) : "–"}</div>
                          <div className="text-ink-3">{gs.length ? `${ofN(passed, gs.length)} episodes${exposure ? ` · ${money(exposure)} simulated` : ""}` : "not run yet"}</div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
            {p.policyId && (
              <pre className="mono mt-3 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11px] text-ink-2">{`node src/policy-cli.ts compile policies/${p.file}          # writes build/compiled/${p.policyId}/
node src/lab-cli.ts run careful 3 --scenarios build/compiled/${p.policyId}`}</pre>
            )}
          </div>
        ))
      )}

      <Card title="Generate tests from a policy" className="mt-2">
        <CompileForm />
      </Card>

      <Card title="Control types" className="mt-4" padded={false}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="pl-5">type</th>
              <th>what it means</th>
              <th>parameters</th>
              <th className="pr-5 text-right">cases</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(types).map(([type, info]) => (
              <tr key={type}>
                <td className="mono pl-5">{type}</td>
                <td className="text-ink-2">{info.summary}</td>
                <td className="mono text-[12px] text-ink-3">{info.parameters.join(", ") || "none"}</td>
                <td className="pr-5 text-right tabular">{info.cases}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
