"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { BookOpen, Search } from "lucide-react";
import { runTestAction } from "@/app/labs/actions";
import { isLabsPath } from "./sidebar";

// The command bar: search everything the engine has sealed, and the one action
// that matters in this mode. Nothing here is decorative: there is no bell with
// nothing behind it and no avatar with no account. Search hits a route handler
// that queries the engine; Run Simulation posts a run; Connect Agent shows the
// contract, because connecting is an endpoint, not a form.

type Hit = { kind: string; label: string; sub?: string; href: string };

export function CommandBar({ agents, engineOk }: { agents: { key: string; name: string; version: string }[]; engineOk: boolean }) {
  const path = usePathname();
  const labs = isLabsPath(path);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"run" | "connect" | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => input.current?.focus(), 0);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      const next = r.ok ? await r.json() : [];
      if (live) {
        setHits(next);
        setSel(0);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);
  const visible = open && q.trim().length >= 2 ? hits : [];

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  };

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-line bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] px-6 backdrop-blur">
      <div className="relative w-full max-w-[560px]">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setTimeout(() => input.current?.focus(), 0);
          }}
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-sunken px-3 py-1.5 text-left text-[13px] text-ink-3 hover:border-line-hover"
        >
          <Search size={14} strokeWidth={1.75} />
          <span className="flex-1">Search agents, tests, incidents, transactions…</span>
          <kbd className="rounded border border-line-2 px-1.5 py-[1px] text-[10.5px] text-ink-3">⌘K</kbd>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] rounded-[var(--radius)] border border-line-2 bg-surface p-2 shadow-[var(--shadow)]">
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setSel((s) => Math.min(visible.length - 1, s + 1));
                if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
                if (e.key === "Enter" && visible[sel]) go(visible[sel]);
              }}
              placeholder="agent name, run id, scenario id, record id, invoice…"
              className="w-full"
              aria-label="search"
            />
            <ul className="mt-1 max-h-[360px] overflow-auto">
              {q.trim().length >= 2 && visible.length === 0 && <li className="px-2 py-3 text-[12.5px] text-ink-3">Nothing sealed matches that.</li>}
              {visible.map((h, i) => (
                <li key={h.href + h.label}>
                  <button type="button" onClick={() => go(h)} onMouseEnter={() => setSel(i)} className={`flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left text-[13px] ${i === sel ? "bg-accent-soft" : ""}`}>
                    <span className="w-[74px] shrink-0 text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{h.kind}</span>
                    <span className="truncate">{h.label}</span>
                    {h.sub && <span className="ml-auto truncate text-[12px] text-ink-3">{h.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {open && <button type="button" aria-label="close search" onClick={() => setOpen(false)} className="fixed inset-0 z-[-1] cursor-default" />}

      <div className="ml-auto flex items-center gap-2">
        <span className="rounded-[6px] border border-line px-2 py-1 text-[11px] text-ink-2">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle" />
          Sandbox
        </span>
        <Link href="https://github.com/mshaik791/limulus#readme" target="_blank" className="flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12.5px] text-ink-2 hover:bg-surface hover:text-ink">
          <BookOpen size={14} strokeWidth={1.75} /> Docs
        </Link>
        <div className="relative">
          {labs ? (
            <button type="button" disabled={!engineOk} onClick={() => setPanel(panel === "run" ? null : "run")} className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50">
              Run Simulation
            </button>
          ) : (
            <button type="button" onClick={() => setPanel(panel === "connect" ? null : "connect")} className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110">
              Connect Agent
            </button>
          )}
          {panel === "run" && (
            <form action={runTestAction} className="absolute right-0 top-[calc(100%+8px)] w-[380px] rounded-[var(--radius)] border border-line-2 bg-surface p-4 text-[13px] shadow-[var(--shadow)]">
              <div className="mb-3 text-[14px] font-medium">Run a simulation</div>
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
                <input name="endpoint" placeholder="http://localhost:9000/agent" />
              </label>
              <label className="mb-3 grid grid-cols-[1fr_80px] items-center gap-2">
                <span className="text-ink-3">trials per scenario</span>
                <input type="number" name="trials" min={1} max={30} defaultValue={3} />
              </label>
              <RunSubmit />
              <p className="mt-2 text-[11px] text-ink-3">Runs the open pool in the sandbox and seals the record. Nothing is paid.</p>
            </form>
          )}
          {panel === "connect" && (
            <div className="absolute right-0 top-[calc(100%+8px)] w-[480px] rounded-[var(--radius)] border border-line-2 bg-surface p-4 text-[13px] shadow-[var(--shadow)]">
              <div className="mb-2 text-[14px] font-medium">Connect a production agent</div>
              <p className="text-ink-2">Shadow mode takes each decision your system already made and re-decides it, read-only. Send the declaration, the payment order, the documents and what production did:</p>
              <pre className="mono mt-2 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11.5px] leading-snug text-ink-2">{`POST /v1/shadow/evaluate
{ "org": "acme", "agentId": "ap-agent",
  "declaration": {…}, "paymentOrder": {…}, "documents": […],
  "production": { "outcome": "released", "reference": "pay_…" } }`}</pre>
              <p className="mt-2 text-ink-2">For the Lab, an agent is an HTTP endpoint the harness POSTs turns to:</p>
              <pre className="mono mt-1 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11.5px] text-ink-2">node src/lab-cli.ts run http://host/agent 3</pre>
              <p className="mt-2 text-[11px] text-ink-3">No transaction is blocked while Shadow Mode is enabled. Your model key never leaves your side.</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function RunSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60">
      {pending ? (
        <>
          <span className="running mr-2 inline-block h-1.5 w-1.5 rounded-full bg-white align-middle" />
          Running scenarios…
        </>
      ) : (
        "Run Simulation"
      )}
    </button>
  );
}
