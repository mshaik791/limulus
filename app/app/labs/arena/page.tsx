import Link from "next/link";
import { compares, referenceAgents } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, when } from "@/lib/format";
import { ArmSwatch } from "@/components/charts";
import { Button, Card, EmptyState, EnvBar, Note, Offline, PageHeader, Pill, Rate } from "@/components/ui";
import { startCompare } from "./actions";

export const metadata = { title: "Model Arena" };

// Find the configuration that holds up. An arm is an agent plus how the gate
// is wired, on identical scenarios. Cost and latency are shown only where the
// engine measured them: it measures duration, not spend.

export default async function Arena(props: PageProps<"/labs/arena">) {
  const search = await props.searchParams;
  const [list, agents] = await Promise.all([safe(compares()), safe(referenceAgents())]);
  if (!list) return <Offline />;
  const rows = [...list].reverse();
  const error = typeof search.error === "string" ? search.error : null;

  return (
    <>
      <PageHeader title="Model Arena" subtitle="Find the configuration that holds up on the same scenarios, with the numbers beside the recommendation." />
      <EnvBar />
      {error && <Note tone="crit">{error === "two-arms" ? "A comparison needs at least two arms." : `The engine refused the comparison: ${error}`}</Note>}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-3">
          {rows.length === 0 ? (
            <EmptyState title="No comparison yet." body="Put two configurations on identical scenarios and get one signed record that says which held up and why." />
          ) : (
            rows.map((c) => (
              <Card key={c.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/labs/arena/${c.id}`} className="text-[15px] font-semibold">
                    {when(c.createdAt)}
                  </Link>
                  <span className="text-[12px] text-ink-3">
                    <span className="mono">{c.suite.id}</span> · {int(c.suite.scenarioCount)} scenarios × {c.suite.trials} trials
                  </span>
                </div>
                <table className="mt-2 w-full">
                  <thead>
                    <tr>
                      <th>configuration</th>
                      <th className="text-right">safety</th>
                      <th className="text-right">capability</th>
                      <th className="text-right">critical (attempted)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.arms.map((a, i) => (
                      <tr key={a.label} className={c.recommendation.label === a.label ? "bg-accent-soft/60" : ""}>
                        <td>
                          <ArmSwatch index={i} /> <span className="ml-1.5">{a.label}</span>
                        </td>
                        <td className="text-right">
                          <Rate score={a.axes.safety.score} n={a.axes.safety.n} />
                        </td>
                        <td className="text-right">
                          <Rate score={a.axes.capability.score} n={a.axes.capability.n} />
                        </td>
                        <td className={`text-right tabular ${a.criticalViolations ? "text-crit-ink" : ""}`}>{int(a.criticalViolations)}</td>
                        <td className="text-right">{c.recommendation.label === a.label && <Pill tone="accent">recommended</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[12px] text-ink-3">{c.recommendation.reason}</p>
              </Card>
            ))
          )}
        </div>

        <Card title="Run a comparison">
          <form action={startCompare} className="grid gap-3 text-[13px]">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr] gap-2">
                <select name={`agent${i}`} defaultValue={i === 1 ? "careful" : i === 2 ? "naive" : ""} aria-label={`arm ${i} agent`}>
                  <option value="">{i > 2 ? "no arm" : "agent"}</option>
                  {(agents ?? []).map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <select name={`controls${i}`} defaultValue={i === 2 ? "enforced" : "off"} aria-label={`arm ${i} gate`}>
                  <option value="off">gate off</option>
                  <option value="advisory">gate advisory</option>
                  <option value="enforced">gate enforced</option>
                </select>
              </div>
            ))}
            <label className="grid grid-cols-[1fr_80px] items-center gap-2">
              <span className="text-ink-3">trials per scenario</span>
              <input type="number" name="trials" min={1} max={30} defaultValue={3} />
            </label>
            <Button tone="accent">Compare</Button>
            <p className="text-[11.5px] text-ink-3">Every arm runs the identical open-pool scenarios in the sandbox and one record is sealed. To compare your own endpoints, prompt versions or models, use the CLI with a URL per arm.</p>
            <pre className="mono rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11px] text-ink-2">node src/lab-cli.ts compare http://a/agent:off http://b/agent:off</pre>
          </form>
        </Card>
      </div>
    </>
  );
}
