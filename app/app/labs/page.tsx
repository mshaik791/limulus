import Link from "next/link";
import { compares, gates, labRuns, qualifications, shadowSummary } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, ofN, when } from "@/lib/format";
import { AxesBars, Sparkline } from "@/components/charts";
import { Card, Empty, Offline, PageHeader, Pill, SandboxBar, Stat, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Labs" };

// The overview answers one question: how do our agents stand before
// deployment, and what needs attention. Every tile is a count from a signed
// record and links to the list it was counted from. Nothing here is a score
// without its n, and nothing is a recommendation the API cannot act on.

export default async function LabsOverview() {
  const [runs, cmp, gt, quals, shadow] = await Promise.all([safe(labRuns()), safe(compares()), safe(gates()), safe(qualifications()), safe(shadowSummary())]);
  if (!runs) return <Offline />;

  const latestByAgent = new Map<string, (typeof runs)[number]>();
  for (const r of runs) latestByAgent.set(`${r.agent.name}@${r.agent.version}`, r);
  const latest = runs.at(-1);
  const latestGate = gt?.at(-1);
  const latestCompare = cmp?.at(-1);
  const validQuals = (quals ?? []).filter((q) => q.state === "valid");
  const criticalsLatest = [...latestByAgent.values()].reduce((n, r) => n + r.axes.criticalViolations.length, 0);
  const wrongfulLatest = [...latestByAgent.values()].reduce((n, r) => n + r.controls.simulatedWrongfulAmount, 0);
  const disagreements = shadow ? shadow.wouldHaveHeld.value + shadow.wouldHaveEscalated.value + shadow.wouldHaveReleased.value : 0;

  const actions: { text: string; href: string; tone: "crit" | "warn" | "neutral" }[] = [];
  if (latestGate?.verdict === "fail") actions.push({ text: `The latest release gate failed for ${latestGate.agent.name}. Review the failures.`, href: `/labs/releases/${latestGate.id}`, tone: "crit" });
  if (criticalsLatest > 0) actions.push({ text: `${int(criticalsLatest)} critical violation(s) in the latest run per agent. Open the traces.`, href: "/labs/tests", tone: "crit" });
  if (shadow && shadow.reviewed.of - (shadow.reviewed.falsePositives + shadow.reviewed.confirmed + shadow.reviewed.unsure) > 0) {
    actions.push({ text: `${int(shadow.reviewed.of - (shadow.reviewed.falsePositives + shadow.reviewed.confirmed + shadow.reviewed.unsure))} shadow disagreement(s) await a person's review.`, href: "/production", tone: "warn" });
  }
  if (!latestCompare) actions.push({ text: "No comparison has been run. Put two configurations on the same scenarios.", href: "/labs/arena", tone: "neutral" });
  if (validQuals.length === 0) actions.push({ text: "No qualification is in force. Nothing is cleared for autonomous payments.", href: "/labs/qualifications", tone: "neutral" });

  return (
    <>
      <PageHeader title="Labs" subtitle="Before deployment: what the agents did in the simulated world, from signed run records." />
      <SandboxBar />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Agents tested" value={int(latestByAgent.size)} sub={`${int(runs.length)} runs on record`} href="/labs/tests" />
        <Stat label="Critical violations, latest run per agent" value={int(criticalsLatest)} tone={criticalsLatest > 0 ? "crit" : "good"} sub="attempted; money moved only in the sandbox" href="/labs/tests" />
        <Stat label="Simulated wrongful amount" value={money(wrongfulLatest)} tone={wrongfulLatest > 0 ? "warn" : "neutral"} sub="latest run per agent, simulated" href="/labs/tests" />
        <Stat
          label="Latest release gate"
          value={latestGate ? <Pill tone={toneForVerdict(latestGate.verdict)}>{latestGate.verdict}</Pill> : "none"}
          sub={latestGate ? `${latestGate.agent.name} · ${ago(latestGate.createdAt)}` : "no gate has run"}
          href="/labs/releases"
        />
        <Stat label="Qualifications in force" value={int(validQuals.length)} sub={`${int((quals ?? []).length)} issued in total`} href="/labs/qualifications" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Latest run" aside={latest ? <Link href={`/labs/tests/${latest.id}`}>open →</Link> : undefined}>
          {latest ? (
            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{latest.agent.name}</span>
                  <span className="mono text-ink-3">v{latest.agent.version}</span>
                  <Pill tone="accent">{latest.axes.level}</Pill>
                  <Pill tone={latest.controls.mode === "enforced" ? "good" : "neutral"}>gate {latest.controls.mode}</Pill>
                </div>
                <AxesBars axes={latest.axes} />
                <p className="mt-3 text-[12px] text-ink-3">{latest.axes.levelReason}</p>
              </div>
              <div className="text-[12px] text-ink-3">
                <div>
                  suite <span className="mono text-ink-2">{latest.suite.id}</span>
                </div>
                <div>
                  {int(latest.suite.scenarioCount)} scenarios × {latest.suite.trials} trials
                </div>
                <div>{when(latest.createdAt)}</div>
                <div className="mt-2">
                  critical violations <span className={latest.axes.criticalViolations.length ? "text-crit-ink" : "text-ink-2"}>{int(latest.axes.criticalViolations.length)}</span>
                </div>
                <div>
                  simulated wrongful <span className="text-ink-2">{money(latest.controls.simulatedWrongfulAmount)}</span>
                </div>
              </div>
            </div>
          ) : (
            <Empty>
              No runs yet. <code className="mono">node src/lab-cli.ts run careful 3</code>
            </Empty>
          )}
        </Card>

        <Card title="Needs attention">
          {actions.length === 0 ? (
            <Empty>Nothing waiting on a person.</Empty>
          ) : (
            <ul className="grid gap-2">
              {actions.map((a) => (
                <li key={a.href + a.text}>
                  <Link href={a.href} className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-line px-3 py-2 text-[13px] hover:border-line-strong">
                    <Pill tone={a.tone}>{a.tone === "crit" ? "act" : a.tone === "warn" ? "review" : "next"}</Pill>
                    <span>{a.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Safety by agent, across runs" aside="score per run, latest right">
          {latestByAgent.size === 0 ? (
            <Empty>No runs.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>agent</th>
                  <th>runs</th>
                  <th>trend</th>
                  <th className="text-right">latest safety</th>
                  <th className="text-right">criticals</th>
                </tr>
              </thead>
              <tbody>
                {[...latestByAgent.values()].map((r) => {
                  const series = runs.filter((x) => x.agent.name === r.agent.name && x.agent.version === r.agent.version).map((x) => x.axes.safety.score);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/labs/tests/${r.id}`}>{r.agent.name}</Link> <span className="mono text-ink-3">v{r.agent.version}</span>
                      </td>
                      <td className="tabular">{int(series.length)}</td>
                      <td>
                        <Sparkline values={series.slice(-12)} />
                      </td>
                      <td className="text-right tabular">
                        {r.axes.safety.score} <span className="text-ink-3">n={int(r.axes.safety.sampleSize)}</span>
                      </td>
                      <td className={`text-right tabular ${r.axes.criticalViolations.length ? "text-crit-ink" : ""}`}>{int(r.axes.criticalViolations.length)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Shadow mode" aside={shadow ? <Link href="/production">open →</Link> : undefined}>
          {!shadow || shadow.evaluated === 0 ? (
            <Empty>No production decisions have been sent to shadow mode.</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <div className="text-ink-3">evaluated</div>
                <div className="text-[20px] font-semibold">{int(shadow.evaluated)}</div>
              </div>
              <div>
                <div className="text-ink-3">agreed</div>
                <div className="text-[20px] font-semibold">{ofN(shadow.agreed.value, shadow.agreed.of)}</div>
              </div>
              <div>
                <div className="text-ink-3">would have held or escalated</div>
                <div className="text-[20px] font-semibold text-warn-ink">{ofN(shadow.wouldHaveHeld.value + shadow.wouldHaveEscalated.value, shadow.evaluated)}</div>
              </div>
              <div>
                <div className="text-ink-3">exposure we would have stopped</div>
                <div className="text-[20px] font-semibold">{money(shadow.exposureWeWouldHaveStopped.amount, shadow.exposureWeWouldHaveStopped.currency ?? "USD")}</div>
                <div className="text-[11px] text-ink-3">{int(shadow.exposureWeWouldHaveStopped.payments)} payment(s), released by the customer&apos;s system</div>
              </div>
              <div className="col-span-2 text-[11px] text-ink-3">{int(disagreements)} disagreement(s) in total</div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
