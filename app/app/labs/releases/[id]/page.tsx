import Link from "next/link";
import { gate } from "@/lib/api";
import { safe } from "@/lib/safe";
import { day, int, when } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Card, Empty, Hash, KV, Note, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Release gate" };

export default async function GateDetail(props: PageProps<"/labs/releases/[id]">) {
  const { id } = await props.params;
  const g = await safe(gate(id));
  if (!g) return <Offline />;

  const lists: { title: string; items: string[]; tone: "crit" | "warn" | "good" | "neutral"; note?: string }[] = [
    { title: "New critical violations", items: g.newCriticals, tone: "crit", note: "Money moving on a call that was not the agent's to make. One is enough; there is no acceptable rate, and no override covers it." },
    { title: "Newly failing", items: g.newlyFailing, tone: "warn", note: "Passed at the baseline, does not now." },
    { title: "Axes down by more than the tolerance", items: g.regressions, tone: "warn" },
    { title: "Fixed", items: g.fixed, tone: "good" },
    { title: "New to the suite", items: g.newScenarios, tone: "neutral", note: "Never measured before, so not counted as regressions." },
    { title: "Inconsistent across trials", items: g.flaky, tone: "warn", note: "These make the gate unreliable." },
  ];

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/releases", label: "Releases" }, { label: g.id }]} />
      <PageHeader
        title={
          <>
            {g.agent.name} <span className="mono text-[16px] text-ink-3">v{g.agent.version}</span>
          </>
        }
        subtitle={`${g.suite.id} · ${int(g.suite.scenarioCount)} scenarios × ${g.suite.trials} trials · ${when(g.createdAt)}`}
        actions={
          <>
            <Pill tone={toneForVerdict(g.verdict)}>{g.verdict}</Pill>
            {g.verification && <Pill tone={g.verification.ok ? "good" : "crit"}>{g.verification.ok ? "signature verifies" : "signature broken"}</Pill>}
          </>
        }
      />

      {g.override && (
        <Note>
          Overridden by <span className="font-medium">{g.override.actor}</span> until {day(g.override.expiresAt)}: &ldquo;{g.override.reason}&rdquo;. A failure outside what that override covers would not be covered.
        </Note>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Baseline against now" aside={`baseline written ${day(g.baseline.updatedAt)}${g.baseline.trials !== g.suite.trials ? ` at ${g.baseline.trials} trials, this run ${g.suite.trials}` : ""}`}>
          <table className="w-full">
            <thead>
              <tr>
                <th>axis</th>
                <th className="text-right">baseline</th>
                <th className="text-right">now</th>
                <th className="text-right">change</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(g.axes).map(([axis, v]) => {
                const delta = v.baseline !== null && v.now !== null ? v.now - v.baseline : null;
                return (
                  <tr key={axis}>
                    <td>{axis}</td>
                    <td className="text-right tabular">{v.baseline ?? "–"}</td>
                    <td className="text-right tabular">{v.now ?? "–"}</td>
                    <td className={`text-right tabular ${delta === null ? "text-ink-3" : delta < 0 ? "text-crit-ink" : delta > 0 ? "text-good-ink" : "text-ink-3"}`}>{delta === null ? "–" : delta > 0 ? `+${delta}` : delta}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {g.baseline.fingerprint !== g.suite.fingerprint && <p className="mt-2 text-[12px] text-warn-ink">The suite changed since the baseline was written ({g.baseline.fingerprint} → {g.suite.fingerprint}).</p>}
          <div className="mt-3">
            <KV
              rows={[
                ["run", <Link key="r" href={`/labs/tests/${g.runId}`} className="mono">{g.runId}</Link>],
                ["record", <Hash key="h" value={g.hash} />],
              ]}
            />
          </div>
        </Card>

        <Card title="What changed">
          <div className="grid gap-3">
            {lists.filter((l) => l.items.length > 0).length === 0 && <Empty>Nothing changed against the baseline.</Empty>}
            {lists
              .filter((l) => l.items.length > 0)
              .map((l) => (
                <div key={l.title}>
                  <div className="mb-1 flex items-center gap-2 text-[12px]">
                    <Pill tone={l.tone}>{l.title}</Pill>
                    <span className="text-ink-3">{int(l.items.length)}</span>
                  </div>
                  <ul className="grid gap-0.5 pl-1 text-[13px]">
                    {l.items.map((s) => (
                      <li key={s}>
                        <Link href={`/labs/tests/${g.runId}/scenarios/${s}`} className="mono">
                          {s}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {l.note && <p className="mt-1 text-[11px] text-ink-3">{l.note}</p>}
                </div>
              ))}
          </div>
        </Card>
      </div>
    </>
  );
}
