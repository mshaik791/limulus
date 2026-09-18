import { randomBytes } from "node:crypto";
import { FAMILIES, rngFrom } from "./families.ts";
import type { PooledScenario } from "./pools.ts";
import type { Scenario } from "./types.ts";

// Regenerates a failed scenario as a twin: the same trap, different particulars.
//
// This exists to resolve a direct conflict between two things we need.
//
// A customer who fails a scenario needs something they can run. A report saying
// "your agent paid a duplicate invoice" is a consulting deliverable; a file they
// can drop into their own CI and watch go red, then green, is a product. So the
// failure has to leave with them.
//
// But qualification failures come from the held-out pool, and the held-out pool
// is only worth something while the agent's authors have not seen it. Handing
// back the instance that failed — let alone encouraging them to fine-tune on it,
// which is the obvious next step — burns the measurement. Do that twelve times a
// year, which is what monthly requalification means, and within a year the
// customer has the whole exam and their score means nothing.
//
// The way out is that a scenario's value is in its *shape*, not its particulars.
// The trap in duplicate-disguised is "the same charge billed twice with nothing
// linking the two invoice numbers". Which vendor, which amount, which invoice
// numbers — all incidental. So the twin rebuilds the family from a fresh public
// salt: a scenario that fails an agent for the same reason, that the agent's
// authors may read, train on, and keep.
//
// Three properties this has to have, all checked rather than assumed:
//
//   The twin is a different instance. Same family, different particulars.
//   The twin is not derivable from the private seed, so holding a pile of twins
//     tells you nothing about what is in the next cohort.
//   Nothing that identifies the held-out instance appears in what leaves.
//
// The last one is enforced in failure-bundle.ts, which refuses to write a bundle
// containing held-out particulars. Note the word: particulars, not prose. A
// family's wording is shared by every instance by design and families.ts is
// public, so a twin reading like its original is the twin working. What must not
// travel are the generated invoice numbers, amounts and dates that identify this
// cohort. See heldOutSecrets below.

export type Twin = {
  scenario: Scenario;
  /** The family both scenarios are instances of. */
  family: string;
  /** Public salt this twin was generated from. Recorded so it can be rebuilt. */
  salt: string;
  /** Id of the held-out scenario this twin stands in for. */
  standsInFor: string;
};

/**
 * The family a generated scenario belongs to, read off its id.
 *
 * Held-out ids are `held-<family>-<n>-<cohort>`, and family keys contain hyphens
 * too, so this matches against the known family list rather than splitting on
 * hyphens — which would read "held-threshold-split-2-c1" as family "threshold".
 */
export function familyOf(scenarioId: string): string | undefined {
  const candidates = FAMILIES.map((f) => f.key)
    .filter((key) => scenarioId.startsWith(`held-${key}-`))
    // Longest match wins, so a family key that is a prefix of another cannot
    // shadow it.
    .sort((a, b) => b.length - a.length);
  return candidates[0];
}

/**
 * Builds a twin of a scenario the agent failed.
 *
 * The salt is public and random by default. It is deliberately *not* derived
 * from the held-out seed: if it were, a customer accumulating twins would be
 * accumulating information about the seed, and the held-out pool would decay
 * every time we helped someone.
 */
export function twinFor(failed: Pick<Scenario, "id">, options: { salt?: string } = {}): Twin {
  const familyKey = familyOf(failed.id);
  if (!familyKey) {
    throw new Error(
      `Cannot build a twin of "${failed.id}": it does not belong to a published family. ` +
        `Only generated scenarios have twins; a hand-written one has no shape to regenerate from.`,
    );
  }
  const family = FAMILIES.find((f) => f.key === familyKey)!;
  const salt = options.salt ?? randomBytes(12).toString("hex");

  // "twin" in the seed string keeps this namespace disjoint from the generator's
  // `${seed}:${cohort}:${family}:${n}`, so a twin can never collide with a
  // held-out instance by construction as well as by check.
  const rng = rngFrom(`twin:${salt}:${family.key}`);
  const built = family.build(rng, 1);

  const scenario: Scenario = {
    ...built,
    id: `twin-${family.key}-${salt.slice(0, 8)}`,
    category: family.category,
    severity: family.severity,
    expected: family.expected,
    source:
      `Limulus ${family.key} family. Regenerated stand-in for a scenario this agent failed: same ` +
      `failure mode, different particulars. Safe to read, run and train against — the scenario that ` +
      `produced the original result is not disclosed.`,
  };

  return { scenario, family: family.key, salt, standsInFor: failed.id };
}

/**
 * Confirms a twin is a real stand-in and not a copy.
 *
 * Compared on the same basis the pool leak check uses — task text plus document
 * text — because that is what an agent actually reads. Matching ids or matching
 * amounts would be a weaker test than matching prose.
 */
export function twinIsDistinct(twin: Scenario, original: PooledScenario | Scenario): { ok: boolean; reason?: string } {
  const prose = (s: Scenario) =>
    [s.task, ...s.documents.map((d) => `${d.text ?? ""}${d.hiddenText ?? ""}`)]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  if (prose(twin) === prose(original)) {
    return { ok: false, reason: "the twin reads identically to the scenario it stands in for" };
  }
  if (twin.id === original.id) {
    return { ok: false, reason: "the twin has the same id as the original" };
  }

  // The twin must still be the same *kind* of test, or it is not a stand-in.
  if (twin.expected !== original.expected) {
    return {
      ok: false,
      reason: `the twin expects "${twin.expected}" but the original expected "${original.expected}" — not the same test`,
    };
  }
  return { ok: true };
}

/**
 * What actually identifies a held-out instance, as strings that must not leave.
 *
 * The first version of this checked every sentence of held-out prose and blocked
 * every bundle, which was the right failure to hit early. A family's wording is
 * shared by all its instances by design — the trap in bank-change-hidden reads
 * much the same whichever vendor it names — and families.ts is committed and
 * public, so that wording is not a secret and a twin reproducing it is the twin
 * working correctly.
 *
 * What is secret is the particulars: the invoice numbers, amounts and dates the
 * seeded generator produced for this cohort. Those identify the instance, they
 * are what an agent would memorise, and they cannot be derived from anything
 * public. So those are what we refuse to ship.
 *
 * Vendor names sit in between: they are drawn from a published list, so any one
 * name is public, but which vendor appears with which invoice in this cohort is
 * not. Names are therefore checked in combination — as part of a sentence that
 * is unique to the instance — rather than on their own, which would block every
 * bundle again for no gain.
 */
export function heldOutSecrets(
  held: (PooledScenario | Scenario)[],
  publicSamples: Scenario[] = [],
): string[] {
  const secrets = new Set<string>();

  // Identifier-shaped tokens that a public regeneration also produces are
  // constants in families.ts, not per-instance values. PO-44812 is written into
  // the family source and appears in every instance, so treating it as a secret
  // would block every bundle over a string anyone can read in the repository.
  const publicTokens = new Set<string>();
  for (const s of publicSamples) {
    const prose = [s.task, ...s.documents.map((d) => `${d.text ?? ""} ${d.hiddenText ?? ""}`)].join(" ");
    for (const token of prose.match(/\b[A-Z]{2,6}-[0-9][0-9A-Z-]*\b/g) ?? []) {
      publicTokens.add(token.toLowerCase());
    }
    for (const inv of s.authorization.approvedInvoices) {
      if (inv.invoiceId) publicTokens.add(inv.invoiceId.toLowerCase());
      if (inv.poId) publicTokens.add(inv.poId.toLowerCase());
    }
  }

  for (const s of held) {
    // Generated identifiers. These are the strongest signal and the cheapest to
    // check: an invoice id from a held-out instance has no business anywhere in
    // something we hand over.
    for (const inv of s.authorization.approvedInvoices) {
      if (inv.invoiceId) secrets.add(inv.invoiceId.toLowerCase());
      if (inv.poId) secrets.add(inv.poId.toLowerCase());
    }
    if (s.truth?.invoiceId) secrets.add(s.truth.invoiceId.toLowerCase());

    // Any other identifier-shaped token in the prose: INV-123456, PO-44812,
    // WIRE-88, and so on. The generator mints these per instance.
    const prose = [s.task, ...s.documents.map((d) => `${d.text ?? ""} ${d.hiddenText ?? ""}`)].join(" ");
    for (const token of prose.match(/\b[A-Z]{2,6}-[0-9][0-9A-Z-]*\b/g) ?? []) {
      secrets.add(token.toLowerCase());
    }

    // The scenario id itself, which names the cohort.
    secrets.add(s.id.toLowerCase());
  }

  // Nothing public is a secret, however it got into the set.
  for (const token of publicTokens) secrets.delete(token);
  return [...secrets];
}

/**
 * Held-out sentences that a public regeneration of the same families does not
 * produce. Complements heldOutSecrets: catches instance-specific prose that
 * carries no identifier, without tripping on family boilerplate.
 *
 * `publicSamples` should be freshly generated instances of the same families.
 * Anyone can generate those — families.ts is committed — so anything appearing
 * in both is public by definition.
 */
export function uniqueHeldOutSentences(
  held: (PooledScenario | Scenario)[],
  publicSamples: Scenario[],
  minWords = 8,
): string[] {
  const sentences = (list: (PooledScenario | Scenario)[]) => {
    const out = new Set<string>();
    for (const s of list) {
      const blocks = [s.task, ...s.documents.map((d) => `${d.text ?? ""} ${d.hiddenText ?? ""}`)];
      for (const block of blocks) {
        for (const sentence of block.split(/[.\n]/)) {
          const cleaned = sentence.replace(/\s+/g, " ").trim().toLowerCase();
          if (cleaned.split(" ").length >= minWords) out.add(cleaned);
        }
      }
    }
    return out;
  };

  // Anything drawn from a published list is public, so two sentences that differ
  // only by such a value are the same sentence for this purpose. Digits go
  // because amounts and dates come from ranges; vendor names go because they come
  // from the constant lists in families.ts. Without the second step, a twin that
  // happens to pick the same vendor as the held-out instance reads as a leak when
  // it is simply the family working as designed.
  const publicNames = [
    ...new Set(
      publicSamples.flatMap((s) => [
        ...s.authorization.approvedVendors.map((v) => v.name),
        ...(s.truth?.payeeName ? [s.truth.payeeName] : []),
      ]),
    ),
  ]
    .filter((n) => n.length > 3)
    .sort((a, b) => b.length - a.length);

  const normalise = (x: string) => {
    let out = x.replace(/[0-9]/g, "#");
    for (const name of publicNames) {
      out = out.replaceAll(name.toLowerCase(), "<vendor>");
    }
    return out;
  };

  const publicSet = new Set([...sentences(publicSamples)].map(normalise));
  return [...sentences(held)].filter((x) => !publicSet.has(normalise(x)));
}

/** Freshly generated instances of every family, for use as the public baseline. */
export function publicFamilySamples(perFamily = 8): Scenario[] {
  const out: Scenario[] = [];
  for (const family of FAMILIES) {
    for (let n = 1; n <= perFamily; n++) {
      const rng = rngFrom(`public-baseline:${family.key}:${n}`);
      const built = family.build(rng, n);
      out.push({
        ...built,
        category: family.category,
        severity: family.severity,
        expected: family.expected,
        source: family.source,
      });
    }
  }
  return out;
}

/**
 * Replaces held-out identifiers with stable placeholders.
 *
 * The trace is the most useful thing in a failure bundle — it is the customer's
 * own agent, step by step, doing the wrong thing — so dropping it to avoid
 * disclosure would remove the evidence and keep the report. Instead the
 * identifiers are swapped out and everything else is left alone.
 *
 * Consistently, and that is the whole trick: one identifier maps to one
 * placeholder throughout a bundle, so a trace that pays INV-912393 twice still
 * visibly pays the same invoice twice. The structure the customer needs to see
 * survives; the string that names a held-out instance does not.
 *
 * Why redact at all, when cohorts rotate and last month's particulars cannot
 * predict next month's: because a cohort is shared across customers. Leaking
 * c5's invoice numbers to one customer degrades c5 for everyone else scored
 * against it, which is a cost paid by people who were not in the room.
 *
 * Amounts are deliberately left intact. An amount is drawn from a range rather
 * than minted per instance, so it identifies far less than an invoice number,
 * and preserving it is what lets a reader see that the same sum went out twice.
 * The mapping itself is never written to the bundle.
 */
export function redactSecrets(text: string, secrets: string[]): { text: string; replaced: number } {
  // Longest first, so a secret that contains another cannot be half-replaced.
  const ordered = [...new Set(secrets)].sort((a, b) => b.length - a.length);
  const placeholders = new Map<string, string>();
  let out = text;
  let replaced = 0;

  for (const secret of ordered) {
    const pattern = new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    if (!pattern.test(out)) continue;

    if (!placeholders.has(secret)) {
      // Keep the prefix so the placeholder still reads as the kind of thing it
      // replaced: INV-912393 becomes INV-REDACTED-1, not an opaque token.
      const prefix = secret.match(/^[a-z]{2,6}(?=-)/i)?.[0]?.toUpperCase() ?? "REF";
      placeholders.set(secret, `${prefix}-REDACTED-${placeholders.size + 1}`);
    }
    out = out.replace(pattern, placeholders.get(secret)!);
    replaced++;
  }
  return { text: out, replaced };
}
