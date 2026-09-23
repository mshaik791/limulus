import Link from "next/link";
import { controlTypes, labRun, labRuns, policies, type EpisodeGrade } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, ofN, pct } from "@/lib/format";
import { agentDisplay } from "@/lib/names";
import { Card, EmptyState, LinkButton, Note, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";
import { CompileForm } from "./compile-form";

export const metadata = { title: "Policies" };

// Financial guardrails, not settings. Each control is a sentence a customer
// would say, with the edge cases it compiles into as chips, the last result
// those tests produced, and the generated scenarios one click away. New
// Policy and Import both land on the compiler, because a policy here is a
// controls file and the compiler is how one is written.

const CATEGORY: Record<string, string> = { spending_threshold: "Approval", daily_ceiling: "Approval", beneficiary_change: "Beneficiary", vendor_allowlist: "Beneficiary", duplicate_payment: "Duplicate protection" };

export default async function Policies() {
  const [list, types, runs] = await Promise.all([safe(policies()), safe(controlTypes()), safe(labRuns())]);
  if (!list || !types || !runs) return <Offline />;

  const ids = new Set(list.flatMap((p) => p.controls?.flatMap((c) => c.scenarioIds) ?? []));
  const lastGrades = new Map<string, { at: string; runId: string; agent: string; grades: EpisodeGrade[] }>();
  for (const r of [...runs].reverse().slice(0, 40)) {
    if (lastGrades.size >= ids.size && ids.size > 0) break;
    const full = await safe(labRun(r.id));
    if (!full) continue;
    for (const g of full.grades) {
      if (ids.has(g.scenarioId) && !lastGrades.has(g.scenarioId)) lastGrades.set(g.scenarioId, { at: r.createdAt, runId: r.id, agent: `${agentDisplay(r.agent.name)} v${r.agent.version}`, grades: [] });
      if (ids.has(g.scenarioId) && lastGrades.get(g.scenarioId)!.runId === r.id) lastGrades.get(g.scenarioId)!.grades.push(g);
    }
  }

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="Turn financial controls into executable agent tests."
        actions={
          <>
            <LinkButton href="#compile">Import Policies</LinkButton>
            <LinkButton href="#compile" tone="accent">
              New Policy
            </LinkButton>
          </>
        }
      />

      {list.length === 0 ? (
        <EmptyState title="No controls files yet." body="Controls live in policies/*.controls.json in the repository. Write one below to see what it compiles into." />
      ) : (
        list.map((p) => (
          <div key={p.file} className="mb-6">
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-[18px] font-semibold">{p.name ?? p.file}</h2>
              <span className="text-[12px] text-ink-3">
                {p.controls?.length ?? 0} controls · {p.source ?? p.file}
              </span>
            </div>
            {p.error ? (
              <Note tone="crit">{p.error}</Note>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {p.controls?.map((c) => {
                  const tested = c.scenarioIds.map((id) => lastGrades.get(id)).filter(Boolean) as { at: string; runId: string; agent: string; grades: EpisodeGrade[] }[];
                  const latestAt = tested.map((t) => t.at).sort().at(-1);
                  const latestRun = tested.find((t) => t.at === latestAt);
                  const gs = tested.filter((t) => t.at === latestAt).flatMap((t) => t.grades);
                  const passed = gs.filter((g) => g.effective === g.expected && g.criticalCount === 0).length;
                  const crit = gs.reduce((n, g) => n + g.criticalCount, 0);
                  const exposure = gs.reduce((n, g) => n + (g.criticalCount ? (g.paidAmount ?? 0) : 0), 0);
                  const chips = c.scenarioIds.map((id) => id.replace(`${c.id}-`, "").replaceAll("-", " "));
                  return (
                    <Card key={c.id} emphasis={crit > 0 ? "crit" : undefined}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-[16px] font-medium leading-snug">{c.name}</div>
                        <Pill tone="good">active</Pill>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                        <span>{CATEGORY[c.type] ?? c.type}</span>
                        <span>·</span>
                        {c.severity && <Pill tone={c.severity === "critical" ? "crit" : c.severity === "high" ? "warn" : "neutral"}>{c.severity}</Pill>}
                        {c.amount !== undefined && <span>· {money(c.amount)}</span>}
                        {c.verifyWithinDays !== undefined && <span>· {c.verifyWithinDays}-day window</span>}
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
                        <div>
                          <div className="text-ink-3">tests generated</div>
                          <div className="mt-0.5 text-[22px] font-semibold tabular">{int(c.scenarios)}</div>
                          <div className="text-ink-3">{int(c.traps)} trap · {int(c.scenarios - c.traps)} pay</div>
                        </div>
                        <div>
                          <div className="text-ink-3">pass rate</div>
                          <div className={`mt-0.5 text-[22px] font-semibold tabular ${crit ? "text-crit-ink" : gs.length ? "text-good-ink" : ""}`}>{gs.length ? pct(passed, gs.length) : "–"}</div>
                          <div className="text-ink-3">{gs.length ? `${ofN(passed, gs.length)} episodes${exposure ? ` · ${money(exposure)} simulated` : ""}` : "not evaluated yet"}</div>
                        </div>
                        <div>
                          <div className="text-ink-3">last evaluated</div>
                          <div className="mt-0.5 text-[22px] font-semibold">{latestAt ? ago(latestAt) : "never"}</div>
                          {latestRun && (
                            <Link href={`/labs/tests/${latestRun.runId}`} className="text-ink-3">
                              {latestRun.agent}
                            </Link>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {chips.map((ch) => (
                          <span key={ch} className="rounded-full border border-line bg-surface-2 px-2 py-[2px] text-[11.5px] text-ink-2">
                            {ch}
                          </span>
                        ))}
                      </div>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[12.5px] text-accent-ink">Generated scenarios</summary>
                        <ul className="mt-2 grid gap-1 text-[12.5px]">
                          {c.scenarioIds.map((id) => {
                            const t = lastGrades.get(id);
                            const g = t?.grades[0];
                            return (
                              <li key={id} className="flex items-center justify-between gap-3 rounded-[6px] bg-surface-2 px-2.5 py-1.5">
                                <span className="mono text-[12px]">{id}</span>
                                {g ? (
                                  <Link href={`/labs/tests/${t!.runId}/scenarios/${id}`}>
                                    <Pill tone={g.criticalCount ? "crit" : g.effective === g.expected ? "good" : "warn"}>{g.criticalCount ? "critical" : g.effective === g.expected ? "pass" : g.effective}</Pill>
                                  </Link>
                                ) : (
                                  <Pill tone={toneForVerdict("pending")}>not run</Pill>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                      <div className="mt-3">
                        <LinkButton href="#compile">Generate More Tests</LinkButton>
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

      <div id="compile" className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <Card title="Write or import a policy">
            <CompileForm />
          </Card>
        </div>
        <div className="xl:col-span-4">
          <Card title="Control types" padded={false} className="h-full">
            <ul>
              {Object.entries(types).map(([type, info]) => (
                <li key={type} className="border-b border-line px-6 py-3 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">{CATEGORY[type] ?? type}</span>
                    <span className="text-[11.5px] tabular text-ink-3">{info.cases} cases</span>
                  </div>
                  <div className="mono text-[11px] text-ink-3">{type}</div>
                  <div className="mt-1 text-[12.5px] text-ink-2">{info.summary}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
