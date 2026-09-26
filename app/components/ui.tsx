import Link from "next/link";
import type { ReactNode } from "react";
import { int } from "@/lib/format";
import { LimulusMark } from "./logo";

// The design-system layer. Pages compose these and add nothing of their own.
// Two rules hold everywhere: a status colour never appears without its word,
// and a rate never appears without its n.

// ---- surfaces ------------------------------------------------------------------

export type Tone = "neutral" | "accent" | "good" | "warn" | "crit" | "model";

export function Card({
  title,
  aside,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** Retired: a card never earns attention through a coloured ring. Hierarchy is typographic. */
  emphasis?: Tone;
}) {
  return (
    <section className={`glass min-w-0 rounded-[var(--radius)] border border-line bg-surface ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-4 px-5 pt-4 pb-1">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          {aside && <div className="text-[12px] text-ink-3">{aside}</div>}
        </header>
      )}
      <div className={padded ? "px-5 pb-5 pt-2.5" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The persistent sandbox strip. The one place the design spends boldness:
    every other surface stays quiet so this line is unmissable and unambiguous. */
export function EnvBar({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-[color:rgba(176,124,29,0.35)] bg-warn-soft px-3 py-2 text-[12.5px] text-ink-2">
      <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full bg-warn" />
      <span className="font-semibold text-ink">Sandbox — no real money moves.</span>
      <span className="min-w-0">{children ?? "Every financial outcome on this screen is simulated."}</span>
    </div>
  );
}

// ---- state --------------------------------------------------------------------

// Path steps read as one calm sequence, not a traffic light: quiet outlined
// steps, the ink carrying only a whisper of state.
const toneClass: Record<Tone, string> = {
  neutral: "bg-surface text-ink-2 border-line",
  accent: "bg-surface text-accent-ink border-line",
  good: "bg-surface text-ink-2 border-line",
  warn: "bg-surface text-ink-2 border-line",
  crit: "bg-surface text-crit-ink border-line",
  model: "bg-surface text-ink-2 border-line",
};

// Status is a 6px dot and a plain word — the reference-class convention
// (Stripe, Mercury, Vanta). Colour appears in the dot and the word only; there
// is no filled chip, so a screen full of routine states stays quiet and the
// one failure is the only saturated object on it.
const dotTone: Record<Tone, string> = {
  neutral: "bg-ink-3",
  accent: "bg-accent",
  good: "bg-good",
  warn: "bg-warn",
  crit: "bg-crit",
  model: "bg-model",
};
const wordTone: Record<Tone, string> = {
  neutral: "text-ink-2",
  accent: "text-accent-ink",
  good: "text-good-ink",
  warn: "text-warn-ink",
  crit: "text-crit-ink",
  model: "text-model-ink",
};

/** A status word with its dot. No fill, no chip — the word carries the meaning. */
export function Pill({ tone = "neutral", children, mono = false, size = "sm" }: { tone?: Tone; children: ReactNode; mono?: boolean; size?: "sm" | "md" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium ${size === "md" ? "text-[12.5px]" : "text-[12px]"} ${wordTone[tone]} ${mono ? "mono" : ""}`}>
      <span aria-hidden className={`h-[6px] w-[6px] shrink-0 rounded-full ${dotTone[tone]}`} />
      {children}
    </span>
  );
}

/** The decision-state words. Uppercase, tracked, one colour each. */
export type DecisionState = "READY" | "REVIEW" | "BLOCKED" | "RELEASE" | "HOLD" | "ESCALATE" | "PASS" | "FAIL" | "OVERRIDDEN" | "RUNNING" | "NONE" | "INCIDENT";
const stateTone: Record<DecisionState, Tone> = {
  READY: "good",
  RELEASE: "good",
  PASS: "good",
  REVIEW: "warn",
  HOLD: "warn",
  ESCALATE: "warn",
  OVERRIDDEN: "warn",
  BLOCKED: "crit",
  FAIL: "crit",
  RUNNING: "accent",
  NONE: "neutral",
  INCIDENT: "crit",
};

/** The decision word for a payment outcome, phrased for the environment: in the sandbox nothing was released, it would have been. */
export const decisionState = (outcome: "released" | "held" | "escalated", sandbox: boolean): { state: DecisionState; label: string } =>
  outcome === "released" ? { state: "RELEASE", label: sandbox ? "Would release" : "Released" } : outcome === "held" ? { state: "HOLD", label: sandbox ? "Would hold" : "Held" } : { state: "ESCALATE", label: sandbox ? "Would escalate" : "Escalated" };
/** Row-level: dot + word. Page-level (`size="lg"`): the one outlined pill a
    screen is allowed — white ground, hairline border, dot + word inside. */
export function StateBadge({ state, label, size = "md" }: { state: DecisionState; label?: string; size?: "md" | "lg" }) {
  const tone = stateTone[state];
  const text = label ?? state.charAt(0) + state.slice(1).toLowerCase();
  if (size === "lg") {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12.5px] font-medium ${wordTone[tone]}`}>
        <span aria-hidden className={`h-[6px] w-[6px] shrink-0 rounded-full ${dotTone[tone]}`} />
        {text}
      </span>
    );
  }
  return <Pill tone={tone}>{text}</Pill>;
}

export const toneForVerdict = (v: string): Tone =>
  ["pass", "released", "verified", "agree", "proceed", "allow", "valid", "confirmed"].includes(v)
    ? "good"
    : ["overridden", "escalated", "review", "ask", "would_have_escalated", "flaky", "would_have_released", "expired", "unsure", "pending", "unsettled"].includes(v)
      ? "warn"
      : ["fail", "critical", "held", "block", "would_have_held", "refuse", "unauthorized", "revoked", "duplicate", "mismatch", "returned", "rejected"].includes(v)
        ? "crit"
        : "neutral";

export const toneForSeverity = (s: string): Tone => (s === "critical" ? "crit" : s === "high" ? "warn" : "neutral");

// ---- figures ------------------------------------------------------------------

/** A score and how many episodes it rests on. Never one without the other. */
export function Rate({ score, n, big = false }: { score: number | null; n: number; big?: boolean }) {
  if (score === null || n === 0) return <span className={`text-ink-3 ${big ? "text-[22px]" : ""}`}>not measured</span>;
  return (
    <span className="tabular">
      <span className={`font-semibold ${big ? "text-[26px] leading-none" : ""}`}>{score}</span>
      <span className="ml-1.5 text-[11px] text-ink-3">n={int(n)}</span>
    </span>
  );
}

/** label · value · sub. The value is prominent; the detail is small and muted. */
export function Metric({ label, value, sub, size = "md" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; size?: "md" | "lg" }) {
  return (
    <div>
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`metric mt-1 leading-none text-ink ${size === "lg" ? "text-[40px]" : "text-[28px]"}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** A metric row: label, value with n, and a hairline bar. Not a bare bar. */
export function MetricRow({ label, hint, score, n, tone = "accent" }: { label: string; hint?: string; score: number | null; n: number; tone?: Tone }) {
  const measured = score !== null && n > 0;
  return (
    <div className="grid grid-cols-[120px_1fr_110px] items-center gap-4 py-1.5" title={hint}>
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="relative h-[6px] overflow-hidden rounded-full bg-surface-3">
        {measured && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(1.5, score!)}%`, background: `var(--${tone})` }} />}
      </div>
      <div className="text-right">
        <Rate score={measured ? score : null} n={n} />
      </div>
    </div>
  );
}

export function Delta({ value, upIsGood = true, suffix = "" }: { value: number | null; upIsGood?: boolean; suffix?: string }) {
  if (value === null) return <span className="text-ink-3">–</span>;
  if (value === 0) return <span className="text-ink-3 tabular">±0{suffix}</span>;
  const good = upIsGood ? value > 0 : value < 0;
  return (
    <span className={`tabular ${good ? "text-good-ink" : "text-crit-ink"}`}>
      {value > 0 ? "↑" : "↓"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

// ---- text ---------------------------------------------------------------------

export function EmptyState({ title, body, cta, ctaHref, code }: { title: string; body?: ReactNode; cta?: string; ctaHref?: string; code?: string }) {
  return (
    <div className="glass rounded-[var(--radius)] border border-line px-6 py-10 text-center">
      <LimulusMark size={30} className="mx-auto mb-3 opacity-30" />
      <div className="text-[15px] font-medium">{title}</div>
      {body && <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] text-ink-3">{body}</p>}
      {code &&
        (code.includes("\n") ? (
          <pre className="mono mt-3 overflow-x-auto rounded-[var(--radius-sm)] bg-sunken px-3 py-2 text-left text-[11.5px] leading-relaxed text-ink-2">{code}</pre>
        ) : (
          <code className="mono mt-3 inline-block rounded-[var(--radius-sm)] bg-sunken px-2 py-1 text-[12px] text-ink-2">{code}</code>
        ))}
      {cta && ctaHref && (
        <div className="mt-4">
          <LinkButton href={ctaHref} tone="accent">
            {cta}
          </LinkButton>
        </div>
      )}
    </div>
  );
}

export function Offline() {
  return (
    <EmptyState
      title="The engine is not reachable"
      body="The console reads signed records from the engine and shows nothing it did not compute. Start the engine, or point LIMULUS_API at where it runs."
      code="node src/server.ts"
    />
  );
}

/** Contextual prose. Never a coloured box — a warn/crit note gets a 2px left
    rule in the state colour; the body stays quiet gray text. */
export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const rule = tone === "crit" ? "border-l-2 border-l-crit" : tone === "warn" ? "border-l-2 border-l-warn" : tone === "good" ? "border-l-2 border-l-good" : "";
  return <p className={`rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink-2 ${rule}`}>{children}</p>;
}

export function KV({ rows, dense = false }: { rows: [ReactNode, ReactNode][]; dense?: boolean }) {
  return (
    <dl className={`grid grid-cols-[max-content_1fr] gap-x-5 text-[13px] ${dense ? "gap-y-1" : "gap-y-2"}`}>
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

// ---- actions ------------------------------------------------------------------

const btn = (tone: "neutral" | "accent" | "crit") =>
  `inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 ${
    tone === "accent"
      ? "border-accent bg-accent text-white hover:brightness-110"
      : tone === "crit"
        ? "border-line-2 bg-surface text-crit-ink hover:border-crit/50"
        : "border-line-2 bg-surface text-ink hover:border-line-hover"
  }`;

export function Button({ children, tone = "neutral", type = "submit", disabled }: { children: ReactNode; tone?: "neutral" | "accent" | "crit"; type?: "submit" | "button"; disabled?: boolean }) {
  return (
    <button type={type} disabled={disabled} className={btn(tone)}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, tone = "neutral" }: { href: string; children: ReactNode; tone?: "neutral" | "accent" | "crit" }) {
  return (
    <Link href={href} className={btn(tone)}>
      {children}
    </Link>
  );
}

/** Tabs are links with a query parameter, so every tab is a URL. */
export function Tabs({ tabs, active, base }: { tabs: { key: string; label: string; count?: number }[]; active: string; base: string }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.key === tabs[0].key ? base : `${base}?tab=${t.key}`}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${active === t.key ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-[11px] text-ink-3">{int(t.count)}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** The recurring motif: Agent → Evidence → Policy → Decision → Payment. */
export function ExecutionPath({ steps }: { steps: { label: string; tone?: Tone; sub?: string }[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[12px]">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span className={`rounded-[6px] border px-2 py-1 ${toneClass[s.tone ?? "neutral"]}`}>
            {s.label}
            {s.sub && <span className="ml-1 opacity-70">{s.sub}</span>}
          </span>
          {i < steps.length - 1 && <span aria-hidden className="text-ink-3">→</span>}
        </li>
      ))}
    </ol>
  );
}
