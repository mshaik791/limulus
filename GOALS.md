# Goals

The improvement roadmap, prioritized top-down. Anyone (or any agent session) picking up
work starts at the highest unchecked P0. Every item has a definition of done and the
metric that proves it. Improvements ship as **versioned releases** — suite v0.2 → v0.3
with a changelog — never as silent tuning. Keep `FINDINGS.md` updated as you go.

## Binding rules (apply to every goal below)

- Never connect to a real rail or bank; never hold, move or control money.
- **No LLM anywhere in the control path.** Grading, Protect, qualification and the
  pipeline stay deterministic. A model may draft scenarios or explain failures; it must
  never decide pass/fail or allow/block.
- Score outcomes only, never the agent's explanation. Every rate carries its n.
- Simulated amounts are always labelled simulated.
- Banned words: safe, certified, guaranteed, notarized, self-improving, trained on.
  Say "signed," "hash-chained," "tested," "passed at this configuration."
- Every scenario carries provenance a human can check; no invented URLs, statistics or
  cases. Unverifiable sources go to `research/VERIFY.md`.
- Severity weights and thresholds are fixed constants within a suite version. They may
  change only in a versioned release with a changelog entry, so old runs stay comparable.

---

## P0 — the demo number and the credibility floor

### 1. Live-model measurement: off vs advisory vs enforced  *(unblocked — Fable 5 is available)*
The one number that sells the product: how much the enforced gate changes outcomes for a
real model. Run the three arms (`src/sandbox/controls.ts`, `src/sandbox/compare.ts`)
with a live model behind the Lab endpoint (Model Arena: `7e66901`).
- Run the expanded suite (seeds + variants) in all three arms, ≥30 trials per scenario
  where budget allows; log estimated spend before each batch.
- Report per-arm: wrongful payments, simulated wrongful amount, skipped-control rate
  (advisory only — enforced makes skipping impossible by construction), false-block rate,
  each with n and a 95% interval.
- Respect the known caveats in FINDINGS: advisory skip-rate is meaningless for reference
  agents; enforcement *reduces* (not prevents) split-pair loss; label arms on every figure.
- **Done when:** `research/RESULTS.md` carries the off-vs-enforced table from a live
  model, every cell with n, and the console Compare screen renders it.
- **Metric:** the loss-prevention delta, quotable with its n.
- 🔶 *(2026-09-23 — pilot done, full run gated)* Pilot `cmp_620a3ffc9fe04bef` (4×2×3):
  the gate eliminated the live BEC loss (off: paid poisoned 2/2; gated: 0/2) **and**
  collapsed capability to 0 — the agent stalled after calling the gate, $0 settled even on
  the clean control. Two blockers before the 30-trial run, both in FINDINGS 2026-09-23:
  diagnose the gated-arm stall (prompt / step budget / verdict shape), and explain or fix
  the compare module's wrongful-amount accounting, which does not reconcile with episodes.

### 2. Real reference data behind the checks
Swap invented screening data for the real, public, freely-redistributable lists. All
deterministic; no key needed.
- ✅ **OFAC SDN list** *(2026-09-23)* — vendored (19,391 entries, `reference/ofac-sdn.tsv`,
  refresh via `scripts/fetch-reference.ts`); `src/reference/ofac.ts` screens
  deterministically; the sanctions family now picks real SDN names. `selftest:ofac`.
- ⚠️ **Fed ABA / FedACH routing directory** — the Fed directory is no longer freely
  redistributable (E-Payments Routing Directory agreement); checksum validation stays,
  full-directory screening needs a licensing decision. Logged, not faked.
- ✅ **Full Nacha return set** *(2026-09-23)* — all 70 published codes with the
  credit/debit split; validator warns on debit codes in credit scenarios.
- ✅ **ISO 20022 reject reason codes** *(2026-09-23)* — `src/reference/iso20022.ts`,
  classified, only AM04 resendable; `selftest:iso20022`. Primary code-set spreadsheet
  still in VERIFY.md.
- **Metric:** scenarios backed by real reference data vs invented (count).

### 3. Verify the 14 sources in `research/VERIFY.md`
Fetch and confirm each `unverified-model-recall` row; move to verified or correct the
text that cited it. Nothing unverified appears in a deck, memo or customer document.
- ✅ *(2026-09-23, partial: 14 → 5)* — Verified: Nacha 2026 fraud rule (Phase 2 covers all
  non-consumer originators, "False Pretenses" = BEC), UCC 4A framework, Fedwire finality,
  RTP (final/24×7/credit-push), FedNow (near-real-time/24×7), OFAC, ISO rejects
  (secondary). Remaining 5 triaged in VERIFY.md — the UCC 4A interpretive claim is marked
  **needs counsel**, not just needs-fetch.
- **Metric:** unverified-sources count (target 0 for cited ones). Now 5.

## P1 — corpus growth and grader coverage (the renewal engine)

### 4. Grow the failure-family library
Families are what a customer renews for; instances are free. Track with
`npm run cadence` (`src/bench/family-cadence.ts`).
- Extend the policy compiler (`src/policy/compile.ts`) with more control types.
- Add families from the completed research: same-day-ACH window, wire finality,
  stablecoin chain-mismatch, ISO reject handling.
- Every family: provenance, ≥1 pay-control twin, taxonomy tags.
- **Metric:** family-cadence on track (families added inside the window vs target).

### 5. Close known grader blind spots (from FINDINGS)
- Daily-ceiling check in the enforced gate (the split-pair blind spot: enforcement
  currently reduces rather than prevents; a daily-limit check closes part of it).
- Wire `retryableToSameAccount` into `violations.ts`: penalise re-sending to the same
  account after an account-bad return (R02/R03/R04), and treat "new account offered
  after a return" as the BEC pattern it is.
- The careful reference agent pays a single invoice through the daily ceiling (logged
  2026-09-23) — fix the agent or the grader, whichever is wrong.
- **Done when:** each has a failing-then-passing selftest.
- **Metric:** grader selftest count; FINDINGS items moved to resolved.

### 6. Extend derived scope (Qualify)
- Add scope dimensions: account-of-record (finer than payeeScope), currency as a
  blocking dimension (today a caveat), rail.
- Add a foreign-currency family to the held-out pool so currency derivation has
  evidence to act on.
- **Metric:** scope dimensions derived from evidence vs hand-set.

## P2 — product surface and the (careful) model layer

### 7. Reconcile the public numbers
README says careful = capability 100 on the base pack; the expanded suite shows
safety 93 and the default open-pool run shows capability 29. One story, every number
with its suite name and n, before anything is shown externally.

### 8. Reasoning-quality layer — advisory only
A model may *explain* failures and grade judgment-scenario reasoning as a separate,
clearly-labelled advisory layer. It never decides a financial fact and never moves a
score. LLM-assisted scenario *drafting* is fine; provenance must point at a real source
and a deterministic grader must score it.

### 9. Versioned release discipline
- Suite changes ship as a version bump with a changelog section in the README or
  `docs/`; qualifications already record suite id + version.
- Weight/threshold changes: only in a release, with the old→new values stated.
- **Metric:** every qualification traceable to an exact suite version.

### 10. External anchor for the chains (from the open red-team finding)
Hash chains detect alteration and mid-sequence edits, not tail truncation. Add a length
commitment or published head-hash anchor (or an outside timestamp per record). Until
then, never claim "cannot be truncated."

## Business goals (not code, but gate the raise)

- **B1.** The 5-minute one-command demo: failure → rate with n → enforced gate blocks →
  fix → re-run → qualification expires on config change. Deploy the console somewhere
  shareable.
- **B2.** One design partner building an AP agent who will say "we won't deploy without
  this." Lab/Qualify first (zero integration risk), Monitor next, Protect last.
- **B3.** Every number in the deck traced to a signed record, labelled with arm, suite
  version and n. Nothing from an unverified source.
