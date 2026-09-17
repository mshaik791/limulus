# Embeddable dashboard

The console at `public/app.html` is hand-rolled. Embeddable replaces the charting
half of it with a real BI layer, so we stop maintaining SVG by hand.

## How the pieces fit

```
data/*.jsonl                 the hash chain — source of truth, append-only
      │
      │  npm run warehouse            (src/warehouse/export.ts)
      ▼
build/warehouse/*.csv        12 relational tables, 10,245 rows
      │  + schema.sql        Postgres DDL with \copy statements
      │
      │  npm run warehouse:load       (needs $DATABASE_URL)
      ▼
Postgres                     must be reachable from the internet
      │
      │  connection named "limulus" in the Embeddable UI
      ▼
embeddable/models/*.cube.yml dimensions and measures over those tables
      │
      │  npm run embeddable:push
      ▼
Embeddable workspace         dashboards, embedded back into our own console
```

The projection is one-way and disposable. The chain is never written to by
anything here, and `build/` is gitignored — delete it and re-run.

## The one thing that needs a decision

**Embeddable is a hosted service, so it cannot reach a database on localhost.**
The projection has to land in a Postgres that is reachable from the internet.
Cheapest options that work:

| Option | Free tier | Notes |
|---|---|---|
| Neon | yes | Serverless Postgres, connection string in one click |
| Supabase | yes | Also gives a REST layer we don't need |
| Railway / Render | small | Fine, slightly more setup |

None of this data is real — invented vendors, invoices and accounts, sandbox
transfers only — so a free tier is genuinely fine here. Do not point this at a
Postgres that also holds anything real.

## Setup

1. Create a Postgres and copy its connection string.

2. Put it in `.env` (already gitignored, `chmod 600`):
   ```
   DATABASE_URL=postgres://…
   ```

3. Build and load the projection:
   ```
   npm run warehouse
   npm run warehouse:load
   ```

4. In the Embeddable UI: **Data → Connect your database**. Name the connection
   exactly `limulus` — that string is what `data_source: limulus` in the model
   files resolves to. Anything else and every cube fails to resolve.

5. Push the models:
   ```
   npm run embeddable:push
   ```

## What's worth building first

The data supports these today, with real numbers behind them:

- **Verdict mix** — 513 decisions: 234 released, 238 held, 41 escalated.
- **Which check actually fires.** Group `decision_checks` on `check_id`, measure
  `failed`. Top five: `payee_account` 124, `duplicate` 102,
  `embedded_instructions` 101, `similar_recent_payment` 91, `invoice_approved` 55.
- **Loss rate by model.** `model_trials`, group on `model`, measure `loss_rate`
  next to `halt_rate` and `throughput`. This is the whole pitch in one chart:
  the small model loses 32/50 *and* halts the queue 18 times; the frontier model
  loses 15/65 and halts never.
- **Four axes over time.** `lab_runs`, measures `avg_safety`, `avg_capability`,
  `avg_recovery`, `avg_reliability`, grouped by `created_at`.
- **The alarm tile.** `outcomes.with_findings` — 52 of 69 reconciled outcomes
  carry a finding. Money that moved without a release belongs here.
- **Friction.** `lab_grades.refused_but_should_pay`. A gate that blocks correct
  payments gets switched off, taking the useful checks with it, so this number
  matters as much as the safety ones.

## Grouping trap

Group failures on `decision_checks.check_id`, **not** on
`decision_reasons.label`. The chain spans a rename: the same failure appears as
both "Account matches the vendor record" (the old name, which asserted the
passing condition on a failure) and "Payee account" (the fixed one). Grouped on
prose, one failure mode looks like three. `check_id` was stable across the
rename.

The old labels are left in `decision_reasons` deliberately rather than rewritten
— the chain is append-only, and the rename is itself worth being able to see.
