import Link from "next/link";
import { ApiError, episodes, labRun, scenario as loadScenario, type Scenario } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ms } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Card, Empty, KV, Note, Offline, PageHeader, Pill, SandboxBar, toneForSeverity, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Scenario replay" };

// The signature Labs screen. Left: what the agent was given and what a correct
// agent does. Centre: every tool call, in order, with its result. Right: what
// the graders found, each finding anchored to the call it was decided from.
// The agent's stated reason is shown last and labelled as recorded, not
// trusted: the calls are the evidence.

export default async function Replay(props: PageProps<"/labs/tests/[runId]/scenarios/[scenarioId]">) {
  const { runId, scenarioId } = await props.params;
  const search = await props.searchParams;
  const [run, traces] = await Promise.all([safe(labRun(runId)), safe(episodes(runId, scenarioId))]);
  if (!run || !traces) return <Offline />;

  let scenario: Scenario | null = null;
  let scenarioNote = "";
  try {
    scenario = await loadScenario(scenarioId);
  } catch (e) {
    scenarioNote = e instanceof ApiError ? (e.status === 404 ? "This scenario is not in the open pool, so its documents are not shown here: it is held out, or it came from a customer's files or a compiled suite." : e.message) : "The engine is not reachable.";
  }

  const grades = run.grades.filter((g) => g.scenarioId === scenarioId);
  const wanted = Number(Array.isArray(search.trial) ? search.trial[0] : search.trial);
  const worst = grades.find((g) => g.criticalCount > 0) ?? grades.find((g) => g.effective !== g.expected) ?? grades[0];
  const grade = grades.find((g) => g.trial === wanted) ?? worst;
  const trace = traces.find((t) => t.trial === grade?.trial) ?? traces[0];
  if (!grade || !trace) {
    return (
      <>
        <Breadcrumb items={[{ href: "/labs/tests", label: "Test runs" }, { href: `/labs/tests/${run.id}`, label: run.id }, { label: scenarioId }]} />
        <Empty>No episode of {scenarioId} in this run.</Empty>
      </>
    );
  }
  const seqWithFinding = new Map<number, typeof grade.violations>();
  for (const v of grade.violations) {
    if (v.evidence) seqWithFinding.set(v.evidence.seq, [...(seqWithFinding.get(v.evidence.seq) ?? []), v]);
  }
  const unanchored = grade.violations.filter((v) => !v.evidence);

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/tests", label: "Test runs" }, { href: `/labs/tests/${run.id}`, label: run.id }, { label: scenarioId }]} />
      <PageHeader
        title={scenario?.title ?? scenarioId}
        subtitle={
          <>
            <span className="mono">{scenarioId}</span> · {run.agent.name} v{run.agent.version} · trial {grade.trial} of {grades.length}
            {grades.length > 1 && (
              <span className="ml-2">
                {grades.map((g) => (
                  <Link key={g.trial} href={`?trial=${g.trial}`} className={`mr-1 rounded px-1.5 ${g.trial === grade.trial ? "bg-accent-soft text-accent-ink" : "text-ink-3"}`}>
                    {g.trial}
                  </Link>
                ))}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Pill tone={toneForVerdict(grade.expected)}>expected {grade.expected}</Pill>
            <Pill tone={grade.criticalCount > 0 ? "crit" : grade.effective === grade.expected ? "good" : "warn"}>did {grade.effective}</Pill>
          </>
        }
      />
      <SandboxBar />

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_320px]">
        <div className="grid content-start gap-4">
          <Card title="Scenario">
            {scenario ? (
              <div className="grid gap-3 text-[13px]">
                <div>
                  <div className="text-[11px] text-ink-3">task</div>
                  <div>{scenario.task}</div>
                </div>
                <div>
                  <div className="text-[11px] text-ink-3">tests</div>
                  <div className="text-ink-2">{scenario.intent}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Pill tone={toneForSeverity(scenario.severity)}>{scenario.severity}</Pill>
                  <Pill>{scenario.category}</Pill>
                  {scenario.taxonomy?.map((t) => (
                    <Pill key={t} mono>
                      {t}
                    </Pill>
                  ))}
                </div>
                {scenario.compiledFrom && (
                  <Note>
                    Compiled from control <span className="mono">{scenario.compiledFrom.controlId}</span> ({scenario.compiledFrom.controlType}), case <span className="mono">{scenario.compiledFrom.case}</span>.
                  </Note>
                )}
                <div>
                  <div className="text-[11px] text-ink-3">authorized</div>
                  <KV
                    rows={[
                      ["principal", scenario.authorization.principal],
                      ["per payment", money(scenario.authorization.limitPerPayment, scenario.authorization.currency)],
                      ...(scenario.authorization.limitPerDay !== undefined ? ([["per day", money(scenario.authorization.limitPerDay, scenario.authorization.currency)]] as [string, string][]) : []),
                      ["vendors", scenario.authorization.approvedVendors.map((v) => `${v.name} ****${v.accountLast4}`).join("; ")],
                      ["invoices", scenario.authorization.approvedInvoices.map((i) => `${i.invoiceId} ${money(i.amount, scenario!.authorization.currency)}`).join("; ") || "none"],
                    ]}
                  />
                </div>
                {scenario.railEvents?.length ? (
                  <div>
                    <div className="text-[11px] text-ink-3">rail will</div>
                    <div className="mono text-ink-2">{scenario.railEvents.map((e) => e.type).join(", ")}</div>
                  </div>
                ) : null}
                <div>
                  <div className="text-[11px] text-ink-3">why {scenario.expected} is correct</div>
                  <div className="text-ink-2">{scenario.rationale}</div>
                </div>
              </div>
            ) : (
              <Note>{scenarioNote}</Note>
            )}
          </Card>
          {scenario && (
            <Card title="Documents the agent read" aside={`${int(scenario.documents.length)}`}>
              <div className="grid gap-3">
                {scenario.documents.map((d) => (
                  <div key={d.name}>
                    <div className="mb-1 flex items-center gap-2 text-[12px]">
                      <span className="mono">{d.name}</span>
                      <Pill>{d.type}</Pill>
                    </div>
                    <pre className="whitespace-pre-wrap rounded-[var(--radius-sm)] border border-line bg-sunken p-2 text-[12px] leading-snug text-ink-2">{d.text}</pre>
                    {d.hiddenText && (
                      <div className="mt-1">
                        <div className="text-[11px] text-crit-ink">hidden in the file, not visible when rendered</div>
                        <pre className="whitespace-pre-wrap rounded-[var(--radius-sm)] border border-crit/40 bg-crit-soft p-2 text-[12px] leading-snug">{d.hiddenText}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card title="What the agent did" aside={`${int(trace.calls.length)} calls · ${ms(trace.durationMs)}`}>
          {trace.calls.length === 0 ? (
            <Empty>The agent made no tool calls{trace.error ? `: ${trace.error}` : "."}</Empty>
          ) : (
            <ol className="relative grid gap-3 border-l border-line pl-4">
              {trace.calls.map((c) => {
                const findings = seqWithFinding.get(c.seq) ?? [];
                const worstSev = findings.some((f) => f.severity === "critical") ? "critical" : findings.some((f) => f.severity === "high") ? "high" : findings.length ? "medium" : null;
                return (
                  <li key={c.seq} className="relative">
                    <span aria-hidden className={`absolute -left-[21px] top-1.5 h-[10px] w-[10px] rounded-full ring-2 ring-surface ${worstSev === "critical" ? "bg-crit" : worstSev ? "bg-warn" : "bg-accent"}`} />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[11px] tabular text-ink-3">
                        {c.seq}. +{ms(c.elapsedMs)}
                      </span>
                      <span className="mono font-medium">{c.tool}</span>
                      {findings.map((f) => (
                        <Pill key={f.code} tone={toneForSeverity(f.severity)} mono>
                          {f.code}
                        </Pill>
                      ))}
                    </div>
                    <div className="mt-1 grid gap-1 md:grid-cols-2">
                      <Json label="args" value={c.args} />
                      <Json label="result" value={c.result} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="mt-4 border-t border-line pt-3 text-[13px]">
            <div className="text-[11px] text-ink-3">agent&apos;s stated reason (recorded, never trusted)</div>
            <div className="text-ink-2">{trace.declared?.reason ?? trace.error ?? "none given"}</div>
          </div>
          {trace.payments.length > 0 && (
            <div className="mt-3 text-[12px]">
              <div className="text-[11px] text-ink-3">money in the sandbox after this episode</div>
              {trace.payments.map((p) => (
                <div key={p.id} className="tabular">
                  {money(p.amount, p.currency)} to {p.payeeName} ****{p.payeeAccountLast4} for {p.invoiceId}: <Pill tone={p.state === "settled" ? "warn" : "neutral"}>{p.state}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Evaluation" aside={`${int(grade.violations.length)} findings`}>
            <KV
              rows={[
                ["expected", <Pill key="e" tone={toneForVerdict(grade.expected)}>{grade.expected}</Pill>],
                ["did", <Pill key="d" tone={grade.criticalCount > 0 ? "crit" : grade.effective === grade.expected ? "good" : "warn"}>{grade.effective}</Pill>],
                ["completed the task", grade.completedTask ? "yes" : "no"],
                ["recovered", grade.recovered === null ? "no fault to recover from" : grade.recovered ? "yes" : "no"],
                ["paid in sandbox", money(grade.paidAmount ?? 0)],
                ["gate", trace.control.mode === "off" ? "off" : `${trace.control.mode}: ${trace.control.verdicts.join(", ") || "never called"}${trace.control.falseBlock ? " · false block" : ""}`],
              ]}
            />
            {grade.violations.length === 0 ? (
              <p className="mt-3 text-[12px] text-good-ink">✓ No violation. Graded from the calls above, not from the explanation.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {grade.violations.map((v, i) => (
                  <li key={i} className="rounded-[var(--radius-sm)] border border-line p-2 text-[12px]">
                    <div className="mb-1 flex items-center gap-2">
                      <Pill tone={toneForSeverity(v.severity)}>{v.severity}</Pill>
                      <span className="mono">{v.code}</span>
                      {v.evidence && <span className="text-ink-3">from call {v.evidence.seq}</span>}
                    </div>
                    <div className="text-ink-2">{v.detail}</div>
                  </li>
                ))}
              </ul>
            )}
            {unanchored.length > 0 && <p className="mt-2 text-[11px] text-ink-3">Findings without a call number were decided from the episode as a whole.</p>}
          </Card>
          <Note>Every verdict here comes from deterministic graders reading the tool calls. No model decided any of it.</Note>
        </div>
      </div>
    </>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  const text = JSON.stringify(value, null, 1)?.replace(/\n\s*/g, " ") ?? "";
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] text-ink-3">{label}</div>
      <pre className="whitespace-pre-wrap break-all rounded-[var(--radius-sm)] bg-sunken px-2 py-1 text-[11.5px] leading-snug text-ink-2">{text.length > 600 ? `${text.slice(0, 600)}…` : text}</pre>
    </div>
  );
}
