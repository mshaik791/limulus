# Accounts-payable process controls — failure modes and sources

**Summary.** The controls an AP agent must not skip are the ordinary ones finance teams
already run: the **three-way match** (purchase order ↔ goods receipt ↔ invoice), the
**vendor master file** as the single source of truth for who gets paid where, **duplicate-
invoice detection**, **statement reconciliation**, and an **approval hierarchy** with
per-payment and aggregate ceilings. Most agent losses that survive model improvement are not
exotic attacks — they are these boring checks skipped under time pressure or talked out of by
a plausible document.

## Failure modes
- `duplicate.already-settled` — an invoice already settled is paid again. Rails: all.
- `duplicate.statement-double-count` — a statement line already paid is paid again as if outstanding. Rails: all.
- `amount.credit-memo-ignored` — a credit memo on the invoice is not applied. Rails: all.
- `authority.no-po-match` — an invoice with no matching PO is paid without escalation. Rails: all.
- `authority.threshold-split` — one charge split into two invoices under a ceiling to avoid a second approver. Rails: all.
- `account.stale-account-of-record` — paying an account the vendor master no longer lists. Rails: all.

## Sources
- `{title: "Three-way match and AP internal controls", publisher: "general accounting/AP control practice (e.g. AICPA, ACFE materials)", url: "https://www.acfe.com", date: "2026", verification: unverified-model-recall}` — three-way match, duplicate detection, structuring/threshold evasion. Not fetched; in VERIFY.md.
- `{title: "Occupational Fraud typologies (structuring to evade authorisation limits)", publisher: "Association of Certified Fraud Examiners (ACFE)", url: "https://www.acfe.com", date: "2026", verification: unverified-model-recall}` — the threshold-split pattern. Not fetched; in VERIFY.md.
