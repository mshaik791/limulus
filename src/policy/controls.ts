import { canonical, sha256 } from "../record.ts";

// Structured controls: the customer's own rules, in a shape the compiler can
// turn into tests. Five types to start, chosen because each one is something
// the graders can already assert deterministically. A control type that the
// graders cannot check would compile into scenarios nobody can fail, which is
// worse than not having the type.
//
// The blueprint lists eleven control types. The other six (required approver
// by role, separation of duties, timing/freshness, tool permission, permitted
// rail, human-escalation rule) need world or grader support that does not
// exist yet, and are refused by name rather than silently accepted.

export type ControlSeverity = "low" | "medium" | "high" | "critical";

type Base = {
  /** Lowercase letters, digits and hyphens. Becomes the prefix of every scenario id. */
  id: string;
  /** One line, as the customer would say it. Shown in reports. */
  name: string;
  severity?: ControlSeverity;
};

export type Control =
  /** Payments above `amount` need an approval on file. */
  | (Base & { type: "spending_threshold"; amount: number })
  /** Everything paid in one day must stay under `amount`. */
  | (Base & { type: "daily_ceiling"; amount: number })
  /** A change to where a vendor is paid must be verified out of band; a change inside the window is held. */
  | (Base & { type: "beneficiary_change"; verifyWithinDays?: number })
  /** Only vendors on file may be paid. */
  | (Base & { type: "vendor_allowlist" })
  /** An invoice is paid once. */
  | (Base & { type: "duplicate_payment" });

export type ControlType = Control["type"];

export const CONTROL_TYPES: Record<ControlType, { summary: string; parameters: string[]; cases: number }> = {
  spending_threshold: {
    summary: "Payments above an amount need an approval on file.",
    parameters: ["amount"],
    cases: 7,
  },
  daily_ceiling: {
    summary: "Everything paid in one day stays under a ceiling, however it is split.",
    parameters: ["amount"],
    cases: 3,
  },
  beneficiary_change: {
    summary: "A change to where a vendor is paid is verified out of band, and a recent change holds the payment.",
    parameters: ["verifyWithinDays (default 30)"],
    cases: 4,
  },
  vendor_allowlist: {
    summary: "Only vendors on file are paid, at the account on file.",
    parameters: [],
    cases: 4,
  },
  duplicate_payment: {
    summary: "An invoice is paid once, whatever the vendor's second notice says.",
    parameters: [],
    cases: 4,
  },
};

/** The types the blueprint names that this compiler does not yet support. Named so the error can say so. */
export const UNSUPPORTED_TYPES = [
  "required_approver",
  "separation_of_duties",
  "timing_freshness",
  "tool_permission",
  "permitted_rail",
  "human_escalation",
] as const;

export type PolicyProfile = {
  /** Customer-facing name, e.g. "Production controls v17". */
  name: string;
  version?: string;
  /** Where the controls came from: a document name, a ticket, a person. Recorded, not verified. */
  source?: string;
  controls: Control[];
};

export type Problem = { field: string; detail: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ID_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Content-addressed profile id: the same controls always get the same id, and
 * any change to a parameter produces a different one. A compiled scenario
 * carries this, so a suite can be traced to the exact controls that made it.
 */
export function policyProfileId(profile: PolicyProfile): string {
  return `ctl_${sha256(canonical({ name: profile.name, version: profile.version ?? null, controls: profile.controls })).slice(0, 16)}`;
}

/**
 * Parses a profile with the same strictness as a scenario file: unknown keys
 * are errors, because a misspelt parameter that is silently ignored compiles
 * into a suite that tests a rule nobody wrote.
 */
export function parsePolicyProfile(raw: unknown): { profile?: PolicyProfile; problems: Problem[] } {
  const problems: Problem[] = [];
  const err = (field: string, detail: string) => problems.push({ field, detail });

  if (!isObj(raw)) {
    err("", "the file must contain a single JSON object: { name, version?, source?, controls: [...] }");
    return { problems };
  }
  for (const key of Object.keys(raw)) {
    if (!["name", "version", "source", "controls"].includes(key)) err(key, `unknown field "${key}". Allowed: name, version, source, controls`);
  }
  if (typeof raw.name !== "string" || raw.name.trim() === "") err("name", "required: a short name for this set of controls");
  if (raw.version !== undefined && typeof raw.version !== "string") err("version", "must be a string");
  if (raw.source !== undefined && typeof raw.source !== "string") err("source", "must be a string");
  if (!Array.isArray(raw.controls) || raw.controls.length === 0) {
    err("controls", "required: a non-empty array of controls");
    return { problems };
  }

  const controls: Control[] = [];
  const seen = new Set<string>();
  raw.controls.forEach((c, i) => {
    const at = `controls[${i}]`;
    if (!isObj(c)) return err(at, "must be an object");
    const type = c.type;
    if (typeof type !== "string") return err(`${at}.type`, `required. One of: ${Object.keys(CONTROL_TYPES).join(", ")}`);
    if ((UNSUPPORTED_TYPES as readonly string[]).includes(type)) {
      return err(`${at}.type`, `"${type}" is a recognised control type that this compiler does not support yet. Supported: ${Object.keys(CONTROL_TYPES).join(", ")}`);
    }
    if (!(type in CONTROL_TYPES)) return err(`${at}.type`, `unknown type "${type}". One of: ${Object.keys(CONTROL_TYPES).join(", ")}`);

    const id = c.id;
    if (typeof id !== "string" || !ID_SHAPE.test(id)) err(`${at}.id`, `required: lowercase letters, digits and hyphens, got ${JSON.stringify(id)}`);
    else if (seen.has(id)) err(`${at}.id`, `duplicate control id "${id}"`);
    else seen.add(id);
    if (typeof c.name !== "string" || c.name.trim() === "") err(`${at}.name`, "required: the rule in one line, as the customer says it");
    if (c.severity !== undefined && !["low", "medium", "high", "critical"].includes(String(c.severity))) {
      err(`${at}.severity`, `must be one of low, medium, high, critical`);
    }

    const allowed = ["type", "id", "name", "severity", ...(CONTROL_TYPES[type as ControlType].parameters.map((p) => p.split(" ")[0]))];
    for (const key of Object.keys(c)) {
      if (!allowed.includes(key)) err(`${at}.${key}`, `unknown field "${key}" for a ${type} control. Allowed: ${allowed.join(", ")}`);
    }

    if (type === "spending_threshold" || type === "daily_ceiling") {
      if (typeof c.amount !== "number" || !(c.amount > 0) || !Number.isFinite(c.amount)) err(`${at}.amount`, "required: a positive number in the policy currency");
    }
    if (type === "beneficiary_change" && c.verifyWithinDays !== undefined) {
      if (typeof c.verifyWithinDays !== "number" || !(c.verifyWithinDays > 0)) err(`${at}.verifyWithinDays`, "must be a positive number of days");
    }

    if (problems.length === 0) controls.push(c as unknown as Control);
  });

  if (problems.length > 0) return { problems };
  return {
    profile: {
      name: raw.name as string,
      ...(raw.version ? { version: raw.version as string } : {}),
      ...(raw.source ? { source: raw.source as string } : {}),
      controls,
    },
    problems,
  };
}
