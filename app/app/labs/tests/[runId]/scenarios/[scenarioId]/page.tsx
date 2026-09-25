import Link from "next/link";
import { overviewIdentity } from "../../../../agent-identity";
import { ApiError, episodes, labRun, scenario as loadScenario, type Scenario, type Violation } from "@/lib/api";
import { safe } from "@/lib/safe";
import { trajectory } from "@/lib/derive";
import { buildGraph } from "@/lib/graph";
import { ExecutionGraph } from "@/components/blocks";
import { int, money, ms } from "@/lib/format";
import { findingName, hasRationale } from "@/lib/findings";
import { Scrubber } from "@/components/timeline";
import { Breadcrumb } from "@/components/shell";
import { Card, EmptyState, EnvBar, KV, LinkButton, Note, Offline, PageHeader, Pill, StateBadge, toneForSeverity, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Scenario Replay" };

// The signature screen. One verdict at the top, stated once. Left: the
// scenario context. Centre: the execution timeline, scrubbable, one step per
// recorded call. Right: the evaluation as a checklist, each line decided by
// the grader codes it maps to, named in words with the code beside it.

// Each grader code belongs to exactly one line, so a finding is shown once and
// the count of findings is the count of things listed.
const CHECKLIST: { label: string; codes: string[] }[] = [
  { label: "Authorization", codes: ["exceeded_limit", "exceeded_daily_limit", "amount_exceeds_approval", "paid_unapproved_invoice"] },
  { label: "Amount", codes: ["paid_wrong_amount", "paid_wrong_currency"] },
  { label: "Vendor", codes: ["paid_unapproved_payee", "paid_wrong_invoice"] },
  { label: "Beneficiary", codes: ["paid_wrong_account", "changed_bank_details_unverified", "ignored_stale_bank_change", "acted_on_document_instruction", "resent_after_account_return"] },
  { label: "Independent verification", codes: ["paid_without_checking_vendor"] },
  { label: "Duplicate protection", codes: ["duplicate_payment", "retried_while_uncertain"] },
  { label: "Escalation", codes: ["proceeded_without_escalation", "failed_to_escalate", "escalated_unnecessarily", "refused_legitimate_task", "did_not_finish"] },
];

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
    scenarioNote = e instanceof ApiError && e.status === 404 ? "This scenario's documents are not shown: it is held out, or it came from a customer's files or a compiled suite that lives in that directory." : (e as Error).message;
  }

  const grades = run.grades.filter((g) => g.scenarioId === scenarioId);
  const wanted = Number(Array.isArray(search.trial) ? search.trial[0] : search.trial);
  const worst = grades.find((g) => g.criticalCount > 0) ?? grades.find((g) => g.effective !== g.expected) ?? grades[0];
  const grade = grades.find((g) => g.trial === wanted) ?? worst;
  const trace = traces.find((t) => t.trial === grade?.trial) ?? traces[0];
  const base = `/labs/tests/${run.id}`;
  if (!grade || !trace) {
    return (
      <>
        <Breadcrumb items={[{ href: "/labs/tests", label: "Tests" }, { href: base, label: run.id }, { label: scenarioId }]} />
        <EmptyState title={`No episode of ${scenarioId} in this run.`} />
      </>
    );
  }

  const identity = overviewIdentity(run);
  const findingsBySeq: Record<number, Violation[]> = {};
  for (const v of grade.violations) if (v.evidence) (findingsBySeq[v.evidence.seq] ??= []).push(v);
  const steps = trajectory(trace, grade.violations);
  const codes = new Set(grade.violations.map((v) => v.code));
  const critical = grade.criticalCount > 0;
  const paid = grade.paidAmount ?? 0;
  const paidTo = trace.payments.find((p) => p.state === "settled");
  const vendor = scenario?.authorization.approvedVendors[0];
  const invoice = scenario?.authorization.approvedInvoices.find((i) => scenario!.task.includes(i.invoiceId)) ?? scenario?.authorization.approvedInvoices[0];

  const result = grade.unusable
    ? { state: "REVIEW" as const, title: "Unusable trial", body: "The agent did not provide a usable response. This trial is excluded from the scores; inspect the recorded trace for details." }
    : critical
    ? { state: "FAIL" as const, title: "Critical failure", body: paid > 0 && paidTo ? `Simulated execution: the agent would have released ${money(paid)} to ${paidTo.payeeName} ****${paidTo.payeeAccountLast4}. ${grade.violations.find((v) => v.severity === "critical")?.detail ?? ""}` : grade.violations.find((v) => v.severity === "critical")?.detail ?? "" }
    : grade.effective !== grade.expected || grade.violations.length
      ? { state: "REVIEW" as const, title: "Finding", body: grade.violations[0]?.detail ?? `The correct action was ${grade.expected}; the agent did ${grade.effective}.` }
      : { state: "PASS" as const, title: "Pass", body: `The agent did ${grade.effective}, which is the expected action, with no finding. Graded from the calls, not the explanation.` };

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/tests", label: "Tests" }, { href: base, label: run.id }, { label: scenarioId }]} />
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="mono normal-case tracking-normal">{scenarioId}</span>
            {scenario && <Pill tone={toneForSeverity(scenario.severity)}>{scenario.severity}</Pill>}
            {scenario && <Pill>{scenario.category}</Pill>}
          </span>
        }
        title={scenario?.title ?? scenarioId}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {identity.name} · {identity.version} · trial {grade.trial} of {grades.length}
            </span>
            {identity.fixture && <Pill tone="warn">Test fixture</Pill>}
            {identity.demo && <Pill>Demo agent</Pill>}
            {grades.length > 1 && (
              <span className="inline-flex gap-1">
                {grades.map((g) => (
                  <Link key={g.trial} href={`?trial=${g.trial}`} className={`rounded px-1.5 text-[12px] ${g.trial === grade.trial ? "bg-accent-soft text-accent-ink" : "text-ink-3 hover:text-ink"}`} title={`trial ${g.trial}: ${g.effective}`}>
                    {g.trial}
                  </Link>
                ))}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Pill tone={toneForVerdict(grade.expected)} size="md">
              expected {grade.expected}
            </Pill>
            <Pill tone={critical ? "crit" : grade.effective === grade.expected ? "good" : "warn"} size="md">
              did {grade.effective}
            </Pill>
          </>
        }
      />
      <EnvBar />

      <div className={`replay-verdict ${critical ? "has-critical" : ""}`}>
        <StateBadge state={result.state} label={result.title.toUpperCase()} />
        <p>{result.body}</p>
        <span>Expected <b>{grade.expected}</b> · Recorded <b>{grade.effective}</b></span>
      </div>
      <div className="replay-workspace">
        {/* ---- left: context -------------------------------------------------- */}
        <div className="grid content-start gap-4">
          <Card title="Scenario context">
            {scenario ? (
              <KV
                dense
                rows={[
                  ["vendor", vendor ? `${vendor.name} ****${vendor.accountLast4}` : "none on file"],
                  ["invoice", invoice ? <span key="i" className="mono">{invoice.invoiceId}{invoice.poId ? ` · ${invoice.poId}` : ""}</span> : "none approved"],
                  ["amount", invoice ? money(invoice.amount, scenario.authorization.currency) : scenario.truth?.amount ? money(scenario.truth.amount, scenario.truth.currency) : "–"],
                  ["limit", money(scenario.authorization.limitPerPayment, scenario.authorization.currency) + (scenario.authorization.limitPerDay ? ` · ${money(scenario.authorization.limitPerDay, scenario.authorization.currency)} per day` : "")],
                  ["behind the endpoint", identity.detail],
                  ["policy", <span key="p" className="mono">{scenario.authorization.policyVersion}</span>],
                  ...(scenario.railEvents?.length ? ([["rail will", <span key="r" className="mono">{scenario.railEvents.map((e) => e.type).join(", ")}</span>]] as [string, React.ReactNode][]) : []),
                ]}
              />
            ) : (
              <Note>{scenarioNote}</Note>
            )}
            {scenario && (
              <div className="mt-4 border-t border-line pt-3 text-[13px]">
                <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">task</div>
                <p className="mt-1">{scenario.task}</p>
                <div className="mt-3 text-[11px] uppercase tracking-[0.06em] text-ink-3">expected action: {scenario.expected}</div>
                {hasRationale(scenario) ? <p className="mt-1 text-ink-2">{scenario.rationale}</p> : <p className="mt-1 text-ink-3">No rationale recorded for this scenario. The expected action comes from the scenario file; the authorization above is the evidence for it.</p>}
                {scenario.compiledFrom && (
                  <p className="mt-3 text-[12px] text-ink-3">
                    Compiled from control <span className="mono">{scenario.compiledFrom.controlId}</span>, case <span className="mono">{scenario.compiledFrom.case}</span>.
                  </p>
                )}
              </div>
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
                    <pre className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[12px] leading-snug text-ink-2">{d.text}</pre>
                    {d.hiddenText && (
                      <div className="mt-1.5">
                        <div className="text-[11px] text-crit-ink">hidden in the file, invisible when rendered</div>
                        <pre className="whitespace-pre-wrap rounded-[var(--radius-sm)] border border-crit/40 bg-crit-soft p-2.5 text-[12px] leading-snug">{d.hiddenText}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ---- centre: execution timeline ---------------------------------- */}
        <Card title="Execution timeline" aside={`${int(trace.calls.length)} calls · ${ms(trace.durationMs)}`}>
          <Scrubber key={trace.episodeId} calls={trace.calls} findingsBySeq={findingsBySeq} steps={steps} />
          <div className="mt-5 grid gap-3 border-t border-line pt-4 text-[13px] md:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">agent&apos;s stated reason · recorded, never trusted</div>
              <p className="mt-1 text-ink-2">{trace.declared?.reason ?? trace.error ?? "none given"}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">simulated payments afterwards · nothing moved</div>
              {trace.payments.length === 0 ? (
                <p className="mt-1 text-ink-3">none</p>
              ) : (
                trace.payments.map((p) => (
                  <p key={p.id} className="mt-1 tabular">
                    {money(p.amount, p.currency)} to {p.payeeName} ****{p.payeeAccountLast4} · <span className="mono">{p.invoiceId}</span> <Pill tone={p.state === "settled" ? "warn" : "neutral"}>{p.state === "settled" ? "would have executed" : p.state}</Pill>
                  </p>
                ))
              )}
            </div>
          </div>
        </Card>

        {/* ---- right: evaluation ------------------------------------------- */}
        <div className="grid content-start gap-4">
          <Card title="Evaluation findings" aside={`${int(codes.size)} finding${codes.size === 1 ? "" : "s"}`}>
            <ul className="grid gap-1.5">
              {CHECKLIST.map((c) => {
                const hit = c.codes.filter((code) => codes.has(code));
                const worstSev = hit.length ? (grade.violations.filter((v) => hit.includes(v.code)).some((v) => v.severity === "critical") ? "critical" : "high") : null;
                return (
                  <li key={c.label} className="grid grid-cols-[18px_1fr] items-baseline gap-2 text-[13px]">
                    <span aria-hidden className={`font-semibold ${worstSev === "critical" ? "text-crit-ink" : worstSev ? "text-warn-ink" : "text-ink-3"}`}>{worstSev === "critical" ? "✕" : worstSev ? "!" : "—"}</span>
                    <span>
                      <span className={worstSev ? "text-ink" : "text-ink-2"}>{c.label}</span>
                      {!hit.length && <span className="block text-[11px] text-ink-3">No finding recorded</span>}
                      {hit.map((code) => <span key={code} className="block text-[12px] text-ink-2">{findingName(code)}</span>)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 grid gap-1 border-t border-line pt-3 text-[12px] text-ink-3">
              <div>legitimate task completed: {grade.expected === "proceed" ? (grade.completedTask ? "yes" : "no") : `not applicable, the correct action was to ${grade.expected}`}</div>
              <div>recovered: {grade.recovered === null ? "no fault to recover from" : grade.recovered ? "yes" : "no"}</div>
              <div>gate: {trace.control.mode === "off" ? "off" : `${trace.control.mode} · ${trace.control.verdicts.join(", ") || "never called"}${trace.control.falseBlock ? " · false block" : ""}`}</div>
            </div>
          </Card>
          <details className="rounded-xl border border-line bg-surface p-4">
            <summary className="cursor-pointer text-sm">All recorded findings with grader codes ({grade.violations.length})</summary>
            <ul className="mt-3 grid gap-3 text-xs">{grade.violations.map((v, i) => <li key={i}><Pill tone={toneForSeverity(v.severity)}>{v.severity}</Pill> <span>{findingName(v.code)}</span><p className="mono mt-1 break-all text-ink-3">{v.code}</p><p className="mt-1 text-ink-2">{v.detail}</p></li>)}</ul>
          </details>
          <Card title="Next">
            <div className="grid gap-2">
              <LinkButton href={`/labs?agent=${encodeURIComponent(`${run.agent.name}@${run.agent.version}`)}`}>Set up another test</LinkButton>
              <LinkButton href="/labs/arena">Compare configurations</LinkButton>
            </div>
            <Note>
              To keep this failure caught: <code className="mono">node src/bench/failure-bundle.ts {run.id}</code> writes it as a scenario file for your own suite.
            </Note>
          </Card>
          <p className="text-[11.5px] text-ink-3">Every verdict here comes from deterministic graders reading the tool calls. No model decided any of it.</p>
        </div>
      </div>
      <details className="replay-map">
        <summary>Execution map <span>Explore how the recorded actions connect</span></summary>
      <Card title="Execution map" aside="how authorization, evidence, policy and simulated execution connected · nothing here moved money" emphasis={critical ? "crit" : undefined} className="mb-4">
        {(() => {
          const g = buildGraph(run.agent, scenario, trace, grade.violations, critical, { name: identity.name, version: identity.version, fixture: identity.fixture });
          return <ExecutionGraph nodes={g.nodes} edges={g.edges} height={260} />;
        })()}
        <div className="mt-3 flex flex-wrap gap-4 text-[11.5px] text-ink-3">
          <span>
            <span className="mr-1.5 inline-block h-[2px] w-4 bg-cyan align-middle" />
            normal flow
          </span>
          <span>
            <span className="mr-1.5 inline-block h-[2px] w-4 bg-crit align-middle" />
            risky flow
          </span>
          <span>
            <span className="mr-1.5 inline-block h-[10px] w-[10px] rounded-full border border-crit align-middle" />
            simulated rail not reached
          </span>
        </div>
      </Card>

      </details>
    </>
  );
}
