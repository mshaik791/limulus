import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The customer journey, end to end, with every part in its own process:
// an engine, a fixture agent standing in for the customer's, and this script
// as the console. Register → check → run → progress → sealed run → results,
// plus the ways it must fail truthfully: wrong credential, a reply that is not
// a step, an endpoint that never answers, a double submission.
//
//   node src/onboarding-e2e.ts
//
// The engine here runs on its own port with a temporary data directory for
// its registry, job log and sealed runs, and a short step timeout, so nothing
// it does touches the engine you use.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const enginePort = 8797;
const fixturePort = 9201;
const engine = `http://localhost:${enginePort}`;
const TOKEN = "e2e-fixture-token";
const dataDir = mkdtempSync(join(tmpdir(), "limulus-e2e-"));

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${engine}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

function start(cmd: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, cmd, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", (d) => process.stderr.write(`    [${cmd[0].split("/").pop()}] ${d}`));
  return child;
}

async function waitFor(url: string, label: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await sleep(100);
  }
  throw new Error(`${label} did not come up at ${url}`);
}

const procs: ChildProcess[] = [];
try {
  procs.push(start(["src/experiments/fixture-agent.ts", "--port", String(fixturePort), "--token", TOKEN], {}));
  procs.push(start(["src/server.ts"], { PORT: String(enginePort), LIMULUS_DATA_DIR: dataDir, LIMULUS_ALLOW_PRIVATE_ENDPOINTS: "1", LIMULUS_STEP_TIMEOUT_MS: "2500", LIMULUS_REQUIRE_AUTH: "0" }));
  await waitFor(`http://localhost:${fixturePort}/health`, "fixture agent");
  await waitFor(`${engine}/health`, "engine");
  check("engine and fixture agent are up in separate processes", true);

  // ---- register ---------------------------------------------------------------
  const created = await api<{ agent: { id: string; connection: { state: string; auth?: { secretId: string } } }; version: { id: string; label: string } }>("/v1/agents", {
    method: "POST",
    body: JSON.stringify({ name: "E2E Invoice Agent", workflow: "Accounts payable", endpoint: `http://localhost:${fixturePort}/agent`, auth: { header: "authorization", scheme: "bearer", value: TOKEN }, version: { label: "v1", model: "fixture/ok" } }),
  });
  check("registration is accepted (201)", created.status === 201, String(created.status));
  const agentId = created.body.agent.id;
  const v1 = created.body.version.id;
  check("the response carries a secret reference and not the token", created.body.agent.connection.auth?.secretId?.startsWith("sec_") === true && !JSON.stringify(created.body).includes(TOKEN));
  const listed = await api<{ agents: { id: string }[] }>("/v1/agents");
  check("the agent is listed and the listing has no token in it", listed.body.agents.some((a) => a.id === agentId) && !JSON.stringify(listed.body).includes(TOKEN));

  // ---- check: connected, then each failure kind, separately ----------------------
  const ok = await api<{ result: { state: string; detail: string; reported?: { model?: string } } }>(`/v1/agents/${agentId}/check`, { method: "POST" });
  check("the connection check passes against the fixture", ok.body.result.state === "connected", ok.body.result.detail);
  check("the fixture's self-reported model is captured", ok.body.result.reported?.model === "fixture/ok");

  await api(`/v1/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ auth: { header: "authorization", scheme: "bearer", value: "wrong" } }) });
  const bad = await api<{ result: { state: string } }>(`/v1/agents/${agentId}/check`, { method: "POST" });
  check("a wrong credential reports auth_failed", bad.body.result.state === "auth_failed");
  await api(`/v1/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ auth: { header: "authorization", scheme: "bearer", value: TOKEN }, endpoint: `http://localhost:${fixturePort}/agent?mode=malformed` }) });
  const mal = await api<{ result: { state: string } }>(`/v1/agents/${agentId}/check`, { method: "POST" });
  check("a non-JSON reply reports incompatible", mal.body.result.state === "incompatible");
  await api(`/v1/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ endpoint: `http://localhost:${fixturePort + 7}/agent` }) });
  const gone = await api<{ result: { state: string } }>(`/v1/agents/${agentId}/check`, { method: "POST" });
  check("a closed port reports unreachable", gone.body.result.state === "unreachable");
  await api(`/v1/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ endpoint: `http://localhost:${fixturePort}/agent` }) });
  const again = await api<{ result: { state: string } }>(`/v1/agents/${agentId}/check`, { method: "POST" });
  check("restored, the check passes again", again.body.result.state === "connected");

  // ---- run: a job, submitted twice with the same key, is one job ----------------------
  const req = { agentId, versionId: v1, trials: 1, controls: "off", suite: "open-pool" };
  const key = `e2e-${Date.now()}`;
  const first = await api<{ job: { id: string; state: string; progress: { total: number } } }>("/v1/lab/jobs", { method: "POST", body: JSON.stringify(req), headers: { "idempotency-key": key } });
  const second = await api<{ job: { id: string } }>("/v1/lab/jobs", { method: "POST", body: JSON.stringify(req), headers: { "idempotency-key": key } });
  check("a job is accepted (202) as queued", first.status === 202 && first.body.job.state === "queued", String(first.status));
  check("a duplicate submission with the same key returns the same job", second.body.job.id === first.body.job.id);
  const conflict = await api("/v1/lab/jobs", { method: "POST", body: JSON.stringify({ ...req, trials: 2 }), headers: { "idempotency-key": key } });
  check("the same key with a different request is a conflict (409)", conflict.status === 409);

  // ---- progress until the run is sealed ------------------------------------------
  let job = first.body.job as { id: string; state: string; runId?: string; progress: { completed: number; total: number; unusable: number }; error?: { message: string } };
  for (let i = 0; i < 600; i++) {
    job = (await api<{ job: typeof job }>(`/v1/lab/jobs/${job.id}`)).body.job;
    if (job.state === "completed" || job.state === "failed" || job.state === "interrupted") break;
    await sleep(200);
  }
  check("the job completes", job.state === "completed", job.error?.message ?? job.state);
  check("progress ended at the total", job.progress.completed === job.progress.total);

  // ---- the sealed run and what it says ----------------------------------------------
  const run = (await api<{ id: string; agent: { registry?: { agentId: string; versionId: string }; subject: { model?: string; source: string } }; grades: { unusable?: boolean; criticalCount: number; violations: unknown[] }[]; axes: { safety: { score: number; sampleSize: number } }; verification: { ok: boolean } }>(`/v1/lab/runs/${job.runId}`)).body;
  check("the job links to a sealed run that verifies", run.id === job.runId && run.verification.ok);
  check("the run is bound to the registered agent and version", run.agent.registry?.agentId === agentId && run.agent.registry?.versionId === v1);
  // The version declared "fixture/ok" and the endpoint reports the same on every
  // step: recorded as configured, with no disagreement flagged.
  check("the run records the declared model as configured, agreeing with the endpoint", run.agent.subject.model === "fixture/ok" && run.agent.subject.source === "configured" && !(run.agent.subject as { inconsistent?: string[] }).inconsistent, JSON.stringify(run.agent.subject));
  const usable = run.grades.filter((g) => !g.unusable);
  check("every trial was usable: the fixture always answered", usable.length === run.grades.length);
  check("the scripted naive fixture produced real, graded failures", usable.some((g) => g.criticalCount > 0), `${usable.filter((g) => g.criticalCount > 0).length} critical of ${usable.length}`);
  const traces = (await api<{ episodes: { runId: string }[] }>(`/v1/lab/episodes?runId=${run.id}`)).body.episodes;
  check("traces are retrievable for replay", traces.length > 0);

  // ---- an endpoint that never answers: unusable trials, not failures --------------------
  const v2 = (await api<{ version: { id: string } }>(`/v1/agents/${agentId}/versions`, { method: "POST", body: JSON.stringify({ label: "v2-stall", note: "endpoint mode stall" }) })).body.version.id;
  await api(`/v1/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ endpoint: `http://localhost:${fixturePort}/agent?mode=stall` }) });
  const stallJob = (await api<{ job: { id: string } }>("/v1/lab/jobs", { method: "POST", body: JSON.stringify({ agentId, versionId: v2, trials: 1, controls: "off", suite: "open-pool" }) })).body.job;
  // This one takes a step timeout per episode, long enough to watch progress move.
  let stalled = stallJob as unknown as typeof job;
  let sawProgress = false;
  for (let i = 0; i < 1500; i++) {
    stalled = (await api<{ job: typeof job }>(`/v1/lab/jobs/${stallJob.id}`)).body.job;
    if (stalled.state === "running" && stalled.progress.completed > 0 && stalled.progress.completed < stalled.progress.total) sawProgress = true;
    if (stalled.state !== "queued" && stalled.state !== "running") break;
    await sleep(200);
  }
  check("progress was visible mid-run with real counts", sawProgress);
  check("a silent endpoint still completes as a job", stalled.state === "completed", stalled.state);
  check("and every trial is unusable, none a failure", stalled.progress.unusable === stalled.progress.total);
  const stallRun = (await api<{ grades: { unusable?: boolean }[]; axes: { safety: { sampleSize: number } } }>(`/v1/lab/runs/${stalled.runId}`)).body;
  check("the unusable trials are outside every denominator", stallRun.grades.every((g) => g.unusable) && stallRun.axes.safety.sampleSize === 0);

  // ---- nothing in any record leaked the credential ---------------------------------------
  const everything = JSON.stringify([listed.body, run, stallRun, job, stalled]);
  check("no record, run or job carries the credential", !everything.includes(TOKEN));
} catch (e) {
  check(`the journey ran without an exception`, false, (e as Error).message);
} finally {
  for (const p of procs) p.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll onboarding checks passed");
process.exit(failures ? 1 : 0);
