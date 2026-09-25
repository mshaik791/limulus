import Link from "next/link";
import { ArrowUpRight, Check, Minus, X } from "lucide-react";
import { agents as loadAgents, gates, jobs as loadJobs, labRun, labRuns, profile, referenceAgents, type GateRecord, type LabRunSummary } from "@/lib/api";
import { nextStep } from "@/lib/onboarding";
import { safe } from "@/lib/safe";
import { CONFIG } from "@/lib/config";
import { FAMILIES, agentKey, counts, coverageConfidence, failingByFamily, familyAxes, readiness } from "@/lib/derive";
import { ago, int, money } from "@/lib/format";
import { suiteName } from "@/lib/names";
import { Note, Offline } from "@/components/ui";
import { AgentSelect } from "./agent-select";
import { overviewIdentity } from "./agent-identity";
import { RunTest } from "./run-test";

export const metadata = { title: "Test" };
const HEADINGS = { READY: "Ready to deploy", REVIEW: "Review required", BLOCKED: "Not ready to deploy", NONE: "Not tested" };

export default async function LabsOverview(props: PageProps<"/labs">) {
  const search = await props.searchParams;
  const [runs, gateRecords, agents, registry, jobList] = await Promise.all([safe(labRuns()), safe(gates()), safe(referenceAgents()), safe(loadAgents()), safe(loadJobs())]);
  if (!runs) return <Offline />;
  // The customer journey's next action, from the registry and the job log.
  const step = registry ? nextStep({ agents: registry.agents, versions: registry.versions, jobs: jobList ?? [], runs }) : null;
  const error = typeof search.error === "string" ? search.error : null;
  const latestByAgent = new Map<string, LabRunSummary>();
  for (const r of [...runs].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) latestByAgent.set(agentKey(r), r);
  const choices = [...latestByAgent.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const wanted = typeof search.agent === "string" ? search.agent : "";
  // By default, the most recently tested agent that is registered here; then any real suite; then anything.
  const registered = new Set((registry?.agents ?? []).map((a) => a.id));
  const latest = choices.find((r) => agentKey(r) === wanted) ?? choices.find((r) => r.agent.registry && registered.has(r.agent.registry.agentId)) ?? choices.find((r) => !/selftest|^custom:/.test(r.suite.id) && r.agent.name !== "t") ?? choices[0];
  if (!latest) return <>
    <Context />
    <section className="labs-hero"><h1>Test before you trust.</h1><p>Evaluate your financial agent before deployment.</p><Arches /></section>
    {error && <Note tone="crit">The engine refused the run: {error}</Note>}
    {step && <NextStepStrip step={step} />}
    <section className="labs-panel labs-empty"><h2>Start with your first test.</h2><p>Connect your agent or explore a scripted payment demo. Every test runs in a simulated environment; no money moves.</p><div className="labs-actions"><Link href="/labs/agents/new" className="labs-primary-button">Connect agent<ArrowUpRight size={18} aria-hidden="true" /></Link><Link href="/labs/tests/new?demo=careful" className="labs-text-link">Run a demo test<ArrowUpRight size={15} aria-hidden="true" /></Link></div></section>
  </>;

  const [full, prof] = await Promise.all([safe(labRun(latest.id)), safe(profile(latest.agent.name, latest.agent.version))]);
  if (!full) return <Offline />;
  const grades = full.grades.filter((g) => !g.unusable);
  const c = counts(grades);
  const axes = familyAxes(prof?.nodes ?? []);
  const coverage = coverageConfidence(axes);
  const gateByAgent = new Map<string, GateRecord>();
  for (const g of gateRecords ?? []) gateByAgent.set(`${g.agent.name}@${g.agent.version}`, g);
  const gate = gateByAgent.get(agentKey(latest));
  const ready = readiness(latest, gate, grades, axes);
  // Missing fetches are unknown, not clean evidence. The shared decision rule is unchanged.
  const available = prof !== null && gateRecords !== null;
  const identity = overviewIdentity(latest);
  const run = `/labs/tests/${encodeURIComponent(latest.id)}`;
  const release = gate ? `/labs/releases/${encodeURIComponent(gate.id)}` : "/labs/releases";
  const missing = CONFIG.requiredFamilies.filter((key) => !axes.some((a) => a.key === key && a.status === "measured"));
  const missingLabels = missing.map((key) => FAMILIES.find((f) => f.key === key)?.label.toLowerCase() ?? key);
  const testingOk = c.episodes >= CONFIG.minEpisodes && missing.length === 0;
  const inRun = failingByFamily(grades);
  const failing = FAMILIES.map((f) => ({ ...f, ...inRun.get(f.key) })).filter((f) => (f.episodes ?? 0) > 0).sort((a, b) => (b.critical ?? 0) - (a.critical ?? 0) || (b.episodes ?? 0) - (a.episodes ?? 0));
  const worst = [...grades].filter((g) => g.criticalCount > 0).sort((a, b) => (b.paidAmount ?? 0) - (a.paidAmount ?? 0))[0] ?? grades.find((g) => g.violations.length || g.effective !== g.expected);
  const recent = [...runs].filter((r) => r.agent.name === latest.agent.name).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3);
  const records = new Map(await Promise.all(recent.map(async (r) => [r.id, r.id === latest.id ? full : await safe(labRun(r.id))] as const)));
  const reason = c.criticalEpisodes ? `${int(c.criticalEpisodes)} of ${int(c.episodes)} tests had critical failures.` : c.episodes ? `No critical failures in ${int(c.episodes)} usable tests.` : "No usable tests are available in this run.";
  const evidenceReason = !prof ? "Coverage evidence is unavailable. Review the test details." : missing.length ? `More testing needed: ${missingLabels.join(", ")}.` : c.episodes < CONFIG.minEpisodes ? `${int(c.episodes)} of ${CONFIG.minEpisodes} required usable tests completed.` : ready.state === "READY" ? "Required testing and the regression check pass." : !gate ? "Run the regression check before deployment." : gate.verdict === "overridden" ? "The regression check was overridden and needs review." : gate.verdict === "fail" ? "The regression check found a change that needs review." : latest.axes.safety.score < CONFIG.minSafety ? `Safety is below the required score of ${CONFIG.minSafety}.` : "Review the release requirements before deployment.";
  const primary = c.failingEpisodes > 0 ? { href: `${run}?tab=failures`, label: "Review failures" } : ready.state === "READY" && available ? { href: release, label: "Review release" } : { href: run, label: "Review test evidence" };

  return <>
    <Context />
    {error && <Note tone="crit">The engine refused the run: {error}</Note>}
    <section className="labs-hero">
      <div className="labs-identity-row"><AgentSelect value={agentKey(latest)} name={identity.name} options={choices.map((r) => ({ key: agentKey(r), ...overviewIdentity(r) }))} /><span className="labs-chip">{identity.version}</span>{identity.demo && <span className="labs-chip">Demo</span>}</div>
      <p>{identity.detail}<span className="labs-hero-tagline">Test before you trust.</span></p>
      <Arches />
    </section>
    <nav className="labs-tabs" aria-label="Test navigation"><Link href={`/labs?agent=${encodeURIComponent(agentKey(latest))}`} aria-current="page">Overview</Link><Link href="/labs/agents">Agents</Link><Link href="/labs/tests">Test history</Link><Link href="/labs/arena">Compare models</Link><Link href={release}>Release requirements</Link></nav>
    {step && <NextStepStrip step={step} />}
    <div className="labs-test-context"><span className="labs-eyebrow">Latest test</span><Link href={run}>{suiteName(latest.suite.id).name}</Link><span>· {identity.version} · {int(c.episodes)} usable tests · {ago(latest.createdAt)}</span></div>

    <div className="labs-decision-grid">
      <section className="labs-panel labs-decision" aria-labelledby="deployment-heading">
        <div className="labs-eyebrow"><span className={`labs-dot ${available && ready.state === "BLOCKED" ? "is-fail" : available && ready.state === "READY" ? "is-pass" : "is-warn"}`} />Deployment status</div>
        <h2 id="deployment-heading">{available ? HEADINGS[ready.state] : "Evidence unavailable"}</h2>
        <div className="labs-decision-copy"><p>{reason}</p><p>{gateRecords === null ? "Release records could not be loaded. Try again before deploying." : evidenceReason}</p></div>
        <div className="labs-actions"><Link href={primary.href} className="labs-primary-button">{primary.label}<ArrowUpRight size={18} /></Link><RunTest key={agentKey(latest)} agents={agents ?? []} show={["run"]} runLabel="Run another test" quiet defaultAgent={identity.config?.toLowerCase()} defaultEndpoint={identity.demo ? "" : latest.agent.endpoint} /></div>
        <div className="labs-safety">Safety <strong>{c.episodes ? latest.axes.safety.score : "—"}</strong><span>/ 100</span><span className="labs-muted">· Required score {CONFIG.minSafety}</span></div>
      </section>
      <section className="labs-panel labs-requirements" aria-labelledby="requirements-heading">
        <h2 id="requirements-heading">Deployment requirements</h2>
        <ul>
          <Requirement label="Safety threshold" status={c.episodes ? latest.axes.safety.score >= CONFIG.minSafety ? "pass" : "fail" : "unknown"} value={c.episodes ? `${latest.axes.safety.score} / ${CONFIG.minSafety} required` : "Not evaluated"} />
          <Requirement label="Critical failures resolved" status={c.episodes ? c.criticalEpisodes ? "fail" : "pass" : "unknown"} value={c.episodes ? c.criticalEpisodes ? `${int(c.criticalEpisodes)} remaining` : "None found" : "Not evaluated"} />
          <Requirement label="Required testing complete" status={!prof ? "unknown" : testingOk ? "pass" : "warn"} value={!prof ? "Unavailable" : testingOk ? "Complete" : "Needs evidence"} />
          <Requirement label="Regression check" status={!gateRecords ? "unknown" : !gate || gate.verdict === "overridden" ? "warn" : gate.verdict === "fail" ? "fail" : "pass"} value={!gateRecords ? "Unavailable" : !gate ? "Not run" : gate.verdict === "overridden" ? "Overridden" : gate.verdict === "fail" ? "Failed" : "Passed"} />
        </ul>
        <p>Passing the regression check alone does not establish readiness.</p><TextLink href={release}>View release requirements</TextLink>
      </section>
    </div>
    <div className="labs-detail-grid">
      <section className="labs-panel labs-failures" aria-labelledby="fix-heading">
        <h2 id="fix-heading">{c.failingEpisodes ? "What to fix" : "What to do next"}</h2>
        {failing.slice(0, 3).map((f) => <div className="labs-failure-row" key={f.key}><strong>{f.label}</strong><span className={f.critical ? "labs-failure-text" : "labs-muted"}>{int(f.critical || f.episodes || 0)} {f.critical ? "critical failures" : "failing tests"}</span><TextLink href={`${run}?tab=failures`}>Investigate failures</TextLink></div>)}
        {worst ? <div className="labs-worst"><p>{worst.violations.find((v) => v.severity === "critical")?.code.replaceAll("_", " ") ?? "Unexpected behavior in the latest test"}</p><div><span>{worst.paidAmount ? `Most severe example: ${money(worst.paidAmount)} simulated exposure` : "Review the simulated execution and its findings."}</span><TextLink href={`${run}/scenarios/${encodeURIComponent(worst.scenarioId)}?trial=${worst.trial}`}>Replay scenario</TextLink></div></div> : <p>{testingOk ? "Review the release requirements for this version." : "Build the missing evidence before deploying this version."} <TextLink href={testingOk ? release : run}>Review details</TextLink></p>}
      </section>
      <section className="labs-panel labs-coverage" aria-labelledby="coverage-heading">
        <h2 id="coverage-heading">Testing coverage</h2><p>{prof ? `${coverage.measured} of ${coverage.of} risk areas sufficiently tested.` : "Coverage evidence is unavailable."}</p>
        <div className="labs-coverage-bar" aria-label={prof ? `${coverage.measured} of ${coverage.of} risk areas sufficiently tested` : "Coverage unavailable"}>{axes.map((a) => <span key={a.key} title={`${a.label}: ${prof ? a.status.replaceAll("-", " ") : "unavailable"}`} className={prof && a.status === "measured" ? "measured" : ""} />)}</div>
        <div className="labs-coverage-foot"><span>{!prof ? "Open the run for details." : missing.length ? `Required gaps: ${missingLabels.join(", ")}` : "All required risk areas sufficiently tested."}</span><TextLink href={`${run}?tab=overview`}>View coverage</TextLink></div>
        {c.episodes < CONFIG.minEpisodes && <small>{int(c.episodes)} / {CONFIG.minEpisodes} required usable tests in this run.</small>}
      </section>
    </div>
    <section className="labs-panel labs-history" aria-labelledby="history-heading">
      <div className="labs-section-heading"><h2 id="history-heading">Recent tests</h2><TextLink href="/labs/tests">View history</TextLink></div>
      <div className="labs-table-scroll"><table><thead><tr><th>Suite</th><th>Version</th><th>Usable tests</th><th>Test result</th><th>Completed</th></tr></thead><tbody>{recent.map((r) => {
        const record = records.get(r.id);
        const result = record ? counts(record.grades) : null;
        const text = !result ? "Unavailable" : result.criticalEpisodes ? `${int(result.criticalEpisodes)} critical failures` : result.failingEpisodes ? `${int(result.failingEpisodes)} failing tests` : result.episodes < CONFIG.minEpisodes ? "More evidence needed" : "No failures found";
        return <tr key={r.id}><td><Link href={`/labs/tests/${encodeURIComponent(r.id)}`}>{suiteName(r.suite.id).name}</Link></td><td>{overviewIdentity(r).version}</td><td>{result ? int(result.episodes) : "—"}</td><td className={result?.criticalEpisodes ? "labs-failure-text" : ""}>{text}</td><td>{ago(r.createdAt)}</td></tr>;
      })}</tbody></table></div>
    </section>
    <footer className="labs-footnote">Test results are simulated. Coverage uses this version’s test history; readiness uses the configured release requirements. <Link href="/labs/qualifications">Assurance checks ↗</Link><span className="labs-connect"><RunTest agents={agents ?? []} show={["connect"]} /></span></footer>
  </>;
}

function NextStepStrip({ step }: { step: NonNullable<ReturnType<typeof nextStep>> }) {
  return <section className={`labs-next is-${step.key}`} aria-label="Next step"><div><strong>{step.title}</strong><p>{step.body}</p></div><Link href={step.href} className="labs-primary-button">{step.cta}<ArrowUpRight size={18} aria-hidden="true" /></Link></section>;
}

function Context() { return <div className="labs-context"><span>Local workspace <span aria-hidden="true">/</span> Test</span><span>Sandbox · No real money moves</span></div>; }
function Arches() { return <div className="labs-arches" aria-hidden="true"><i /><i /><i /></div>; }
function TextLink({ href, children }: { href: string; children: React.ReactNode }) { return <Link className="labs-text-link" href={href}>{children}<ArrowUpRight size={15} aria-hidden="true" /></Link>; }
function Requirement({ label, value, status }: { label: string; value: string; status: "pass" | "fail" | "warn" | "unknown" }) {
  return <li><span className={`labs-check is-${status}`} aria-label={status === "pass" ? "Passed" : status === "fail" ? "Failed" : status === "warn" ? "Needs attention" : "Unknown"}>{status === "pass" ? <Check size={13} /> : status === "fail" ? <X size={13} /> : status === "warn" ? "!" : <Minus size={13} />}</span><span>{label}</span><span className="labs-requirement-value">{value}</span></li>;
}
