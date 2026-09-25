"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Job } from "@/lib/api";
import { JOB_LABEL } from "@/lib/onboarding";
import { cancelJobAction } from "../actions";

// Live progress from the engine's own job record, polled every two seconds
// while the job is active. Counts are the runner's; nothing here animates a
// number the engine did not report. On completion the sealed run opens.

export function Progress({ initial }: { initial: Job }) {
  const [job, setJob] = useState(initial);
  const [stale, setStale] = useState(false);
  const router = useRouter();
  const active = job.state === "queued" || job.state === "running";

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as { job: Job };
        if (!cancelled) {
          setJob(next.job);
          setStale(false);
        }
      } catch {
        if (!cancelled) setStale(true);
      }
    };
    const t = setInterval(poll, 2000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [active, job.id]);

  useEffect(() => {
    if (job.state === "completed" && job.runId) {
      const t = setTimeout(() => router.replace(`/labs/tests/${job.runId}`), 1200);
      return () => clearTimeout(t);
    }
  }, [job.state, job.runId, router]);

  const pct = job.progress.total ? Math.round((100 * job.progress.completed) / job.progress.total) : 0;
  return (
    <section className={`labs-panel labs-job is-${job.state}`} aria-live="polite">
      <div className="labs-section-heading">
        <h2>{JOB_LABEL[job.state]}{stale ? " · connection to the console lost, retrying" : ""}</h2>
        <span className="labs-muted">{job.subject.name} {job.subject.version} · {job.suite.scenarioCount} scenarios × {job.suite.trials}</span>
      </div>
      <div className="labs-progress" role="progressbar" aria-valuemin={0} aria-valuemax={job.progress.total} aria-valuenow={job.progress.completed} aria-label="trials completed">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="labs-progress-text">
        <strong>{job.progress.completed}</strong> of {job.progress.total} trials complete
        {job.progress.unusable > 0 && <> · <span className="labs-warn">{job.progress.unusable} unusable</span> (no usable reply from the endpoint)</>}
        {job.state === "running" && job.progress.scenarioId && <span className="labs-muted"> · last scenario {job.progress.scenarioId}</span>}
        {job.state === "queued" && <span className="labs-muted"> · waiting for a worker slot</span>}
      </p>
      {job.state === "completed" && job.runId && (
        <p>The run is sealed. Opening the results… <Link className="labs-text-link" href={`/labs/tests/${job.runId}`}>Open now</Link></p>
      )}
      {job.state === "failed" && (
        <div className="labs-job-error">
          <p><strong>The engine could not run this suite.</strong> {job.error?.message}</p>
          <p className="labs-muted">No run was sealed. This is an engine or setup failure, not a result about the agent.</p>
        </div>
      )}
      {job.state === "interrupted" && (
        <div className="labs-job-error">
          <p><strong>Interrupted.</strong> {job.error?.message}</p>
          <p className="labs-muted">Completed trials were discarded; a partial suite is not a completed suite.</p>
        </div>
      )}
      {active && (
        <form action={cancelJobAction} className="labs-actions">
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit" className="labs-text-link labs-button-link">Cancel this test</button>
          <span className="labs-muted">Cancelling seals nothing.</span>
        </form>
      )}
    </section>
  );
}
