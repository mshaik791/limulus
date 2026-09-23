"use client";

import { useId, useState } from "react";
import { int } from "@/lib/format";

// The marks this console draws. A radar over the taxonomy families, a hoverable
// sparkline, grouped bars for arms. Text never wears a data colour; the colour
// sits in the mark beside it.

export type RadarAxis = { key: string; label: string; score: number | null; n: number; hint: string };

/**
 * Coverage over the failure families, 0–100, where 100 means no critical
 * violation in any episode that exercised that family. An axis with fewer than
 * the minimum trials is drawn hollow and says so: the radar never fills in a
 * number the engine did not measure. The list beside it carries every value
 * with its n, because a radar alone cannot.
 */
export function Radar({ axes, size = 300 }: { axes: RadarAxis[]; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const pad = 80;
  const w = size + pad * 2;
  const c = size / 2;
  const cx = c + pad;
  const r = c - 40;
  const k = axes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / k) * Math.PI * 2;
    return [cx + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  const measured = axes.map((a) => a.score !== null && a.n > 0);
  const poly = axes.map((a, i) => pt(i, measured[i] ? a.score! / 100 : 0));

  return (
    <div className="grid gap-4 md:grid-cols-[auto_1fr]">
      <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} role="img" aria-labelledby={id}>
        <title id={id}>Coverage by failure family</title>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <polygon key={g} points={axes.map((_, i) => pt(i, g).join(",")).join(" ")} fill="none" stroke="var(--line-2)" strokeWidth="1" />
        ))}
        {axes.map((_, i) => {
          const [x, y] = pt(i, 1);
          return <line key={i} x1={cx} y1={c} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />;
        })}
        <polygon points={poly.map((p) => p.join(",")).join(" ")} fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {axes.map((a, i) => {
          const [x, y] = poly[i];
          const [lx, ly] = pt(i, 1.14);
          const hot = hover === i;
          const anchor = lx < cx - 6 ? "end" : lx > cx + 6 ? "start" : "middle";
          return (
            <g key={a.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <circle cx={x} cy={y} r={hot ? 6 : 4.5} fill={measured[i] ? "var(--accent)" : "var(--surface)"} stroke={measured[i] ? "var(--surface)" : "var(--ink-3)"} strokeWidth="2" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize="10.5" fill={hot ? "var(--ink)" : "var(--ink-3)"}>
                {a.label}
              </text>
              <circle cx={x} cy={y} r="14" fill="transparent" />
            </g>
          );
        })}
      </svg>
      <ul className="grid content-start gap-1 text-[12.5px]">
        {axes.map((a, i) => (
          <li
            key={a.key}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`grid grid-cols-[1fr_auto] items-baseline gap-3 rounded-[6px] px-2 py-1 ${hover === i ? "bg-surface-3" : ""}`}
          >
            <span className="whitespace-nowrap text-ink-2">{a.label}</span>
            <span className="whitespace-nowrap tabular">
              {measured[i] ? (
                <>
                  <span className="font-semibold">{a.score}</span>
                  <span className="ml-1 text-[11px] text-ink-3">n={int(a.n)}</span>
                </>
              ) : (
                <span className="text-ink-3">{a.n > 0 ? `${int(a.n)} trials, too few` : "not exercised"}</span>
              )}
            </span>
            {hover === i && <span className="col-span-2 text-[11.5px] text-ink-3">{a.hint}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A 2px line over recent runs; hover shows the score of each. One series, so no legend. */
export function Sparkline({ values, labels, width = 120, height = 30, max = 100 }: { values: number[]; labels?: string[]; width?: number; height?: number; max?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return <span className="text-[11px] text-ink-3">{values.length === 1 ? "one run" : "no runs"}</span>;
  const pad = 4;
  const step = (width - pad * 2) / (values.length - 1);
  const y = (v: number) => height - pad - (Math.max(0, Math.min(max, v)) / max) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const i = hover ?? values.length - 1;
  return (
    <span className="relative inline-block" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${values.length} runs, latest ${values[values.length - 1]}`}>
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pad + i * step} cy={y(values[i])} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        {values.map((_, j) => (
          <rect key={j} x={pad + j * step - step / 2} y={0} width={step} height={height} fill="transparent" onMouseEnter={() => setHover(j)} />
        ))}
      </svg>
      {hover !== null && (
        <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[4px] border border-line-2 bg-surface-3 px-1.5 py-[1px] text-[10.5px] text-ink">
          {labels?.[hover] ? `${labels[hover]} · ` : ""}
          {values[hover]}
        </span>
      )}
    </span>
  );
}

const AXES: { key: "safety" | "capability" | "recovery" | "reliability"; label: string }[] = [
  { key: "safety", label: "Safety" },
  { key: "capability", label: "Capability" },
  { key: "recovery", label: "Recovery" },
  { key: "reliability", label: "Reliability" },
];

/** Grouped horizontal bars, one bar per arm, arm colours in fixed order. */
export function ArmBars({ arms }: { arms: { label: string; axes: Record<"safety" | "capability" | "recovery", { score: number; n: number }> & { reliability: { score: number; n: number } | null } }[] }) {
  return (
    <div className="grid gap-4">
      {AXES.map(({ key, label }) => (
        <div key={key} className="grid grid-cols-[100px_1fr] items-start gap-4">
          <div className="pt-0.5 text-[12.5px] text-ink-2">{label}</div>
          <div className="grid gap-[3px]">
            {arms.map((a, i) => {
              const r = a.axes[key];
              return (
                <div key={a.label} className="grid grid-cols-[1fr_90px] items-center gap-2">
                  <div className="relative h-[7px] overflow-hidden rounded-full bg-surface-3">
                    {r && r.n > 0 && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(1.5, r.score)}%`, background: `var(--arm-${(i % 4) + 1})` }} />}
                  </div>
                  <div className="text-[11px] tabular text-ink-3">{r && r.n > 0 ? `${r.score}  n=${r.n}` : "not measured"}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ArmSwatch({ index }: { index: number }) {
  return <span aria-hidden className="inline-block h-[10px] w-[10px] rounded-[2px] align-middle" style={{ background: `var(--arm-${(index % 4) + 1})` }} />;
}
