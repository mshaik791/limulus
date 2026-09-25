import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The job lifecycle against fixture endpoints in this process. Registry and
// job logs go to a temporary directory; sealed runs still go to the engine's
// run log, like every other Lab selftest. The step timeout is short so an
// endpoint that never answers becomes an unusable episode in seconds.

process.env.LIMULUS_DATA_DIR = mkdtempSync(join(tmpdir(), "limulus-jobs-"));
process.env.LIMULUS_ALLOW_PRIVATE_ENDPOINTS = "1";
process.env.LIMULUS_STEP_TIMEOUT_MS = "1500";
process.env.LIMULUS_JOB_CONCURRENCY = "1";

const { createAgent, updateAgent } = await import("../agents/registry.ts");
const { cancelJob, getJob, readJobs, reconcileJobs, submitJob } = await import("./jobs.ts");
const { readLabRuns } = await import("./lab.ts");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, () => r((s.address() as { port: number }).port)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle(id: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const j = getJob(id)!;
    if (j.state === "completed" || j.state === "failed" || j.state === "interrupted") return j;
    await sleep(100);
  }
  return getJob(id)!;
}

// An endpoint that always refuses (a usable answer, graded as such), one that
// never answers, and one that answers slowly enough to be cancelled mid-run.
const refuser = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "finish", action: "refuse", reason: "fixture", model: "fixture-refuser" }));
});
const silent = createServer(() => {
  /* accept and never reply */
});
const slow = createServer((_req, res) => {
  setTimeout(() => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "finish", action: "refuse", reason: "slow fixture" }));
  }, 400);
});
const [refuserPort, silentPort, slowPort] = await Promise.all([listen(refuser), listen(silent), listen(slow)]);

// ---- a demo job runs to a sealed run with real progress ------------------------
{
  const before = readLabRuns().length;
  const job = await submitJob({ demo: "careful", trials: 1 });
  check("a job is accepted as queued with its total from the pool", job.state === "queued" && job.progress.total === job.suite.scenarioCount);
  const done = await settle(job.id);
  check("the demo job completes", done.state === "completed", done.error?.message);
  check("a completed job names its sealed run", Boolean(done.runId) && readLabRuns().some((r) => r.id === done.runId));
  check("progress reached the total", done.progress.completed === done.progress.total);
  check("exactly one run was sealed", readLabRuns().length === before + 1);
  check("the log survives a reload", readJobs().some((j) => j.id === job.id && j.state === "completed"));
}

// ---- a registered agent that answers: usable episodes, graded ---------------------
const { agent, version } = await createAgent({ name: "Fixture Refuser", workflow: "test", endpoint: `http://localhost:${refuserPort}/agent`, version: { label: "v1" } });
{
  const job = await submitJob({ agentId: agent.id, versionId: version.id, trials: 1 });
  check("a registered version is accepted and named on the job", job.subject.name === "Fixture Refuser" && job.subject.version === "v1");
  const done = await settle(job.id);
  check("the registered job completes", done.state === "completed", done.error?.message);
  const run = readLabRuns().find((r) => r.id === done.runId);
  check("the run is bound to the agent and version records", run?.agent.registry?.agentId === agent.id && run?.agent.registry?.versionId === version.id);
  check("a refusal is a usable answer, not an unusable trial", done.progress.unusable === 0 && run!.grades.every((g) => !g.unusable));
  check("the endpoint's self-reported model is on the run", run?.agent.subject.model === "fixture-refuser");
}

// ---- an endpoint that never answers: unusable episodes, still a completed job ---------
{
  await updateAgent(agent.id, { endpoint: `http://localhost:${silentPort}/agent` });
  const job = await submitJob({ agentId: agent.id, versionId: version.id, trials: 1 });
  const done = await settle(job.id, 120_000);
  check("a silent endpoint yields a completed job of unusable episodes", done.state === "completed" && done.progress.unusable === done.progress.total, `${done.state} unusable=${done.progress.unusable}/${done.progress.total}`);
  const run = readLabRuns().find((r) => r.id === done.runId);
  check("those episodes are unusable on the run, not failures", run!.grades.every((g) => g.unusable) && run!.axes.safety.sampleSize === 0);
}

// ---- refusals never become jobs; a job can fail at start ---------------------------
{
  let status = 0;
  try {
    await submitJob({ agentId: agent.id, versionId: "ver_nope", trials: 1 });
  } catch (e) {
    status = (e as { status: number }).status;
  }
  check("an unknown version is refused at submission (404), not queued", status === 404);
  try {
    await submitJob({ demo: "careful", trials: 99 });
  } catch (e) {
    status = (e as { status: number }).status;
  }
  check("an out-of-range trial count is refused (400)", status === 400);

  await updateAgent(agent.id, { endpoint: `http://localhost:${slowPort}/agent` });
  const first = await submitJob({ agentId: agent.id, versionId: version.id, trials: 1 });
  const second = await submitJob({ agentId: agent.id, versionId: version.id, trials: 1 });
  await updateAgent(agent.id, { enabled: false });
  const firstDone = await settle(first.id, 120_000);
  check("the first job keeps running with the target it started with", firstDone.state === "completed" || firstDone.state === "interrupted", firstDone.state);
  const secondDone = await settle(second.id);
  check("a job whose agent was disabled before it started fails, with a reason", secondDone.state === "failed" && secondDone.error?.kind === "refused", secondDone.error?.message);
  await updateAgent(agent.id, { enabled: true });
}

// ---- cancellation seals nothing ------------------------------------------------
{
  const before = readLabRuns().length;
  const job = await submitJob({ agentId: agent.id, versionId: version.id, trials: 2 });
  await sleep(900);
  const mid = getJob(job.id)!;
  check("the job is running with partial progress", mid.state === "running" && mid.progress.completed > 0 && mid.progress.completed < mid.progress.total, `${mid.state} ${mid.progress.completed}/${mid.progress.total}`);
  cancelJob(job.id);
  const done = await settle(job.id);
  check("a cancelled job is interrupted", done.state === "interrupted" && done.error?.kind === "cancelled", done.state);
  check("nothing was sealed for it", readLabRuns().length === before && !done.runId);
  let refused = false;
  try {
    cancelJob(job.id);
  } catch {
    refused = true;
  }
  check("a finished job cannot be cancelled again", refused);
}

// ---- restart reconciliation ---------------------------------------------------------
{
  const orphan = { id: "job_orphan0000000000", workspace: "local", state: "running", request: { demo: "careful", trials: 1, controls: "off", suite: "open-pool" }, subject: { name: "x", version: "0" }, suite: { id: "payments-v1", scenarioCount: 1, trials: 1, total: 1 }, progress: { completed: 0, total: 1, unusable: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pid: 1 };
  appendFileSync(join(process.env.LIMULUS_DATA_DIR!, "lab-jobs.jsonl"), `${JSON.stringify(orphan)}\n`);
  const fixed = reconcileJobs();
  check("a job left running by a dead process is marked interrupted on startup", fixed.some((j) => j.id === orphan.id && j.state === "interrupted" && j.error?.kind === "restart"));
  check("jobs this process owns are left alone", !fixed.some((j) => j.id !== orphan.id));
}

for (const s of [refuser, silent, slow]) s.close();
rmSync(process.env.LIMULUS_DATA_DIR!, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nAll job checks passed");
process.exit(failures ? 1 : 0);
