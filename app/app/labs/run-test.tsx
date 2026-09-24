"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { runTestAction } from "./actions";
import { Button } from "@/components/ui";

// The two header actions. Run Test posts to the engine and lands on the run.
// Connect Agent shows the contract, because connecting is an endpoint, not a
// form: the harness POSTs turns to it and never holds a key.

export function RunTest({ agents, show = ["connect", "run"], runLabel = "Run Simulation", quiet = false }: { agents: { key: string; name: string; version: string }[]; show?: ("connect" | "run")[]; runLabel?: string; quiet?: boolean }) {
  const [open, setOpen] = useState<"run" | "connect" | null>(null);
  return (
    <div className="relative flex items-center gap-2">
      {show.includes("connect") && (
        <button type="button" onClick={() => setOpen(open === "connect" ? null : "connect")} className="rounded-[var(--radius-sm)] border border-line-2 bg-surface-2 px-3 py-1.5 text-[13px] font-medium hover:border-line-hover">
          Connect Agent
        </button>
      )}
      {show.includes("run") && (
        <button type="button" onClick={() => setOpen(open === "run" ? null : "run")} className={quiet ? "rounded-[var(--radius-sm)] border border-line-2 bg-surface-2 px-3 py-1.5 text-[13px] font-medium hover:border-line-hover" : "rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110"}>
          {runLabel}
        </button>
      )}

      {open === "run" && (
        <form action={runTestAction} className={`absolute ${quiet ? "left-0" : "right-0"} top-[calc(100%+8px)] z-20 w-[360px] rounded-[var(--radius)] border border-line-2 bg-surface p-4 text-[13px] shadow-2xl`}>
          <div className="mb-3 text-[14px] font-medium">Run a test</div>
          <label className="mb-2 grid gap-1">
            <span className="text-ink-3">reference agent</span>
            <select name="agent" defaultValue="careful">
              {agents.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name} v{a.version}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-2 grid gap-1">
            <span className="text-ink-3">or your agent&apos;s endpoint</span>
            <input name="endpoint" placeholder="http://localhost:9000/agent" className="mono" />
          </label>
          <label className="mb-3 grid grid-cols-[1fr_80px] items-center gap-2">
            <span className="text-ink-3">trials per scenario</span>
            <input type="number" name="trials" min={1} max={30} defaultValue={3} />
          </label>
          <Submit />
          <p className="mt-2 text-[11px] text-ink-3">Runs the open pool in the sandbox. Nothing is paid; every episode is graded from its tool calls and the run is sealed.</p>
        </form>
      )}

      {open === "connect" && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-[460px] rounded-[var(--radius)] border border-line-2 bg-surface p-4 text-[13px] shadow-2xl">
          <div className="mb-2 text-[14px] font-medium">Connect an agent</div>
          <p className="text-ink-2">
            An agent is an HTTP endpoint. Each step, the harness POSTs the task, the authorization, the documents, the tools and the history so far, and your agent replies with one step:
          </p>
          <pre className="mono mt-2 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11.5px] leading-snug text-ink-2">{`{ "type": "tool_call", "tool": "lookup_vendor", "args": { "name": "…" } }
{ "type": "finish", "action": "proceed" | "ask" | "refuse", "reason": "…" }`}</pre>
          <p className="mt-2 text-ink-2">Then run it from here with the endpoint field, or from the CLI:</p>
          <pre className="mono mt-1 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11.5px] text-ink-2">node src/lab-cli.ts run http://host/agent 3</pre>
          <p className="mt-2 text-[11px] text-ink-3">Your model key never leaves your side. The harness only sees the steps.</p>
        </div>
      )}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button tone="accent" disabled={pending}>
      {pending ? (
        <>
          <span className="running inline-block h-1.5 w-1.5 rounded-full bg-white" /> Running scenarios…
        </>
      ) : (
        "Run Simulation"
      )}
    </Button>
  );
}
