# Limulus

**Proof before the money moves.** A three-way match for payments made by AI agents.

Before an agent pays a vendor, it declares what it intends to pay and why. Limulus releases the
payment only when three records agree:

| Record | Where it comes from | The question it answers |
|---|---|---|
| **Authorization** | Approval workflow, spending policy, the task assigned to the agent | What did a person allow? |
| **Declared intent** | The agent's structured declaration, signed before anything executes | What did the agent say it was about to do, and why? |
| **Payment order** | The payment about to be released at the bank | What actually reaches the rail? |

Anything that disagrees is held. Every decision, including holds, is signed, hash-chained and
appended to a verifiable record.

This is a pre-product prototype. All names, invoices and accounts in the examples are invented.

## Running it

Requires Node 22.18 or newer (it runs the TypeScript directly, no build step, no dependencies).

```bash
node src/demo.ts          # run all scenarios through the engine
node src/demo.ts poisoned # run one: clean, poisoned, altered, overlimit, duplicate
node src/server.ts        # gateway + interactive demo on http://localhost:8787
node src/verify-cli.ts    # recompute every hash and signature in the chain
```

## The scenarios

| Scenario | What happens | Outcome |
|---|---|---|
| `clean` | Everything agrees | released |
| `poisoned` | Hidden text in the invoice PDF tells the agent to pay a new account | held |
| `altered` | The declaration is clean, but the payment order is changed before it reaches the bank | held |
| `overlimit` | The agent pays more than a person approved | held |
| `duplicate` | The same approved invoice is paid twice | held |

The `altered` case is the one only a three-way match catches. The authorization looks valid, the
declaration looks valid, and the payment order looks like a normal ACH. Only comparing all three
exposes it.

## API

```
POST /v1/decisions     decide on one payment; body is the full request, or {"scenario":"poisoned"}
GET  /v1/scenarios     list the demo scenarios
GET  /v1/records       the signed chain (most recent 50)
GET  /v1/records/:id   one record
GET  /v1/verify        recompute every hash and signature, and check the chain links
GET  /health
```

Example:

```bash
curl -s -X POST localhost:8787/v1/decisions \
  -H 'content-type: application/json' \
  -d '{"scenario":"altered"}'
```

## The checks

1. Vendor is on the approved list
2. Within the per-payment limit
3. Invoice approved by a person, for the same amount
4. **Payment order matches the declaration** (payee, amount, account, reference)
5. Account matches the vendor master record
6. No recent bank detail change (a change inside 30 days escalates for a callback)
7. Not a duplicate payment
8. No embedded payment instructions in any document the agent read, visible or hidden
9. The declaration cites its source documents

A failed check holds the payment. A check needing a person escalates it. Only a clean run releases.

## The record

Each decision is sealed with:

- a SHA-256 hash over the whole record body,
- an Ed25519 signature over that hash,
- the hash of the previous record, forming a chain.

`node src/verify-cli.ts` recomputes all of it. Changing any stored record breaks verification.

The signing key is generated on first run and written to `data/signing-key.json`. That file is
git-ignored and is fine for a prototype; a real deployment would use a KMS or HSM, and would also
timestamp each record with an outside service.

## Layout

```
src/types.ts       the three records, checks and decision shapes
src/checks.ts      the three-way match and the fraud checks
src/decide.ts      runs the checks, decides, seals the record
src/record.ts      signing, hashing, the chain, verification
src/server.ts      HTTP API and the demo page
src/scenarios.ts   example payloads
src/demo.ts        CLI demo
public/index.html  interactive demo
data/              signing key and the record chain (git-ignored)
```

## Not built yet

- Holding a real payment at a bank API. Increase supports ACH transfers that wait in a
  pending-approval state and are approved through the API, and Column supports ACH credits created
  on hold and released later. Whether either will accept a third party's approval is the first
  thing to test.
- The MCP gateway that captures what an agent reads, so declarations are produced automatically.
- Payee verification through a specialist provider.
- An outside timestamp on each record.
- The guarantee. That comes after there is loss data to price it.
