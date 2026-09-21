import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Authorization, Document, Vendor } from "../types.ts";
import type { ExpectedAction, RailEvent, Scenario, ScenarioCategory } from "./types.ts";

// Scenarios as files a customer keeps in their own repository.
//
// Until now a scenario was a TypeScript literal inside this package, which meant
// authoring one required importing our types and building our code. That kills
// two things we want: a customer writing their own institutional knowledge into
// our schema, and a CI job that runs a suite on every pull request.
//
// Why JSON and not YAML. This repository has no dependencies, so YAML would mean
// hand-rolling a parser. A YAML subset that silently misparses is the worst
// possible failure here: it does not crash, it produces a *different scenario*
// than the author wrote, and the result is a confident grade against a test case
// nobody intended. Five bugs in this project have had exactly that shape, and
// every one made an agent look worse than it was. JSON cannot misparse. Prose
// fields accept an array of strings so that long documents stay readable without
// giving up that guarantee.
//
// The validator is deliberately strict in two different ways:
//
//   Structurally — an unknown key is an error, not ignored. A scenario with
//   "expect" instead of "expected" must fail loudly rather than quietly default
//   to refusing, which would score every agent as wrong.
//
//   Semantically — a scenario that cannot be passed is rejected. If a scenario
//   expects a payment but no approved invoice appears in its documents, the
//   agent has no way to connect the approval to the paperwork, and the resulting
//   failure says nothing about the agent. Those checks are the same ones
//   fixture-audit.ts applies to our own pools, moved to load time so a customer
//   finds out when they write the file instead of when they read a bad score.

export type Problem = {
  /** Path of the file, relative to the directory that was loaded. */
  file: string;
  /** Dotted path to the offending field, e.g. "authorization.approvedVendors[0].name". */
  field: string;
  detail: string;
  severity: "error" | "warning";
};

export type LoadResult = {
  scenarios: Scenario[];
  problems: Problem[];
};

const CATEGORIES: ScenarioCategory[] = ["adversarial", "operational", "judgment", "context", "mandate"];
const ACTIONS: ExpectedAction[] = ["proceed", "ask", "refuse"];
const SEVERITIES: Scenario["severity"][] = ["low", "medium", "high", "critical"];
// Closed union in types.ts, so an unrecognised type is an error, not a warning.
const DOC_TYPES = ["invoice", "po", "email", "receipt", "other"];

const SCENARIO_KEYS = [
  "id", "category", "title", "intent", "severity", "task", "authorization",
  "documents", "railEvents", "expected", "truth", "rationale", "source",
  // Taxonomy tags, scope gating, and variant provenance. Optional, but allowed
  // so a customer file can carry them and a generated variant round-trips.
  "taxonomy", "scopeDimension", "variantOf", "operators", "variantSeed",
] as const;

const AUTH_KEYS = [
  "policyVersion", "principal", "task", "limitPerPayment", "limitPerDay",
  "currency", "approvedVendors", "approvedInvoices", "requiredChecks",
] as const;

const VENDOR_KEYS = ["vendorId", "name", "accountLast4", "bankDetailsUpdated", "callbackPhone"] as const;
const INVOICE_KEYS = ["invoiceId", "approvedBy", "amount", "poId"] as const;
const DOC_KEYS = ["name", "type", "text", "hiddenText"] as const;
const TRUTH_KEYS = ["invoiceId", "payeeName", "accountLast4", "amount", "currency"] as const;

/** Rail event variants, each with its own required and optional keys. */
const RAIL_EVENTS: Record<string, { required: string[]; optional: string[] }> = {
  return: { required: ["code", "description"], optional: [] },
  reversal: { required: ["reason"], optional: [] },
  timeout: { required: ["afterMs"], optional: [] },
  duplicate_settlement: { required: ["description"], optional: [] },
  partial_settlement: { required: ["settledAmount"], optional: [] },
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Prose fields may be a string or an array of strings, joined with newlines.
 * This is the one concession to readability: a two-paragraph invoice is painful
 * as a single JSON string and unreadable in a diff.
 */
function prose(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((l) => typeof l === "string")) return value.join("\n");
  return undefined;
}

class Checker {
  readonly problems: Problem[] = [];
  // Written out rather than a constructor parameter property: Node runs this
  // repository's TypeScript in strip-only mode, which cannot emit the implicit
  // assignment a parameter property needs.
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
  }

  err(field: string, detail: string) {
    this.problems.push({ file: this.file, field, detail, severity: "error" });
  }
  warn(field: string, detail: string) {
    this.problems.push({ file: this.file, field, detail, severity: "warning" });
  }
  get failed() {
    return this.problems.some((p) => p.severity === "error");
  }

  /** Rejects keys the schema does not define, so a typo cannot pass silently. */
  strictKeys(obj: Record<string, unknown>, allowed: readonly string[], at: string) {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        const near = allowed.find((a) => a.toLowerCase() === key.toLowerCase());
        this.err(
          at ? `${at}.${key}` : key,
          near
            ? `unknown field "${key}" — did you mean "${near}"? (case matters)`
            : `unknown field "${key}". Allowed here: ${allowed.join(", ")}`,
        );
      }
    }
  }

  str(obj: Record<string, unknown>, key: string, at: string, required = true): string | undefined {
    const raw = obj[key];
    const value = prose(raw);
    const field = at ? `${at}.${key}` : key;
    if (value === undefined) {
      if (required) this.err(field, raw === undefined ? "required, and missing" : `must be a string or an array of strings, got ${typeof raw}`);
      return undefined;
    }
    if (required && value.trim() === "") {
      this.err(field, "required, and empty");
      return undefined;
    }
    return value;
  }

  /**
   * Amounts must be plain numbers. A string like "61,400" is rejected rather
   * than coerced: Number("61,400") is NaN, and a NaN amount silently compares
   * false against every limit, so the scenario would appear to pass a ceiling
   * check it never actually tested.
   */
  num(obj: Record<string, unknown>, key: string, at: string, required = true): number | undefined {
    const raw = obj[key];
    const field = at ? `${at}.${key}` : key;
    if (raw === undefined) {
      if (required) this.err(field, "required, and missing");
      return undefined;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      this.err(
        field,
        typeof raw === "string"
          ? `must be a number, not the string ${JSON.stringify(raw)} — write ` +
            `${raw.replace(/[^0-9.]/g, "") || "the digits"} without quotes, commas or currency symbols`
          : `must be a finite number, got ${typeof raw}`,
      );
      return undefined;
    }
    if (raw < 0) this.err(field, "must not be negative");
    return raw;
  }

  oneOf<T extends string>(obj: Record<string, unknown>, key: string, allowed: readonly T[], at: string): T | undefined {
    const raw = obj[key];
    const field = at ? `${at}.${key}` : key;
    if (raw === undefined) {
      this.err(field, `required, and missing. One of: ${allowed.join(", ")}`);
      return undefined;
    }
    if (typeof raw !== "string" || !allowed.includes(raw as T)) {
      this.err(field, `must be one of ${allowed.join(", ")}, got ${JSON.stringify(raw)}`);
      return undefined;
    }
    return raw as T;
  }

  arr(obj: Record<string, unknown>, key: string, at: string, required = true): unknown[] | undefined {
    const raw = obj[key];
    const field = at ? `${at}.${key}` : key;
    if (raw === undefined) {
      if (required) this.err(field, "required, and missing");
      return undefined;
    }
    if (!Array.isArray(raw)) {
      this.err(field, `must be an array, got ${typeof raw}`);
      return undefined;
    }
    return raw;
  }
}

// ---------------------------------------------------------------- structure

function parseVendor(c: Checker, raw: unknown, at: string): Vendor | undefined {
  if (!isObj(raw)) {
    c.err(at, "must be an object");
    return undefined;
  }
  c.strictKeys(raw, VENDOR_KEYS, at);
  const vendorId = c.str(raw, "vendorId", at);
  const name = c.str(raw, "name", at);
  const accountLast4 = c.str(raw, "accountLast4", at);
  const bankDetailsUpdated = c.str(raw, "bankDetailsUpdated", at);
  const callbackPhone = c.str(raw, "callbackPhone", at, false);

  if (accountLast4 !== undefined && !/^\d{4}$/.test(accountLast4)) {
    c.err(`${at}.accountLast4`, `must be exactly four digits, got ${JSON.stringify(accountLast4)}`);
  }
  if (bankDetailsUpdated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(bankDetailsUpdated)) {
    c.err(`${at}.bankDetailsUpdated`, `must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(bankDetailsUpdated)}`);
  }
  if (!vendorId || !name || !accountLast4 || !bankDetailsUpdated) return undefined;
  return { vendorId, name, accountLast4, bankDetailsUpdated, callbackPhone };
}

function parseAuthorization(c: Checker, raw: unknown, at: string): Authorization | undefined {
  if (!isObj(raw)) {
    c.err(at, "required, and must be an object");
    return undefined;
  }
  c.strictKeys(raw, AUTH_KEYS, at);

  const policyVersion = c.str(raw, "policyVersion", at);
  const principal = c.str(raw, "principal", at);
  const task = c.str(raw, "task", at);
  const limitPerPayment = c.num(raw, "limitPerPayment", at);
  const limitPerDay = c.num(raw, "limitPerDay", at, false);
  const currency = c.str(raw, "currency", at);

  const vendorsRaw = c.arr(raw, "approvedVendors", at) ?? [];
  const approvedVendors: Vendor[] = [];
  vendorsRaw.forEach((v, i) => {
    const parsed = parseVendor(c, v, `${at}.approvedVendors[${i}]`);
    if (parsed) approvedVendors.push(parsed);
  });

  const invoicesRaw = c.arr(raw, "approvedInvoices", at) ?? [];
  const approvedInvoices: Authorization["approvedInvoices"] = [];
  invoicesRaw.forEach((inv, i) => {
    const iat = `${at}.approvedInvoices[${i}]`;
    if (!isObj(inv)) {
      c.err(iat, "must be an object");
      return;
    }
    c.strictKeys(inv, INVOICE_KEYS, iat);
    const invoiceId = c.str(inv, "invoiceId", iat);
    const approvedBy = c.str(inv, "approvedBy", iat);
    const amount = c.num(inv, "amount", iat);
    const poId = c.str(inv, "poId", iat, false);
    if (invoiceId && approvedBy && amount !== undefined) {
      approvedInvoices.push({ invoiceId, approvedBy, amount, poId });
    }
  });

  const checksRaw = c.arr(raw, "requiredChecks", at) ?? [];
  const requiredChecks = checksRaw.filter((x): x is string => typeof x === "string");
  if (requiredChecks.length !== checksRaw.length) {
    c.err(`${at}.requiredChecks`, "every entry must be a string");
  }

  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) {
    c.err(`${at}.currency`, `must be a three-letter ISO code such as USD, got ${JSON.stringify(currency)}`);
  }
  if (limitPerPayment !== undefined && limitPerDay !== undefined && limitPerDay < limitPerPayment) {
    c.warn(
      `${at}.limitPerDay`,
      `the daily ceiling (${limitPerDay}) is below the per-payment limit (${limitPerPayment}), so the ` +
        `per-payment limit can never be reached. Probably not what was meant.`,
    );
  }

  if (!policyVersion || !principal || !task || limitPerPayment === undefined || !currency) return undefined;
  return {
    policyVersion, principal, task, limitPerPayment, limitPerDay, currency,
    approvedVendors, approvedInvoices, requiredChecks,
  };
}

function parseDocuments(c: Checker, scenario: Record<string, unknown>): Document[] {
  const list = c.arr(scenario, "documents", "") ?? [];
  const docs: Document[] = [];
  list.forEach((d, i) => {
    const dat = `documents[${i}]`;
    if (!isObj(d)) {
      c.err(dat, "must be an object");
      return;
    }
    c.strictKeys(d, DOC_KEYS, dat);
    const name = c.str(d, "name", dat);
    const type = c.oneOf(d, "type", DOC_TYPES as readonly string[], dat);
    const text = c.str(d, "text", dat);
    const hiddenText = c.str(d, "hiddenText", dat, false);

    // hiddenText models text present in the file but not rendered — white text,
    // zero-size fonts, off-page. It is the injection surface, so it is worth
    // saying out loud when a scenario uses it.
    if (name && type && text !== undefined) {
      docs.push({ name, type, text, hiddenText } as Document);
    }
  });
  return docs;
}

function parseRailEvents(c: Checker, raw: unknown): RailEvent[] | undefined {
  if (raw === undefined) return undefined;
  const list = c.arr({ railEvents: raw }, "railEvents", "") ?? [];
  const events: RailEvent[] = [];
  list.forEach((e, i) => {
    const eat = `railEvents[${i}]`;
    if (!isObj(e)) {
      c.err(eat, "must be an object");
      return;
    }
    const type = e.type;
    if (typeof type !== "string" || !(type in RAIL_EVENTS)) {
      c.err(`${eat}.type`, `must be one of ${Object.keys(RAIL_EVENTS).join(", ")}, got ${JSON.stringify(type)}`);
      return;
    }
    const spec = RAIL_EVENTS[type];
    c.strictKeys(e, ["type", ...spec.required, ...spec.optional], eat);
    for (const key of spec.required) {
      if (e[key] === undefined) c.err(`${eat}.${key}`, `required for a "${type}" event`);
    }
    if (type === "timeout") c.num(e, "afterMs", eat);
    if (type === "partial_settlement") c.num(e, "settledAmount", eat);
    events.push(e as unknown as RailEvent);
  });
  return events;
}

function parseTruth(c: Checker, raw: unknown): Scenario["truth"] | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) {
    c.err("truth", "must be an object");
    return undefined;
  }
  c.strictKeys(raw, TRUTH_KEYS, "truth");
  const truth: NonNullable<Scenario["truth"]> = {};
  const invoiceId = c.str(raw, "invoiceId", "truth", false);
  const payeeName = c.str(raw, "payeeName", "truth", false);
  const accountLast4 = c.str(raw, "accountLast4", "truth", false);
  const currency = c.str(raw, "currency", "truth", false);
  const amount = raw.amount === undefined ? undefined : c.num(raw, "amount", "truth", false);
  if (accountLast4 !== undefined && !/^\d{4}$/.test(accountLast4)) {
    c.err("truth.accountLast4", `must be exactly four digits, got ${JSON.stringify(accountLast4)}`);
  }
  if (invoiceId) truth.invoiceId = invoiceId;
  if (payeeName) truth.payeeName = payeeName;
  if (accountLast4) truth.accountLast4 = accountLast4;
  if (currency) truth.currency = currency;
  if (amount !== undefined) truth.amount = amount;
  return truth;
}

// ---------------------------------------------------------------- semantics

/**
 * Checks that a scenario is answerable at all. These are the same rules
 * fixture-audit.ts applies to our own pools, run at load time so a
 * customer-authored scenario fails when it is written rather than producing a
 * failure that looks like the agent's fault.
 */
function checkAnswerable(c: Checker, s: Scenario) {
  const text = s.documents.map((d) => `${d.text ?? ""} ${d.hiddenText ?? ""}`).join(" ");
  const approved = s.authorization.approvedInvoices;

  if (s.expected === "proceed") {
    if (approved.length === 0) {
      c.err(
        "expected",
        `this scenario expects the agent to pay, but authorization.approvedInvoices is empty — ` +
          `there is nothing for it to pay against, so the scenario cannot be passed`,
      );
    } else if (!approved.some((a) => text.includes(a.invoiceId))) {
      c.err(
        "documents",
        `this scenario expects the agent to pay, but no approved invoice id ` +
          `(${approved.map((a) => a.invoiceId).join(", ")}) appears anywhere in the documents. ` +
          `The agent cannot connect the approval to the paperwork, so it will refuse and the ` +
          `failure will look like its fault`,
      );
    }
  }

  // A payee the authorization does not know is refused on vendor grounds, and
  // whatever the scenario meant to test is never reached. Scenarios that are
  // *about* the payee are the legitimate exception.
  const payee = s.truth?.payeeName;
  const vendorApproved = s.authorization.approvedVendors.some(
    (v) => v.name.toLowerCase() === (payee ?? "").toLowerCase(),
  );
  const aboutThePayee = ["authority", "sanctions", "payee", "vendor", "bank-change"].some((k) => s.id.includes(k));
  if (payee && !vendorApproved && !aboutThePayee && s.expected !== "refuse") {
    c.warn(
      "truth.payeeName",
      `"${payee}" is not in authorization.approvedVendors, so a refusal on vendor grounds will fire ` +
        `first and mask whatever this scenario tests. Add the vendor, or put "payee" or "vendor" in ` +
        `the scenario id to mark that as deliberate`,
    );
  }

  if (s.truth?.amount !== undefined && s.truth.amount > s.authorization.limitPerPayment && s.expected === "proceed") {
    c.err(
      "truth.amount",
      `${s.truth.amount} is above authorization.limitPerPayment (${s.authorization.limitPerPayment}), ` +
        `so the ceiling check fires first and the agent cannot pay as this scenario expects`,
    );
  }

  // An invoice approved for one amount but documented as another is a real
  // scenario shape, but only when the scenario expects something other than a
  // clean payment. Flag the combination that cannot be satisfied.
  const matching = approved.find((a) => s.truth?.invoiceId === a.invoiceId);
  if (matching && s.truth?.amount !== undefined && s.expected === "proceed" && matching.amount !== s.truth.amount) {
    c.warn(
      "truth.amount",
      `truth says ${s.truth.amount} but invoice ${matching.invoiceId} is approved for ${matching.amount}. ` +
        `If the mismatch is the point, this scenario should probably not expect "proceed"`,
    );
  }

  if ((s.railEvents ?? []).length > 0 && s.category !== "operational") {
    c.warn(
      "category",
      `this scenario injects rail events but is categorised "${s.category}". Recovery is scored from ` +
        `rail faults, and those are usually "operational"`,
    );
  }
}

// ---------------------------------------------------------------- entry points

/** Validates one parsed JSON value as a scenario. Returns problems, never throws. */
export function parseScenario(raw: unknown, file: string): { scenario?: Scenario; problems: Problem[] } {
  const c = new Checker(file);
  if (!isObj(raw)) {
    c.err("", "the file must contain a single JSON object describing one scenario");
    return { problems: c.problems };
  }
  c.strictKeys(raw, SCENARIO_KEYS, "");

  const id = c.str(raw, "id", "");
  const category = c.oneOf(raw, "category", CATEGORIES, "");
  const title = c.str(raw, "title", "");
  const intent = c.str(raw, "intent", "");
  const severity = c.oneOf(raw, "severity", SEVERITIES, "");
  const task = c.str(raw, "task", "");
  const expected = c.oneOf(raw, "expected", ACTIONS, "");
  const rationale = c.str(raw, "rationale", "");
  const source = c.str(raw, "source", "");
  const authorization = parseAuthorization(c, raw.authorization, "authorization");
  const documents = parseDocuments(c, raw);
  const railEvents = parseRailEvents(c, raw.railEvents);
  const truth = parseTruth(c, raw.truth);

  // Optional metadata. String-array fields are filtered to strings; a stray
  // non-string is an error rather than silently dropped.
  const strArray = (key: string): string[] | undefined => {
    if (raw[key] === undefined) return undefined;
    const list = c.arr(raw, key, "", false) ?? [];
    const strings = list.filter((x): x is string => typeof x === "string");
    if (strings.length !== list.length) c.err(key, "every entry must be a string");
    return strings;
  };
  const taxonomy = strArray("taxonomy");
  const operators = strArray("operators");
  const variantOf = c.str(raw, "variantOf", "", false);
  const variantSeed = c.str(raw, "variantSeed", "", false);
  const scopeDimension = c.str(raw, "scopeDimension", "", false);

  if (id !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    c.err("id", `must be lowercase letters, digits and hyphens, got ${JSON.stringify(id)}`);
  }
  if (documents.length === 0 && !c.problems.some((p) => p.field.startsWith("documents"))) {
    c.err("documents", "a scenario needs at least one document — that is what the agent reads");
  }

  if (c.failed || !id || !category || !title || !intent || !severity || !task || !expected || !rationale || !source || !authorization) {
    return { problems: c.problems };
  }

  const scenario: Scenario = {
    id, category, title, intent, severity, task, authorization, documents,
    railEvents, expected, truth, rationale, source,
    ...(taxonomy ? { taxonomy } : {}),
    ...(operators ? { operators } : {}),
    ...(variantOf ? { variantOf } : {}),
    ...(variantSeed ? { variantSeed } : {}),
    ...(scopeDimension ? { scopeDimension: scopeDimension as Scenario["scopeDimension"] } : {}),
  };
  checkAnswerable(c, scenario);

  // Semantic errors invalidate the scenario; warnings do not.
  return { scenario: c.failed ? undefined : scenario, problems: c.problems };
}

/** Reads one scenario file from disk. */
export function loadScenarioFile(path: string, base = ""): { scenario?: Scenario; problems: Problem[] } {
  const file = base ? relative(base, path) : path;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return {
      problems: [{ file, field: "", detail: `not valid JSON: ${(e as Error).message}`, severity: "error" }],
    };
  }
  return parseScenario(raw, file);
}

/**
 * Loads every *.scenario.json under a directory, recursively. Duplicate ids are
 * an error: two scenarios with one id means results silently overwrite each
 * other and a suite quietly shrinks.
 */
export function loadScenarioDir(dir: string): LoadResult {
  const scenarios: Scenario[] = [];
  const problems: Problem[] = [];
  const seen = new Map<string, string>();

  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".scenario.json")) continue;
      const { scenario, problems: found } = loadScenarioFile(full, dir);
      problems.push(...found);
      if (!scenario) continue;

      const previous = seen.get(scenario.id);
      if (previous) {
        problems.push({
          file: relative(dir, full),
          field: "id",
          detail: `duplicate id "${scenario.id}" — already defined in ${previous}. Results would overwrite each other.`,
          severity: "error",
        });
        continue;
      }
      seen.set(scenario.id, relative(dir, full));
      scenarios.push(scenario);
    }
  };

  walk(dir);
  return { scenarios, problems };
}

/** Renders a scenario back to the file format, for twin generation and export. */
export function toScenarioFile(s: Scenario): string {
  const ordered: Record<string, unknown> = {};
  for (const key of SCENARIO_KEYS) {
    const value = (s as unknown as Record<string, unknown>)[key];
    if (value !== undefined) ordered[key] = value;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
