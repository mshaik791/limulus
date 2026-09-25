import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { job as loadJob } from "@/lib/api";
import { safe } from "@/lib/safe";
import { when } from "@/lib/format";
import { Note, Offline } from "@/components/ui";
import { LabsNav } from "../../labs-ui";
import { Progress } from "./progress";

export const metadata = { title: "Test progress" };

// A job's page is its lifecycle: queued, running with real counts, then the
// sealed run, or a truthful failure. It survives reload because the engine
// keeps the state, not the browser.

export default async function JobPage(props: PageProps<"/labs/jobs/[jobId]">) {
  const { jobId } = await props.params;
  const search = await props.searchParams;
  const data = await safe(loadJob(jobId));
  if (!data) return <Offline />;
  const { job } = data;
  const error = typeof search.error === "string" ? search.error : null;
  const back = job.request.demo ? `/labs/tests/new?demo=${job.request.demo}` : `/labs/tests/new?agentId=${encodeURIComponent(job.request.agentId ?? "")}&versionId=${encodeURIComponent(job.request.versionId ?? "")}`;

  return <>
    <LabsNav current="/labs/tests" />
    <div className="labs-page-head">
      <div>
        <p className="labs-eyebrow">{job.request.agentId ? <Link href={`/labs/agents/${job.request.agentId}`}>{job.subject.name}</Link> : <span>{job.subject.name} · demo</span>}</p>
        <h1>Test started {when(job.createdAt)}</h1>
        <p>Job {job.id} · {job.request.controls === "off" ? "gate off" : `gate ${job.request.controls}`} · sandbox, no money moves</p>
      </div>
      {(job.state === "failed" || job.state === "interrupted") && <Link href={back} className="labs-primary-button">Run again<ArrowUpRight size={18} aria-hidden="true" /></Link>}
      {job.state === "completed" && job.runId && <Link href={`/labs/tests/${job.runId}`} className="labs-primary-button">Open results<ArrowUpRight size={18} aria-hidden="true" /></Link>}
    </div>
    {error && <Note tone="crit">{error}</Note>}
    <Progress initial={job} />
  </>;
}
