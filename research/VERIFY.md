# Sources to verify

Every source in `research/*.md` marked `verification: unverified-model-recall` is listed
here for a human to confirm before any of it is used in outward-facing copy or a claim. A
scenario built on an honestly-labelled unverified source is acceptable to run; a *claim* to a
customer or investor is not, until the row is checked and moved to `verified`.

Rule followed while drafting: **no invented URLs, titles, statistics, or cases.** Where a
specific figure (e.g. IC3 annual BEC losses) could not be fetched, it was omitted rather than
recalled. Canonical homepages are cited for organisations whose existence is certain; deep
links were not fabricated.

## Verified (fetched this session)
- Modern Treasury — ACH Return Code Reference — https://www.moderntreasury.com/learn/ach-return-code-reference — codes/titles/windows in `ach.md`.
- Ramp — ACH Return Codes — https://ramp.com/blog/ach-return-codes — 3%/15% return-rate thresholds.
- OWASP GenAI — Top 10 for LLM Applications 2025 — https://genai.owasp.org/llm-top-10/ — all IDs/titles in `agent-attacks.md`.

## To verify (unverified-model-recall)
| # | Claim / source | File | What to check |
|---|---|---|---|
| 1 | Nacha Operating Rules — return windows, SEC codes, 2026 non-consumer fraud-monitoring rule | ach.md | Confirm windows, and that the 2026 fraud-monitoring rule exists and applies to non-consumer originators. |
| 2 | Fedwire finality & account-number reliance (frbservices.org) | wire.md | Confirm finality/no-recall and name-vs-number crediting. |
| 3 | UCC Article 4A loss allocation (law.cornell.edu/ucc/4A) | wire.md | Confirm the payer generally bears loss on authorised-but-fraudulently-induced credit transfers. |
| 4 | RTP push-only/irrevocable (theclearinghouse.org) | instant.md | Confirm irrevocability and 24/7. |
| 5 | FedNow instant/irrevocable/ISO 20022 (federalreserve.gov) | instant.md | Confirm. |
| 6 | ISO 20022 pacs.008/pacs.002 reason codes | instant.md | Confirm message names and that reject reason codes exist. |
| 7 | Circle/USDC finality & multi-chain caveats | stablecoin.md | Confirm address-based finality and chain-mismatch loss. |
| 8 | FBI IC3 Annual Report — BEC magnitude/typologies | bec.md | Confirm typologies; supply the actual figures (deliberately omitted). |
| 9 | AFP Payments Fraud and Control Survey | bec.md | Confirm BEC/bank-change prevalence figures. |
| 10 | apexanalytix supplier/vendor bank-change research | bec.md | Confirm the vendor-master verification control claims. |
| 11 | ACFE occupational-fraud / three-way match / structuring | ap-process.md | Confirm structuring-to-evade-limits typology. |
| 12 | Google AP2 mandate model | agent-protocols.md | Confirm AP2 exists, what a mandate verifies, and the correct URL. |
| 13 | Stripe/Mastercard/Visa agent programs | agent-protocols.md | Confirm each program and what it verifies vs not. |
| 14 | x402 protocol (x402.org) | agent-protocols.md | Confirm the spec and URL. |
