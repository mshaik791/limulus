import Link from "next/link";
import { controlTypes, labRun, labRuns, policies, type EpisodeGrade } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, ofN, pct } from "@/lib/format";
import { agentDisplay } from "@/lib/names";
import { Card, EmptyState, LinkButton, Note, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";
import { CompileForm } from "./compile-form";

export const metadata = { title: "Policies" };

// Financial guardrails, not settings. Two things are kept apart on every card:
// the policy's own status (active, because it is in the controls file) and the
// compliance of whichever agent last ran its tests. A weak agent does not make
// a policy red. A pack whose source says it is illustrative is labelled a demo
// pack, so nobody reads example rules as universal requirements.

const CATEGORY: Record<string, string> = { spending_threshold: "Approval", daily_ceiling: "Approval", beneficiary_change: "Beneficiary", vendor_allowlist: "Beneficiary", duplicate_payment: "Duplicate protection" };

export default async function Policies() {
  const [list, types, runs] = await Promise.all([safe(policies()), safe(controlTypes()), safe(labRuns())]);
  if (!list || !types || !runs) return <Offline />;

  const ids = new Set(list.flatMap((p) => p.controls?.flatMap((c) => c.scenarioIds) ?? []));
  const lastGrades = new Map<string, { at: string; runId: string; agent: string; raw: string; grades: EpisodeGrade[] }>();
  for (const r of [...runs].reverse().slice(0, 40)) {
    if (lastGrades.size >= ids.size && ids.size > 0) break;
    const full = await safe(labRun(r.id));
    if (!full) continue;
    for (const g of full.grades) {
      if (ids.has(g.scenarioId) && !lastGrades.has(g.scenarioId)) lastGrades.set(g.scenarioId, { at: r.createdAt, runId: r.id, agent: agentDisplay(r.agent.name), raw: `${r.agent.name} v${r.agent.version}`, grades: [] });
      if (ids.has(g.scenarioId) && lastGrades.get(g.scenarioId)!.runId === r.id) lastGrades.get(g.scenarioId)!.grades.push(g);
    }
  }

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="What rules should the agent obey? Each control compiles into tests; the score is how the last agent did on them."
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
        list.map((p) => {
          const demo = /illustrative|example/i.test(`${p.source ?? ""} ${p.name ?? ""} ${p.file}`);
          return (
            <div key={p.file} className="mb-6">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-[18px] font-semibold">{p.name ?? p.file}</h2>
                {demo && <Pill tone="model">DEMO POLICY PACK</Pill>}
                <span className="text-[12px] text-ink-3">
                  {p.controls?.length ?? 0} controls · <span className="mono">{p.file}</span>
                </span>
              </div>
              {demo && <Note>These controls are illustrative. They show what the compiler does; they are not a statement of what any organisation must require.</Note>}
              {p.error ? (
                <Note tone="crit">{p.error}</Note>
              ) : (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {p.controls?.map((c) => {
                    const tested = c.scenarioIds.map((id) => lastGrades.get(id)).filter(Boolean) as { at: string; runId: string; agent: string; raw: string; grades: EpisodeGrade[] }[];
                    const latestAt = tested.map((t) => t.at).sort().at(-1);
                    const latestRun = tested.find((t) => t.at === latestAt);
                    const gs = tested.filter((t) => t.at === latestAt).flatMap((t) => t.grades);
                    const passed = gs.filter((g) => g.effective === g.expected && g.criticalCount === 0).length;
                    const crit = gs.filter((g) => g.criticalCount > 0).length;
                    const exposure = gs.reduce((n, g) => n + (g.criticalCount ? (g.paidAmount ?? 0) : 0), 0);
                    const chips = c.scenarioIds.map((id) => id.replace(`${c.id}-`, "").replaceAll("-", " "));
                    return (
                      <Card key={c.id}>
                        <div className="text-[16px] font-medium leading-snug">{c.name}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                          <span>{CATEGORY[c.type] ?? c.type}</span>
                          <span>·</span>
                          {c.severity && <span className="text-ink-2">{c.severity} severity</span>}
                          {c.amount !== undefined && <span>· {money(c.amount)}</span>}
                          {c.verifyWithinDays !== undefined && <span>· {c.verifyWithinDays}-day window</span>}
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-4 rounded-[var(--radius-sm)] border border-line bg-surface-2 p-3">
                          <div>
                            <div className="eyebrow">Policy status</div>
                            <div className="mt-1">
                              <Pill tone="good">ACTIVE</Pill>
                            </div>
                            <div className="mt-1 text-[11.5px] text-ink-3">
                              {int(c.scenarios)} tests generated · {int(c.traps)} trap, {int(c.scenarios - c.traps)} pay
                            </div>
                          </div>
                          <div>
                            <div className="eyebrow">Agent compliance</div>
                            <div className={`mt-1 text-[22px] font-semibold leading-none tabular ${gs.length ? (crit ? "text-crit-ink" : passed === gs.length ? "text-good-ink" : "text-warn-ink") : "text-ink-3"}`}>{gs.length ? pct(passed, gs.length) : "not evaluated"}</div>
                            <div className="mt-1 text-[11.5px] text-ink-3">
                              {gs.length ? (
                                <>
                                  {ofN(passed, gs.length)} episodes · {int(crit)} critical
                                  {exposure ? ` · ${money(exposure)} simulated` : ""} ·{" "}
                                  {latestRun && (
                                    <Link href={`/labs/tests/${latestRun.runId}`} title={latestRun.raw}>
                                      {latestRun.agent}
                                    </Link>
                                  )}{" "}
                                  {latestAt && ago(latestAt)}
                                </>
                              ) : (
                                "no agent has run these tests yet"
                              )}
                            </div>
                          </div>
                        </div>

                        <details className="mt-3">
                          <summary className="cursor-pointer text-[12.5px] text-accent-ink">{int(c.scenarioIds.length)} generated tests · {chips.slice(0, 3).join(", ")}{chips.length > 3 ? ", …" : ""}</summary>
                          <ul className="mt-2 grid gap-1 text-[12.5px]">
                            {c.scenarioIds.map((id) => {
                              const t = lastGrades.get(id);
                              const g = t?.grades[0];
                              return (
                                <li key={id} className="flex items-center justify-between gap-3 rounded-[6px] bg-surface-2 px-2.5 py-1.5">
                                  <span className="mono text-[12px]">{id}</span>
                                  {g ? (
                                    <Link href={`/labs/tests/${t!.runId}/scenarios/${id}`}>
                                      <Pill tone={g.criticalCount ? "crit" : g.effective === g.expected ? "good" : "warn"}>{g.criticalCount ? "critical failure" : g.effective === g.expected ? "pass" : g.effective}</Pill>
                                    </Link>
                                  ) : (
                                    <Pill tone={toneForVerdict("pending")}>not run</Pill>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </details>
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
          );
        })
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
