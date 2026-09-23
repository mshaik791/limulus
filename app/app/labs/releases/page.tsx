import Link from "next/link";
import { gates } from "@/lib/api";
import { safe } from "@/lib/safe";
import { day, int, when } from "@/lib/format";
import { Card, Delta, EmptyState, LinkButton, Metric, Offline, PageHeader, StateBadge } from "@/components/ui";

export const metadata = { title: "Release Gates" };

// Each gate compares a candidate run against the committed baseline. The
// verdict is regression-based on purpose: a threshold gets tuned down to
// unblock a release; "is this worse than what we shipped" has no dial.

export default async function Releases() {
  const list = await safe(gates());
  if (!list) return <Offline />;
  const rows = [...list].reverse();

  return (
    <>
      <PageHeader title="Release Gates" subtitle="Every run of the regression gate. Blocked on a new critical violation, a scenario that stopped passing, or an axis that fell by more than the tolerance." />
      {rows.length === 0 ? (
        <EmptyState title="No gate has run." body="The gate runs in CI or from the CLI against a committed baseline, and seals a record every time." code="node src/bench/ci-gate.ts --scenarios scenarios --agent careful" />
      ) : (
        <div className="grid gap-3">
          {rows.map((g) => {
            const worst = Object.entries(g.axes)
              .map(([axis, v]) => ({ axis, delta: v.baseline !== null && v.now !== null ? v.now - v.baseline : null }))
              .filter((x) => x.delta !== null && x.delta < 0)
              .sort((a, b) => a.delta! - b.delta!)
              .slice(0, 2);
            return (
              <Card key={g.id} emphasis={g.verdict === "fail" ? "crit" : g.verdict === "pass" ? "good" : "warn"}>
                <div className="grid gap-5 lg:grid-cols-[1.2fr_2fr_auto]">
                  <div>
                    <div className="flex items-center gap-3">
                      <StateBadge state={g.verdict === "pass" ? "READY" : g.verdict === "fail" ? "BLOCKED" : "OVERRIDDEN"} label={g.verdict === "pass" ? "READY" : g.verdict === "fail" ? "DEPLOYMENT BLOCKED" : "OVERRIDDEN"} />
                    </div>
                    <div className="mt-2 text-[16px] font-semibold">
                      {g.agent.name} <span className="mono text-[13px] text-ink-3">v{g.agent.version}</span>
                    </div>
                    <div className="text-[12px] text-ink-3">
                      {when(g.createdAt)} · <span className="mono inline-block max-w-[260px] truncate align-bottom" title={g.suite.id}>{g.suite.id}</span> · {int(g.suite.scenarioCount)} × {g.suite.trials}
                    </div>
                    {g.override && <div className="mt-1 text-[12px] text-warn-ink">Overridden by {g.override.actor} until {day(g.override.expiresAt)}</div>}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                    <Metric label="Baseline safety" value={g.axes.safety?.baseline ?? "–"} sub={`written ${day(g.baseline.updatedAt)}`} />
                    <Metric label="Candidate safety" value={g.axes.safety?.now ?? "–"} sub={<Delta value={g.axes.safety?.baseline !== null && g.axes.safety?.now !== null ? g.axes.safety.now - g.axes.safety.baseline : null} />} />
                    <Metric label="New critical" value={int(g.newCriticals.length)} tone={g.newCriticals.length ? "crit" : "neutral"} />
                    <Metric label="Newly failing" value={int(g.newlyFailing.length)} tone={g.newlyFailing.length ? "warn" : "neutral"} sub={g.fixed.length ? `${int(g.fixed.length)} fixed` : undefined} />
                    {worst.length > 0 && (
                      <div className="col-span-2 text-[12.5px] md:col-span-4">
                        {worst.map((w) => (
                          <span key={w.axis} className="mr-4">
                            <span className="text-ink-3">{w.axis}</span> {g.axes[w.axis].baseline} → {g.axes[w.axis].now}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-2">
                    <LinkButton href={`/labs/releases/${g.id}`} tone={g.verdict === "fail" ? "crit" : "neutral"}>
                      {g.verdict === "fail" ? "Review Failures" : "Open"}
                    </LinkButton>
                    <Link href={`/labs/tests/${g.runId}`} className="text-[12px] text-ink-3">
                      the run →
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
