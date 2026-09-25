"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

export function AgentSelect({ value, name, options }: { value: string; name: string; options: { key: string; label: string; demo: boolean }[] }) {
  const router = useRouter();
  return <div className="labs-agent-select">
    <h1>{name}</h1><ChevronDown size={25} aria-hidden="true" />
    <select value={value} onChange={(e) => router.push(`/labs?agent=${encodeURIComponent(e.target.value)}`)} aria-label="Agent under evaluation">
      {[false, true].map((demo) => {
        const group = options.filter((o) => o.demo === demo);
        return group.length ? <optgroup key={String(demo)} label={demo ? "Demo agents" : "Connected agents"}>
          {group.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </optgroup> : null;
      })}
    </select>
  </div>;
}
