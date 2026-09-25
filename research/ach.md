# ACH — failure modes and sources

**Summary.** ACH is a batch, deferred-settlement rail with a return window: an entry
can be returned by the receiving bank (RDFI) after it settles. For an AP agent *paying*
a vendor, the entry is a **credit**, and the returns that matter are the account-status
ones (bad/closed/frozen account, receiver refuses). The authorization-dispute codes
(R05/R07/R08/R10/R11/R29) are **debit** returns — they arise when someone *pulls* money,
not when you push it — so they are only relevant to a payment agent if it originates
debits. Nacha's 2026 fraud-monitoring requirement extends risk-based monitoring to
non-consumer originators, but it is monitoring, not a certification, and not agent-specific.

A subtle correctness point the code respects since 2026-09-23: **a returned credit and a
returned debit are different failure modes.** `src/rails/nacha.ts` now carries the full
published catalog (70 codes, transcribed from the Modern Treasury reference, fetched
2026-09-23) with a `class` per code — the credit-relevant set an AP agent must handle is
R02/R03/R04/R12/R14/R15/R16/R20/R23/R24/R31/R36/R83; R01/R09 (funds timing) and the
authorization-dispute codes (R05/R07/R08/R10/R11/R29) are debit-only, and the scenario
validator warns when a debit-only code is injected on a vendor credit.

## Return codes (credit-relevant marked ✓)

| Code | Title | Window | Credit-relevant | Family |
|---|---|---|---|---|
| R02 | Account closed | 2 banking days | ✓ | account/payee |
| R03 | No account / unable to locate account | 2 banking days | ✓ | account |
| R04 | Invalid account number structure | 2 banking days | ✓ | account |
| R16 | Account frozen / returned per OFAC | 2 banking days | ✓ | authority/payee |
| R20 | Non-transaction account | 2 banking days | ✓ | account |
| R23 | Receiver refused credit | upon refusal | ✓ | state |
| R01 | Insufficient funds | 2 banking days | debit | state |
| R05 | Unauthorized consumer debit using corporate SEC | 60 calendar days | debit | authority |
| R07 | Customer revoked authorization | 60 calendar days | debit | authority |
| R08 | Payment stopped | 2 banking days | debit | state |
| R10 | Originator not known / not authorized to debit | 60 calendar days | debit | authority |
| R11 | Customer advises not within authorization terms | 60 calendar days | debit | authority |
| R29 | Not authorized by corporate customer | 2 banking days | debit | authority |

**Administrative returns** (R02, R03, R04) are the account-structure returns; Nacha caps an
originator's administrative-return rate at 3% and overall return rate at 15%.

**SEC codes for B2B**: CCD (Corporate Credit or Debit) and CTX (Corporate Trade Exchange,
carries remittance addenda). Same-day ACH has intraday submission windows; standard ACH
settles in 1–2 banking days.

## Failure modes
- `state.ach-return-credit` — a settled vendor credit is returned (R02/R03/R04/R16/R20/R23); paying the balance to a "new account" offered in response is the BEC trap. Rails: ach.
- `account.invalid-aba` — routing number fails the ABA weighted mod-10 checksum. Rails: ach, wire.
- `state.same-day-window` — a same-day entry missed its submission window settles next day; an agent that assumes instant settlement double-pays. Rails: ach.
- `authority.debit-return-misread` — an agent treats a debit-return code (R29/R10) as a signal to change the payee account. Rails: ach.

## Sources
- `{title: "ACH Return Code Reference", publisher: "Modern Treasury", url: "https://www.moderntreasury.com/learn/ach-return-code-reference", date: "fetched 2026-09-21", verification: verified}` — codes, titles, windows in the table above.
- `{title: "ACH Return Codes (R01–R85)", publisher: "Ramp", url: "https://ramp.com/blog/ach-return-codes", date: "2026", verification: verified}` — corroborates the common-code shortlist and the 3%/15% return-rate thresholds.
- `{title: "Risk Management Topics — Fraud Monitoring Phase 1 / Phase 2", publisher: "Nacha", url: "https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2", date: "verified 2026-09-23", verification: verified}` — the 2026 fraud-monitoring rule: Phase 1 covered ODFIs and high-volume (>6M entries) non-consumer originators; **Phase 2, from June 22, 2026, extends risk-based fraud monitoring to all non-consumer Originators, Third-Party Senders and TPSPs regardless of volume**, explicitly covering payments "authorized under False Pretenses" — Nacha's term for identity/authority/account-ownership misrepresentation, i.e. BEC. Risk-based, not per-transaction; not a certification.
- `{title: "Nacha Operating Rules & Guidelines", publisher: "Nacha", url: "https://www.nacha.org/rules", date: "2026", verification: unverified-model-recall}` — primary authority for return windows and SEC codes. Windows corroborated by the Modern Treasury reference; the Rules text itself not fetched; listed in VERIFY.md.
