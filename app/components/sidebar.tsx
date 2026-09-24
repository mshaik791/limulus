"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, AlertTriangle, Eye, FileLock2, GitCompare, LayoutGrid, PlayCircle, Shield, ShieldCheck, FileText } from "lucide-react";
import type { ComponentType } from "react";

type Item = { href: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; group?: string };

export const LABS_NAV: Item[] = [
  { href: "/labs", label: "Overview", icon: LayoutGrid },
  { href: "/labs/tests", label: "Tests", icon: PlayCircle },
  { href: "/labs/arena", label: "Model Arena", icon: GitCompare },
  { href: "/labs/releases", label: "Releases", icon: ShieldCheck },
  { href: "/labs/policies", label: "Policies", icon: FileText, group: "Controls" },
  { href: "/labs/qualifications", label: "Assurance Checks", icon: Shield, group: "Controls" },
];
export const CORE_NAV: Item[] = [
  { href: "/production", label: "Shadow Mode", icon: Eye },
  { href: "/decisions", label: "Production", icon: Activity },
  { href: "/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/evidence", label: "Evidence", icon: FileLock2 },
];

export const isLabsPath = (path: string) => path.startsWith("/labs");

export function Sidebar({ engine, sandbox, rail }: { engine: { ok: boolean; version: string; keyed: boolean } | null; sandbox: boolean; rail: string }) {
  const path = usePathname();
  const inLabs = isLabsPath(path);
  const items = inLabs ? LABS_NAV : CORE_NAV;
  return (
    <aside className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <Mark />
        <div>
          <div className="text-[15px] font-semibold leading-tight">Limulus</div>
          <div className="text-[11px] leading-tight text-ink-3">Financial Agent Assurance</div>
        </div>
      </div>

      <div className="mx-3 mb-4 grid grid-cols-2 rounded-[9px] border border-line bg-sunken p-[3px] text-[12px]">
        <Link href="/labs" className={`rounded-[6px] py-1.5 text-center transition-colors ${inLabs ? "bg-surface-3 font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-ink-3 hover:text-ink-2"}`}>
          Labs
        </Link>
        <Link href="/production" className={`rounded-[6px] py-1.5 text-center transition-colors ${!inLabs ? "bg-surface-3 font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-ink-3 hover:text-ink-2"}`}>
          Production
        </Link>
      </div>

      <nav className="px-3">
        <div className="eyebrow px-2 pb-1.5">{inLabs ? "Labs" : "Core"}</div>
        {items.map((it, i) => {
          const active = it.href === "/labs" ? path === "/labs" : path === it.href || path.startsWith(`${it.href}/`);
          const Icon = it.icon;
          const heading = it.group && items[i - 1]?.group !== it.group ? <div className="eyebrow px-2 pb-1.5 pt-4">{it.group}</div> : null;
          return (
            <div key={it.href}>
              {heading}
              <Link
                href={it.href}
                className={`mb-[2px] flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-[7px] text-[13px] transition-colors ${active ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface hover:text-ink"}`}
              >
                <Icon size={15} strokeWidth={1.75} className={active ? "text-accent-ink" : "text-ink-3"} />
                {it.label}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line px-5 py-4 text-[11.5px]">
        <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Workspace</div>
        <div className="mb-3 text-[13px] text-ink">Local</div>
        <div className="mb-2 flex items-center gap-2">
          {sandbox ? (
            <>
              <span className="rounded-[4px] bg-warn-soft px-1.5 py-[1px] text-[10px] font-semibold tracking-[0.08em] text-warn-ink">SANDBOX</span>
              <span className="text-ink-3">No payment rails connected</span>
            </>
          ) : (
            <>
              <span className="rounded-[4px] bg-good-soft px-1.5 py-[1px] text-[10px] font-semibold tracking-[0.08em] text-good-ink">PRODUCTION</span>
              <span className="text-ink-3">rail {rail}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-ink-2">
          <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${engine?.ok ? "bg-good" : "bg-crit"}`} />
          {engine?.ok ? `Engine operational · ${engine.version}${engine.keyed ? " · keyed" : ""}` : "Engine offline"}
        </div>
      </div>
    </aside>
  );
}

/** The horseshoe arc. Not a crab. */
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 26 26" aria-hidden>
      <path d="M4 20 V12 a9 9 0 0 1 18 0 V20" fill="none" stroke="var(--accent)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M9 20 V13 a4 4 0 0 1 8 0 V20" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}
