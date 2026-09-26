# Sources to verify

Every source in `research/*.md` marked `verification: unverified-model-recall` is listed
here for a human to confirm before any of it is used in outward-facing copy or a claim. A
scenario built on an honestly-labelled unverified source is acceptable to run; a *claim* to a
customer or investor is not, until the row is checked and moved to `verified`.

Rule followed while drafting: **no invented URLs, titles, statistics, or cases.** Where a
specific figure (e.g. IC3 annual BEC losses) could not be fetched, it was omitted rather than
recalled. Canonical homepages are cited for organisations whose existence is certain; deep
links were not fabricated.

## Verified (fetched)
- Modern Treasury — ACH Return Code Reference — https://www.moderntreasury.com/learn/ach-return-code-reference — codes/titles/windows in `ach.md`; full R01–R85 catalog transcribed 2026-09-23 into `src/rails/nacha.ts`.
- Ramp — ACH Return Codes — https://ramp.com/blog/ach-return-codes — 3%/15% return-rate thresholds.
- OWASP GenAI — Top 10 for LLM Applications 2025 — https://genai.owasp.org/llm-top-10/ — all IDs/titles in `agent-attacks.md`.
- Nacha — Fraud Monitoring Phase 1/2 rule pages — https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2 — Phase 2 from June 22 2026 covers ALL non-consumer originators; "False Pretenses" covers BEC. *(2026-09-23)*
- Cornell LII — UCC Article 4A — https://www.law.cornell.edu/ucc/4A — §4A-202/203/204 framework confirmed. *(2026-09-23)*
- Federal Reserve Financial Services — Fedwire — https://www.frbservices.org/financial-services/wires — finality confirmed. *(2026-09-23)*
- The Clearing House — RTP — https://www.theclearinghouse.org/payment-systems/rtp — real-time, 24/7, final settlement, credit-push. *(2026-09-23)*
- Federal Reserve — FedNow — https://www.federalreserve.gov/paymentsystems/fednow_about.htm — near-real-time, 24×7 business day. *(2026-09-23)*
- US Treasury — OFAC SDN list — https://www.treasury.gov/ofac/downloads/sdn.csv — vendored (19,391 entries) in `reference/ofac-sdn.tsv`. *(2026-09-23)*
- ohmyfin.org / validatefin.com — ISO 20022 reject reason codes (secondary references) — meanings in `src/reference/iso20022.ts`. *(2026-09-23)*

## To verify (unverified-model-recall)
| # | Claim / source | File | What to check |
|---|---|---|---|
| 1 | Nacha Operating Rules — return windows, SEC codes (the Rules text itself) | ach.md | Windows corroborated by Modern Treasury; confirm against the Rules if quoted directly. |
| 2 | Fedwire RTGS wording; account-number reliance (Operating Circular 6; UCC §4A-207) | wire.md | Confirm RTGS and name-vs-number crediting from the primary. |
| 3 | UCC 4A interpretive claim: authorised-but-fraudulently-induced transfer generally leaves loss with payer | wire.md | **Needs counsel**, not just a fetch, before outward-facing use. |
| 5 | FedNow finality/irrevocability and ISO 20022 usage | instant.md | Confirm both from Fed materials. |
| 6 | ISO 20022 External Code Sets (primary spreadsheet) | instant.md, src/reference/iso20022.ts | Confirm the encoded meanings against the primary code list. |
| 7 | Circle/USDC finality & multi-chain caveats | stablecoin.md | Confirm address-based finality and chain-mismatch loss. |
| 8 | FBI IC3 Annual Report — BEC magnitude/typologies | bec.md | Confirm typologies; supply the actual figures (deliberately omitted). |
| 9 | AFP Payments Fraud and Control Survey | bec.md | Confirm BEC/bank-change prevalence figures. |
| 10 | apexanalytix supplier/vendor bank-change research | bec.md | Confirm the vendor-master verification control claims. |
| 11 | ACFE occupational-fraud / three-way match / structuring | ap-process.md | Confirm structuring-to-evade-limits typology. |
| 12 | Google AP2 mandate model | agent-protocols.md | Confirm AP2 exists, what a mandate verifies, and the correct URL. |
| 13 | Stripe/Mastercard/Visa agent programs | agent-protocols.md | Confirm each program and what it verifies vs not. |
| 14 | x402 protocol (x402.org) | agent-protocols.md | Confirm the spec and URL. |
