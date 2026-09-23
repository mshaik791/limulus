import Link from "next/link";
import { gates } from "@/lib/api";
import { safe } from "@/lib/safe";
import { day, int, when } from "@/lib/format";
import { agentDisplay, suiteName } from "@/lib/names";
import { Card, Delta, EmptyState, LinkButton, Metric, Offline, PageHeader, StateBadge } from "@/components/ui";

export const metadata = { title: "Release Gates" };

// Release readiness. The latest gate is the hero: previous against candidate,
// the categories that moved, and a decision card. History follows as compact
// cards. The verdict is regression-based on purpose: "is this worse than what
// we shipped" has no dial to turn.

export default async function Releases() {
  const list = await safe(gates());
  if (!list) return <Offline />;
  const rows = [...list].reverse();
  const g = rows[0];

  return (
    <>
      <PageHeader title="Release Gates" subtitle="Each gate compares a candidate run against the committed baseline and blocks on anything worse." />
      {!g ? (
        <EmptyState title="No gate has run." body="The gate runs in CI or from the CLI against a committed baseline, and seals a record every time." code="node src/bench/ci-gate.ts --scenarios scenarios --agent careful" />
      ) : (
        <>
          <div className="mb-5 grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <Card title="Release readiness" aside={`${suiteName(g.suite.id).name} · ${when(g.createdAt)}`} className="h-full">
                <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr]">
                  <div>
                    <div className="eyebrow">Baseline</div>
                    <div className="mt-1 text-[15px]">
                      {agentDisplay(g.agent.name)} <span className="text-ink-3">· baseline written {day(g.baseline.updatedAt)}</span>
                    </div>
                    <div className="mt-2 text-[44px] font-semibold leading-none tabular tracking-[-0.02em]">{g.axes.safety?.baseline ?? "–"}</div>
                    <div className="text-[12px] text-ink-3">safety at {g.baseline.trials} trials</div>
                  </div>
                  <div className="self-center text-center">
                    <div className="text-[28px] text-ink-3">→</div>
                    <div className="text-[13px]">
                      <Delta value={g.axes.safety?.baseline !== null && g.axes.safety?.now !== null ? g.axes.safety.now - g.axes.safety.baseline : null} />
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow">Candidate</div>
                    <div className="mt-1 text-[15px]">
                      {agentDisplay(g.agent.name)} <span className="text-ink-3">v{g.agent.version}</span>
                    </div>
                    <div className={`mt-2 text-[44px] font-semibold leading-none tabular tracking-[-0.02em] ${g.verdict === "fail" ? "text-crit-ink" : g.verdict === "pass" ? "text-good-ink" : "text-warn-ink"}`}>{g.axes.safety?.now ?? "–"}</div>
                    <div className="text-[12px] text-ink-3">safety at {g.suite.trials} trials</div>
                  </div>
                </div>
                <div className="mt-6 grid gap-x-8 gap-y-2 border-t border-line pt-4 md:grid-cols-2">
                  {Object.entries(g.axes).map(([axis, v]) => (
                    <div key={axis} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="capitalize text-ink-2">{axis}</span>
                      <span className="tabular">
                        {v.baseline ?? "–"} → {v.now ?? "–"} <Delta value={v.baseline !== null && v.now !== null ? v.now - v.baseline : null} />
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div className="xl:col-span-4">
              <Card emphasis={g.verdict === "fail" ? "crit" : g.verdict === "pass" ? "good" : "warn"} className="h-full">
                <div className="eyebrow">Decision</div>
                <div className="mt-2">
                  <StateBadge state={g.verdict === "pass" ? "READY" : g.verdict === "fail" ? "BLOCKED" : "OVERRIDDEN"} label={g.verdict === "pass" ? "READY FOR DEPLOYMENT" : g.verdict === "fail" ? "DEPLOYMENT BLOCKED" : "FAILED, OVERRIDDEN"} size="lg" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Metric label="New critical" value={int(g.newCriticals.length)} tone={g.newCriticals.length ? "crit" : "neutral"} />
                  <Metric label="Newly failing" value={int(g.newlyFailing.length)} tone={g.newlyFailing.length ? "warn" : "neutral"} />
                </div>
                <p className="mt-3 text-[13px] text-ink-2">
                  {g.verdict === "pass"
                    ? "Nothing worse than the committed baseline."
                    : g.newCriticals.length
                      ? `Reason: ${int(g.newCriticals.length)} new critical violation(s): ${g.newCriticals.slice(0, 2).join(", ")}.`
                      : g.newlyFailing.length
                        ? `Reason: ${g.newlyFailing.slice(0, 2).join(", ")} stopped passing.`
                        : `Reason: ${g.regressions.join(", ")} fell by more than the tolerance.`}
                  {g.override && ` Overridden by ${g.override.actor} until ${day(g.override.expiresAt)}.`}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <LinkButton href={`/labs/tests/${g.runId}?tab=failures`} tone={g.verdict === "fail" ? "crit" : "neutral"}>
                    Review Failures
                  </LinkButton>
                  <LinkButton href="/labs">Rerun</LinkButton>
                  <LinkButton href={`/labs/releases/${g.id}`}>{g.verdict === "fail" ? "Override Gate" : "Open"}</LinkButton>
                </div>
                {g.verdict === "fail" && <p className="mt-2 text-[11.5px] text-ink-3">An override is a signed, expiring record written next to the baseline with an author and a reason. It never covers a new critical violation.</p>}
              </Card>
            </div>
          </div>

          <Card title="Release history" aside={`${int(rows.length)} gate run(s)`} padded={false}>
            <ol>
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-4 border-b border-line px-6 py-3 last:border-0 hover:bg-surface-2">
                  <StateBadge state={r.verdict === "pass" ? "READY" : r.verdict === "fail" ? "BLOCKED" : "OVERRIDDEN"} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/labs/releases/${r.id}`} className="text-[13px] font-medium">
                      {agentDisplay(r.agent.name)} <span className="font-normal text-ink-3">v{r.agent.version}</span>
                    </Link>
                    <div className="truncate text-[12px] text-ink-3" title={r.suite.id}>
                      {when(r.createdAt)} · {suiteName(r.suite.id).name} · {int(r.suite.scenarioCount)} × {r.suite.trials}
                      {r.override ? ` · overridden by ${r.override.actor}` : ""}
                    </div>
                  </div>
                  <div className="hidden text-[12px] tabular text-ink-2 md:block">
                    safety {r.axes.safety?.baseline ?? "–"} → {r.axes.safety?.now ?? "–"}
                  </div>
                  <div className={`w-[90px] text-right text-[12px] tabular ${r.newCriticals.length ? "text-crit-ink" : "text-ink-3"}`}>{int(r.newCriticals.length)} critical</div>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </>
  );
}
