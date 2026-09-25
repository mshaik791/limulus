import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { referenceToolAgents } from "./agents.ts";
import { CONTROL_MODES, type ControlMode } from "./controls.ts";
import { AbortedError, type ToolAgentTarget } from "./episode.ts";
import { runSuite, type LabRun } from "./lab.ts";
import { openPool, PoolError } from "../bench/pools.ts";
import { RegistryError, targetFor } from "../agents/registry.ts";

// A test run as a job. The suite runner is synchronous and a model-backed
// suite takes minutes, so a held HTTP request is not a lifecycle. A job is:
//
//   queued → running → completed | failed | interrupted
//
// with real progress from the runner's own per-episode callback, never a
// guess. State lives in an append-only log, latest line per job wins, so a
// page can reload and a restarted engine can see what it was doing. What the
// states mean, exactly:
//
//   completed    the suite ran to the end and a sealed run exists; runId is set.
//                Unusable episodes inside it are the subject's, not the job's.
//   failed       the engine could not run the suite: the target was refused,
//                the pool is missing, an exception. No run exists.
//   interrupted  cancelled, or the engine process ended mid-run. Nothing is
//                sealed: completed episodes are discarded, because a partial
//                suite is not a completed suite.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = () => process.env.LIMULUS_DATA_DIR ?? join(here, "..", "..", "data");
const jobsPath = () => join(dataDir(), "lab-jobs.jsonl");

export type JobState = "queued" | "running" | "completed" | "failed" | "interrupted";

export type JobRequest = {
  /** A registered agent version… */
  agentId?: string;
  versionId?: string;
  /** …or a scripted demo agent. */
  demo?: "careful" | "naive";
  trials: number;
  controls: ControlMode;
  /** The only suite Phase 1 offers: the open pool. */
  suite: "open-pool";
};

export type Job = {
  id: string;
  workspace: string;
  state: JobState;
  request: JobRequest;
  /** Who the job is for, as displayed: the agent's name and version label. */
  subject: { name: string; version: string; endpoint?: string };
  suite: { id: string; scenarioCount: number; trials: number; total: number };
  progress: { completed: number; total: number; unusable: number; scenarioId?: string };
  runId?: string;
  error?: { kind: "refused" | "pool" | "transport" | "engine" | "cancelled" | "restart"; message: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** The engine process that owns the job, so a restart can tell its own jobs from orphans. */
  pid: number;
};

export class JobError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "JobError";
    this.status = status;
  }
}

// ---- the log ------------------------------------------------------------------

function append(job: Job) {
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
  appendFileSync(jobsPath(), `${JSON.stringify(job)}\n`);
}

export function readJobs(): Job[] {
  const p = jobsPath();
  if (!existsSync(p)) return [];
  const latest = new Map<string, Job>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line) as Job;
    latest.set(j.id, j);
  }
  return [...latest.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const getJob = (id: string) => readJobs().find((j) => j.id === id);

const now = () => new Date().toISOString();

function update(job: Job, patch: Partial<Job>): Job {
  const next = { ...job, ...patch, updatedAt: now() };
  append(next);
  live.set(next.id, next);
  return next;
}

// ---- submission ------------------------------------------------------------------

const MAX_TRIALS = 30;
const CONCURRENCY = Number(process.env.LIMULUS_JOB_CONCURRENCY) > 0 ? Number(process.env.LIMULUS_JOB_CONCURRENCY) : 1;

/** Validates a request and resolves its target. Refusals are 4xx and never become jobs. */
function resolve(req: Partial<JobRequest>): { request: JobRequest; target: ToolAgentTarget } {
  const trials = Number(req.trials ?? 1);
  if (!Number.isInteger(trials) || trials < 1 || trials > MAX_TRIALS) throw new JobError(400, `trials must be a whole number from 1 to ${MAX_TRIALS}`);
  const controls = (req.controls ?? "off") as ControlMode;
  if (!CONTROL_MODES.includes(controls)) throw new JobError(400, `controls must be one of ${CONTROL_MODES.join(", ")}`);
  if (req.suite && req.suite !== "open-pool") throw new JobError(400, "the only suite available to a job is open-pool");
  let target: ToolAgentTarget;
  if (req.demo) {
    if (!referenceToolAgents[req.demo]) throw new JobError(400, `demo must be one of ${Object.keys(referenceToolAgents).join(", ")}`);
    target = referenceToolAgents[req.demo];
  } else {
    if (!req.agentId || !req.versionId) throw new JobError(400, "send agentId and versionId, or demo");
    try {
      target = targetFor(req.agentId, req.versionId);
    } catch (e) {
      if (e instanceof RegistryError) throw new JobError(e.status, e.message);
      throw e;
    }
  }
  return { request: { ...(req.demo ? { demo: req.demo } : { agentId: req.agentId, versionId: req.versionId }), trials, controls, suite: "open-pool" }, target };
}

/** Queues a run and starts the worker. The caller's idempotency is handled at the route. */
export async function submitJob(req: Partial<JobRequest>): Promise<Job> {
  const { request, target } = resolve(req);
  const pack = await openPool();
  const job: Job = {
    id: `job_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    workspace: "local",
    state: "queued",
    request,
    subject: { name: target.name, version: target.version ?? "unversioned", ...(target.endpoint ? { endpoint: target.endpoint } : {}) },
    suite: { id: "payments-v1", scenarioCount: pack.length, trials: request.trials, total: pack.length * request.trials },
    progress: { completed: 0, total: pack.length * request.trials, unusable: 0 },
    createdAt: now(),
    updatedAt: now(),
    pid: process.pid,
  };
  append(job);
  live.set(job.id, job);
  queue.push(job.id);
  void tick();
  return job;
}

// ---- the worker ------------------------------------------------------------------

const live = new Map<string, Job>();
const queue: string[] = [];
const controllers = new Map<string, AbortController>();
let running = 0;

async function tick() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    const job = live.get(id);
    if (!job || job.state !== "queued") continue;
    running++;
    void execute(job).finally(() => {
      running--;
      void tick();
    });
  }
}

async function execute(queued: Job) {
  // The target is resolved again at start, so a credential or endpoint change
  // between submission and start is honoured, and a disabled agent is refused.
  let target: ToolAgentTarget;
  try {
    target = resolve(queued.request).target;
  } catch (e) {
    update(queued, { state: "failed", error: { kind: "refused", message: (e as Error).message }, finishedAt: now() });
    return;
  }
  const controller = new AbortController();
  controllers.set(queued.id, controller);
  let job = update(queued, { state: "running", startedAt: now(), pid: process.pid });
  try {
    const { run } = await runSuite(target, {
      trials: job.request.trials,
      controls: job.request.controls,
      signal: controller.signal,
      onEpisode: (p) => {
        job = update(job, { progress: { completed: p.completed, total: p.total, unusable: job.progress.unusable + (p.unusable ? 1 : 0), scenarioId: p.scenarioId } });
      },
    });
    update(job, { state: "completed", runId: run.id, finishedAt: now(), progress: { ...job.progress, completed: job.progress.total } });
  } catch (e) {
    if (e instanceof AbortedError || controller.signal.aborted) {
      update(job, { state: "interrupted", error: { kind: "cancelled", message: "cancelled before the suite finished; nothing was sealed" }, finishedAt: now() });
    } else if (e instanceof PoolError) {
      update(job, { state: "failed", error: { kind: "pool", message: e.message }, finishedAt: now() });
    } else {
      update(job, { state: "failed", error: { kind: "engine", message: (e as Error).message.slice(0, 300) }, finishedAt: now() });
    }
  } finally {
    controllers.delete(queued.id);
  }
}

/** Cancels a queued or running job. Returns the job as it now stands. */
export function cancelJob(id: string): Job {
  const job = live.get(id) ?? getJob(id);
  if (!job) throw new JobError(404, "no such job");
  if (job.state === "queued") {
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    return update(job, { state: "interrupted", error: { kind: "cancelled", message: "cancelled before it started" }, finishedAt: now() });
  }
  if (job.state === "running") {
    const c = controllers.get(id);
    if (!c) throw new JobError(409, "this job is running in another engine process and cannot be cancelled from here");
    c.abort();
    return job;
  }
  throw new JobError(409, `a ${job.state} job cannot be cancelled`);
}

/**
 * On startup: any job the log says is queued or running belonged to a process
 * that is gone. It is marked interrupted, truthfully, rather than left running
 * forever. Nothing was sealed for it; the customer runs it again.
 */
export function reconcileJobs(): Job[] {
  const orphans = readJobs().filter((j) => (j.state === "queued" || j.state === "running") && !live.has(j.id));
  return orphans.map((j) => update(j, { state: "interrupted", error: { kind: "restart", message: "the engine restarted before the suite finished; nothing was sealed" }, finishedAt: now() }));
}

/** The run a completed job produced, when it is in the log. */
export function runOf(job: Job, runs: LabRun[]): LabRun | undefined {
  return job.runId ? runs.find((r) => r.id === job.runId) : undefined;
}
