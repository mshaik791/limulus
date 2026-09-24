"use client";

import { useRouter } from "next/navigation";

// The agent under evaluation. A native select, so it works without a click
// handler chain; changing it re-reads the page for that agent.

export function AgentSelect({ value, options }: { value: string; options: { key: string; label: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-3 text-[13px]">
      <span className="text-ink-3">Agent</span>
      <select value={value} onChange={(e) => router.push(`/labs?agent=${encodeURIComponent(e.target.value)}`)} aria-label="agent under evaluation" className="min-w-[260px] text-[14px] font-medium">
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
