import Link from "next/link";
import type { ReactNode } from "react";
import { int, ofN } from "@/lib/format";

// Small, boring primitives. Every status colour arrives with its word; every
// rate arrives with its n. Screens compose these and add nothing of their own.

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--radius)] border border-line bg-surface ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-medium text-ink-2">{title}</h2>
          {aside && <div className="text-[12px] text-ink-3">{aside}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = "neutral" | "accent" | "good" | "warn" | "crit";

const toneClass: Record<Tone, string> = {
  neutral: "bg-raised text-ink-2 border-line-strong",
  accent: "bg-accent-soft text-accent-ink border-transparent",
  good: "bg-good-soft text-good-ink border-transparent",
  warn: "bg-warn-soft text-warn-ink border-transparent",
  crit: "bg-crit-soft text-crit-ink border-transparent",
};

const toneGlyph: Record<Tone, string> = { neutral: "·", accent: "●", good: "✓", warn: "!", crit: "✕" };

/** A word with its colour. The glyph means a screenshot in grayscale still reads. */
export function Pill({ tone = "neutral", children, mono = false }: { tone?: Tone; children: ReactNode; mono?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[12px] font-medium leading-4 ${toneClass[tone]} ${mono ? "mono" : ""}`}>
      <span aria-hidden className="text-[10px]">{toneGlyph[tone]}</span>
      {children}
    </span>
  );
}

export const toneForVerdict = (v: string): Tone =>
  v === "pass" || v === "released" || v === "verified" || v === "agree" || v === "proceed" || v === "allow"
    ? "good"
    : v === "overridden" || v === "escalated" || v === "review" || v === "ask" || v === "would_have_escalated" || v === "flaky" || v === "would_have_released"
      ? "warn"
      : v === "fail" || v === "critical" || v === "held" || v === "block" || v === "would_have_held" || v === "refuse" || v === "unauthorized"
        ? "crit"
        : "neutral";

export const toneForSeverity = (s: string): Tone => (s === "critical" ? "crit" : s === "high" ? "warn" : "neutral");

/** A score and how many episodes it rests on. Never one without the other. */
export function Rate({ score, n, label }: { score: number | null; n: number; label?: string }) {
  if (score === null || n === 0) {
    return (
      <span className="text-ink-3">
        {label && <span className="mr-1.5">{label}</span>}–<span className="ml-1 text-[11px]">(n=0)</span>
      </span>
    );
  }
  return (
    <span className="tabular">
      {label && <span className="mr-1.5 text-ink-3">{label}</span>}
      <span className="font-medium">{score}</span>
      <span className="ml-1 text-[11px] text-ink-3">(n={int(n)})</span>
    </span>
  );
}

export function Counted({ value, of }: { value: number; of: number }) {
  return <span className="tabular">{ofN(value, of)}</span>;
}

/** The single number a tile leads with. Proportional digits, as a hero figure should be. */
export function Stat({ label, value, sub, tone = "neutral", href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <div className="rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`mt-1 text-[26px] font-semibold leading-none tracking-tight ${tone === "crit" ? "text-crit-ink" : tone === "warn" ? "text-warn-ink" : tone === "good" ? "text-good-ink" : ""}`}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:[&>div]:border-line-strong">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-ink-3">{children}</div>;
}

export function Offline() {
  return (
    <Empty>
      The engine is not reachable. Start it with <code className="mono">node src/server.ts</code> in the repository, or set <code className="mono">LIMULUS_API</code> to where it runs.
    </Empty>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Hash({ value, n = 16 }: { value: string; n?: number }) {
  return (
    <span className="mono text-ink-2" title={value}>
      {value.slice(0, n)}
      {value.length > n ? "…" : ""}
    </span>
  );
}

/** A sandbox bar above anything whose amounts are simulated. Required by the register. */
export function SandboxBar({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 rounded-[var(--radius-sm)] border border-warn/30 bg-warn-soft px-3 py-1.5 text-[12px] text-warn-ink">
      Sandbox. {children ?? "Every amount on this page is simulated. No rail was called and no money moved."}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius-sm)] border border-line bg-sunken px-3 py-2 text-[12px] text-ink-2">{children}</p>;
}

export function Button({ children, tone = "neutral", type = "submit", disabled }: { children: ReactNode; tone?: "neutral" | "accent"; type?: "submit" | "button"; disabled?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-[13px] font-medium disabled:opacity-50 ${
        tone === "accent" ? "border-accent bg-accent text-white hover:brightness-110" : "border-line-strong bg-raised text-ink hover:border-accent"
      }`}
    >
      {children}
    </button>
  );
}
