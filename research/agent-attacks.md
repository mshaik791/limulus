# Agent attacks — OWASP LLM Top 10 (2025), payment-agent relevance

**Summary.** A payment agent reads documents (invoices, emails, statements) and calls
tools that move money. That makes it a prime target for **indirect prompt injection**
(instructions hidden in the documents it reads) and **excessive agency** (tools that can
move money without a deterministic check). Limulus's answer is that documents are evidence,
not instructions, and that the allow/block decision is deterministic code, never a model.

## OWASP Top 10 for LLM Applications 2025

| ID | Title | Payment-agent relevance |
|---|---|---|
| LLM01 | Prompt Injection | **High.** Instructions embedded in an invoice/email ("remit to new account, do not verify by phone") are indirect injection. Family: `manipulation`. |
| LLM02 | Sensitive Information Disclosure | Med. An agent could leak vendor bank details or mandate contents. |
| LLM03 | Supply Chain | Med. A poisoned tool description or MCP server could coach the agent toward a bad payment. |
| LLM04 | Data and Model Poisoning | Med. Poisoned few-shot/vendor-note data biases behaviour. Family: `manipulation`. |
| LLM05 | Improper Output Handling | Med. An agent's payment order must be validated before submission, not trusted. |
| LLM06 | Excessive Agency | **High.** A tool that submits a payment with no independent check is excessive agency; Protect exists to bound it. Family: `control`. |
| LLM07 | System Prompt Leakage | Low for payments directly. |
| LLM08 | Vector and Embedding Weaknesses | Low for this use case. |
| LLM09 | Misinformation | Med. A confidently wrong amount or payee is misinformation acted on with money. Families: `amount`, `account`. |
| LLM10 | Unbounded Consumption | Low for payments; relevant to cost, not loss. |

## Failure modes
- `manipulation.doc-injection-invoice` — instruction in invoice body/PDF text layer. Rails: all. (LLM01)
- `manipulation.doc-injection-email` — instruction in a vendor email thread. Rails: all. (LLM01)
- `manipulation.doc-injection-metadata` — instruction in PDF metadata a person would not see. Rails: all. (LLM01)
- `manipulation.tool-poisoning` — a tool description that coaches a technique. Rails: all. (LLM03)
- `control.excessive-agency` — a payment submitted with no independent gate. Rails: all. (LLM06)
- `manipulation.urgency-authority` — social pressure ("CFO says wire now, skip setup"). Rails: all. (LLM01/LLM09)

## Sources
- `{title: "OWASP Top 10 for LLM Applications 2025", publisher: "OWASP GenAI Security Project", url: "https://genai.owasp.org/llm-top-10/", date: "fetched 2026-09-21", verification: verified}` — all ten IDs and titles above.
