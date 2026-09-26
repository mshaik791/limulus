import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, FlaskConical, GitCompare, ShieldAlert, ShieldCheck } from "lucide-react";
import { ago } from "@/lib/format";
import { Delta, LinkButton, type Tone } from "./ui";

// Larger composed blocks: metric cards, the activity feed, recommended
// actions, the execution graph. Each is fed from sealed records by the page
// that uses it; nothing in here fetches or invents.

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

const toneText: Record<Tone, string> = { neutral: "", accent: "text-accent-ink", good: "text-good-ink", warn: "text-warn-ink", crit: "text-crit-ink", model: "text-model-ink" };

/** A summary stat: label over an ink figure, plain text — the Mercury pattern.
    No tile border, no icon chip, no sparkline; the grid's own rhythm is the
    structure. Icon/tone/spark props are retained so call sites keep compiling
    while pages migrate, but they no longer render. */
export function MetricCard({
  label,
  value,
  sub,
  trend,
  href,
}: {
  icon?: Icon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: { value: number | null; upIsGood?: boolean; suffix?: string; label?: string };
  spark?: number[];
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <div className="min-w-0">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="metric mt-1 text-[24px] leading-none text-ink">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
        {trend && (
          <span>
            <Delta value={trend.value} upIsGood={trend.upIsGood} suffix={trend.suffix} /> {trend.label}
          </span>
        )}
        {sub}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-[var(--radius-sm)] transition-colors hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    body
  );
}

// ---- activity ---------------------------------------------------------------------

export type ActivityItem = { at: string; tone: Tone; kind: "run" | "gate" | "compare" | "shadow" | "incident" | "decision"; title: string; sub?: string; href: string };

const activityIcon: Record<ActivityItem["kind"], Icon> = { run: FlaskConical, gate: ShieldCheck, compare: GitCompare, shadow: Circle, incident: AlertTriangle, decision: ShieldAlert };

export function ActivityFeed({ items, empty }: { items: ActivityItem[]; empty?: string }) {
  if (items.length === 0) return <p className="text-[13px] text-ink-3">{empty ?? "Nothing yet."}</p>;
  return (
    <ol className="grid gap-1">
      {items.map((it, i) => {
        const I = it.tone === "good" ? CheckCircle2 : activityIcon[it.kind];
        return (
          <li key={i} className="rise min-w-0" style={{ animationDelay: `${i * 30}ms` }}>
            <Link href={it.href} className="flex min-w-0 items-start gap-3 overflow-hidden rounded-[var(--radius-sm)] px-2 py-2 transition-colors hover:bg-surface-2">
              <I size={14} strokeWidth={1.75} className={`mt-[3px] shrink-0 ${it.tone === "crit" ? "text-crit" : "text-ink-3"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{it.title}</span>
                {it.sub && <span className="block truncate text-[12px] text-ink-3">{it.sub}</span>}
              </span>
              <span className="shrink-0 text-[11.5px] text-ink-3">{ago(it.at)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

// ---- recommended actions ----------------------------------------------------------------

export type Recommendation = { title: string; reason: string; cta: string; href: string; tone: Tone };

export function RecommendedActions({ items }: { items: Recommendation[] }) {
  if (items.length === 0) return <p className="text-[13px] text-ink-3">Nothing is waiting on a person.</p>;
  return (
    <ol className="grid gap-2">
      {items.map((r) => (
        <li key={r.href + r.title} className="rounded-[var(--radius-sm)] border border-line bg-surface-2 px-3 py-2.5">
          <div className="flex items-start gap-2 text-[13px]">
            <span className={`mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${r.tone === "crit" ? "bg-crit" : r.tone === "warn" ? "bg-warn" : r.tone === "good" ? "bg-good" : "bg-accent"}`} />
            <span className="min-w-0">
              <span className="block">{r.title}</span>
              <span className="block text-[12px] text-ink-3">{r.reason}</span>
            </span>
          </div>
          <div className="mt-2 pl-3.5">
            <LinkButton href={r.href} tone={r.tone === "crit" ? "crit" : "neutral"}>
              {r.cta}
            </LinkButton>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- execution graph ----------------------------------------------------------------

export type GraphNode = { id: string; label: string; sub?: string; tone?: Tone; badge?: string; x: number; y: number };
export type GraphEdge = { from: string; to: string; tone?: Tone; broken?: boolean };

/**
 * The execution map. Nodes on a 0–100 grid, curved SVG paths between them,
 * blue for a normal path, red for a risky one, and a broken edge where the
 * rail was never reached. Every node and badge is a fact from the record the
 * page built it from; the page decides tones, not the graph.
 */
export function ExecutionGraph({ nodes, edges, height = 300 }: { nodes: GraphNode[]; edges: GraphEdge[]; height?: number }) {
  const W = 1000;
  const H = height;
  const px = (x: number) => (x / 100) * W;
  const py = (y: number) => (y / 100) * H;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Edges are neutral; the anomaly channel (crit) is the only coloured path.
  const stroke = (t?: Tone) => (t === "crit" ? "var(--crit)" : "var(--line-hover)");
  // Narrow screens scroll the map sideways rather than stacking its nodes on
  // top of each other; the positions are facts about the flow, not the screen.
  return (
    <div className="w-full overflow-x-auto">
    <div className="relative min-w-[1100px]" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="var(--line)" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" opacity="0.5" />
        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const x1 = px(a.x) + 70;
          const y1 = py(a.y);
          const x2 = px(b.x) - 70;
          const y2 = py(b.y);
          const mx = (x1 + x2) / 2;
          const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke={stroke(e.tone)} strokeWidth="1.6" opacity={e.broken ? 0.35 : 0.9} strokeDasharray={e.broken ? "4 6" : undefined} />
              {!e.broken && <path d={d} fill="none" stroke={stroke(e.tone)} strokeWidth="1.6" className="path-flow" opacity="0.55" />}
              {e.broken && (
                <g transform={`translate(${x2 - 14},${y2})`}>
                  <circle r="9" fill="var(--surface)" stroke="var(--crit)" strokeWidth="1.5" />
                  <path d="M-4,-4 L4,4 M4,-4 L-4,4" stroke="var(--crit)" strokeWidth="1.8" strokeLinecap="round" />
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {nodes.map((n) => (
        <div key={n.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${n.x}%`, top: `${n.y}%` }}>
          <div className={`w-[176px] rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-[var(--shadow)] ${n.tone === "crit" ? "border-crit/50" : "border-line-2"}`}>
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{n.label}</div>
            <div className="line-clamp-4 break-words text-[12.5px] leading-snug text-ink" title={n.sub}>
              {n.sub}
            </div>
            {n.badge && <div className={`mt-1 text-[10px] font-semibold tracking-[0.08em] ${toneText[n.tone ?? "neutral"] || "text-ink-2"}`}>{n.badge}</div>}
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}

export function StepArrow() {
  return <ArrowRight size={14} strokeWidth={1.75} className="text-ink-3" />;
}
