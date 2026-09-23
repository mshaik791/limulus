import Link from "next/link";
import { compares, referenceAgents } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, when } from "@/lib/format";
import { Button, Card, Empty, Note, Offline, PageHeader, Pill, SandboxBar } from "@/components/ui";
import { startCompare } from "./actions";

export const metadata = { title: "Compare" };

// Compare puts configurations on identical scenarios. The list shows every
// comparison on record with its recommendation and the critical count of each
// arm, because a recommendation shown without the criticals beside it is the
// kind of number that gets screenshotted.

export default async function Arena(props: PageProps<"/labs/arena">) {
  const search = await props.searchParams;
  const [list, agents] = await Promise.all([safe(compares()), safe(referenceAgents())]);
  if (!list) return <Offline />;
  const rows = [...list].reverse();
  const error = typeof search.error === "string" ? search.error : null;

  return (
    <>
      <PageHeader title="Compare" subtitle="The same scenarios under several configurations. An arm is an agent plus how the gate is wired." />
      <SandboxBar />
      {error && <Note>{error === "two-arms" ? "A comparison needs at least two arms." : `The engine refused the comparison: ${error}`}</Note>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Comparisons on record" aside={`${int(rows.length)}`}>
          {rows.length === 0 ? (
            <Empty>No comparison yet. Run one on the right, or from the CLI: <code className="mono">node src/lab-cli.ts compare careful:off careful:enforced</code></Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>when</th>
                  <th>suite</th>
                  <th>arms (critical violations, attempted)</th>
                  <th>recommended</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/labs/arena/${c.id}`}>{when(c.createdAt)}</Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="mono">{c.suite.id}</span> <span className="text-ink-3">{int(c.suite.scenarioCount)}×{c.suite.trials}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {c.arms.map((a) => (
                          <Pill key={a.label} tone={a.criticalViolations > 0 ? "crit" : "good"}>
                            {a.label} · {int(a.criticalViolations)}
                          </Pill>
                        ))}
                      </div>
                    </td>
                    <td>{c.recommendation.label ? <Pill tone="accent">{c.recommendation.label}</Pill> : <span className="text-ink-3">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Run a comparison">
          <form action={startCompare} className="grid gap-3 text-[13px]">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr] gap-2">
                <select name={`agent${i}`} defaultValue={i === 1 ? "careful" : i === 2 ? "naive" : ""} aria-label={`arm ${i} agent`}>
                  <option value="">{i > 2 ? "no arm" : "agent"}</option>
                  {(agents ?? [{ key: "careful", name: "reference-careful-tools", version: "" }, { key: "naive", name: "reference-naive-tools", version: "" }]).map((a) => (
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
            <Button tone="accent">Run on the open pool</Button>
            <p className="text-[11px] text-ink-3">
              Runs every arm on the same open-pool scenarios, in this process, and seals one record. Reference agents only from here; point the CLI at an HTTP endpoint for your own agent.
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}
