import Link from "next/link";
import { gate } from "@/lib/api";
import { safe } from "@/lib/safe";
import { day, int, when } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Card, Delta, EmptyState, Hash, KV, LinkButton, Note, Offline, PageHeader, Pill, StateBadge } from "@/components/ui";

export const metadata = { title: "Release Gate" };

export default async function GateDetail(props: PageProps<"/labs/releases/[id]">) {
  const { id } = await props.params;
  const g = await safe(gate(id));
  if (!g) return <Offline />;

  const lists: { title: string; items: string[]; tone: "crit" | "warn" | "good" | "neutral"; note?: string }[] = [
    { title: "New critical violations", items: g.newCriticals, tone: "crit", note: "Money moving on a call that was not the agent's to make. One is enough; there is no acceptable rate and no override covers it." },
    { title: "Newly failing", items: g.newlyFailing, tone: "warn", note: "Passed at the baseline, does not now." },
    { title: "Axes down by more than the tolerance", items: g.regressions, tone: "warn" },
    { title: "Fixed", items: g.fixed, tone: "good" },
    { title: "New to the suite", items: g.newScenarios, tone: "neutral", note: "Never measured before, so not counted as regressions." },
    { title: "Inconsistent across trials", items: g.flaky, tone: "warn", note: "These make the gate unreliable." },
  ];
  const overridable = g.verdict === "fail" && g.newCriticals.length === 0;

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/releases", label: "Release Gates" }, { label: g.id }]} />
      <PageHeader
        eyebrow={`Release gate · ${when(g.createdAt)}`}
        title={
          <>
            {g.agent.name} <span className="mono text-[18px] text-ink-3">v{g.agent.version}</span>
          </>
        }
        subtitle={`${g.suite.id} · ${int(g.suite.scenarioCount)} scenarios × ${g.suite.trials} trials · baseline written ${day(g.baseline.updatedAt)}`}
        actions={
          <>
            <StateBadge state={g.verdict === "pass" ? "READY" : g.verdict === "fail" ? "BLOCKED" : "OVERRIDDEN"} label={g.verdict === "pass" ? "READY" : g.verdict === "fail" ? "DEPLOYMENT BLOCKED" : "FAILED, OVERRIDDEN"} size="lg" />
            {g.verification && <Pill tone={g.verification.ok ? "good" : "crit"}>{g.verification.ok ? "signature verifies" : "signature broken"}</Pill>}
          </>
        }
      />

      {g.override && (
        <Note tone="warn">
          Overridden by <span className="font-medium">{g.override.actor}</span> until {day(g.override.expiresAt)}: &ldquo;{g.override.reason}&rdquo;. A failure outside what that override covers is not covered.
        </Note>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Previous against candidate" aside={g.baseline.trials !== g.suite.trials ? `baseline at ${g.baseline.trials} trials, this run ${g.suite.trials}` : undefined} padded={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="pl-5">axis</th>
                <th className="text-right">previous</th>
                <th className="text-right">candidate</th>
                <th className="pr-5 text-right">change</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(g.axes).map(([axis, v]) => (
                <tr key={axis}>
                  <td className="pl-5">{axis}</td>
                  <td className="text-right tabular">{v.baseline ?? "–"}</td>
                  <td className="text-right tabular">{v.now ?? "–"}</td>
                  <td className="pr-5 text-right">
                    <Delta value={v.baseline !== null && v.now !== null ? v.now - v.baseline : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-4">
            {g.baseline.fingerprint !== g.suite.fingerprint && <p className="mb-2 text-[12px] text-warn-ink">The suite changed since the baseline was written ({g.baseline.fingerprint} → {g.suite.fingerprint}).</p>}
            <KV
              dense
              rows={[
                ["run", <Link key="r" href={`/labs/tests/${g.runId}`} className="mono">{g.runId}</Link>],
                ["record", <Hash key="h" value={g.hash} />],
              ]}
            />
          </div>
        </Card>

        <Card title="What changed">
          <div className="grid gap-4">
            {lists.filter((l) => l.items.length > 0).length === 0 && <EmptyState title="Nothing changed against the baseline." />}
            {lists
              .filter((l) => l.items.length > 0)
              .map((l) => (
                <div key={l.title}>
                  <div className="mb-1.5 flex items-center gap-2 text-[12px]">
                    <Pill tone={l.tone}>{l.title}</Pill>
                    <span className="text-ink-3">{int(l.items.length)}</span>
                  </div>
                  <ul className="grid gap-0.5 text-[13px]">
                    {l.items.map((s) => (
                      <li key={s}>
                        <Link href={`/labs/tests/${g.runId}/scenarios/${s}`} className="mono">
                          {s}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {l.note && <p className="mt-1 text-[11.5px] text-ink-3">{l.note}</p>}
                </div>
              ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Next">
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/labs/tests/${g.runId}?tab=failures`} tone={g.verdict === "fail" ? "crit" : "neutral"}>
              Review Failures
            </LinkButton>
            <LinkButton href="/labs">Rerun</LinkButton>
          </div>
        </Card>
        <Card title="Override" emphasis={overridable ? "warn" : undefined}>
          {g.verdict !== "fail" ? (
            <p className="text-[13px] text-ink-3">Nothing to override.</p>
          ) : !overridable ? (
            <p className="text-[13px] text-crit-ink">This gate cannot be overridden: it found new critical violations. Fix them, or update the baseline in a commit that says why.</p>
          ) : (
            <>
              <p className="text-[13px] text-ink-2">An override is a person accepting exactly these failures for a stated reason. It is written next to the baseline, so the reason is in git with an author; it expires in 14 days, is void if edited, and covers nothing that appears later.</p>
              <pre className="mono mt-3 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11px] leading-relaxed text-ink-2">{`node src/bench/ci-gate.ts override --scenarios ${g.suite.id.replace(/^files:/, "")} \\
  --agent <agent> --actor "<your name>" \\
  --reason "<why these failures are accepted, in a sentence>"`}</pre>
              <p className="mt-2 text-[11.5px] text-ink-3">There is no button for this on purpose. The command commits the reason with the code.</p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
