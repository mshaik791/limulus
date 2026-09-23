# Limulus console

The web console over the engine in `../src`. It reads signed records over HTTP and computes no number the engine did not: every figure on a screen is in a record, every rate carries its n, and every action is an API call.

```bash
# in the repository root: the engine
node src/server.ts                      # http://localhost:8787

# here: the console
npm install
npm run dev                             # http://localhost:3000
```

`LIMULUS_API` points the console at an engine somewhere else; `LIMULUS_API_KEY` is the bearer key when that engine requires one. See `.env.example`.

## Screens

Labs, before deployment:

| Route | Nav | What it shows |
|---|---|---|
| `/labs` | Overview | Can this version be deployed? Readiness rung and state, the latest run, the critical failure with its trajectory, coverage by failure family, every agent, the latest comparison, shadow mode |
| `/labs/tests` | Test Runs | Every Lab run, newest first, four axes with n |
| `/labs/tests/:runId` | | One run as a debugger: Overview, Failures, Scenarios, Trace, Artifacts |
| `/labs/tests/:runId/scenarios/:scenarioId` | | Scenario replay: context, a scrubbable execution timeline, the evaluation checklist and the result with its amount |
| `/labs/arena` | Model Arena | Comparisons on record and a form to run one; `/labs/arena/:id` for one |
| `/labs/releases` | Release Gates | Every gate run, previous against candidate; `/labs/releases/:id` for one, with the override rules |
| `/labs/policies` | Policies | Controls as guardrail cards with what each compiles into and its last result, plus the compiler |
| `/labs/qualifications` | Assurance Checks | The ten deterministic checks with usage, and the signed qualifications they have earned |

Core, in production:

| Route | Nav | What it shows |
|---|---|---|
| `/production` | Shadow Mode | Production outcomes beside what the three-way match would have done; `/production/:id` for one, with review |
| `/decisions` | Production | The gate's real decisions and what the rail did afterwards |
| `/incidents` | Incidents | Monitor candidates: production failures turned into regression scenarios, approved by a person |
| `/evidence` | Evidence | The signed decision chain; `/evidence/:id` for the packet and its receipt, verified |

## Rules it keeps

Amounts from the Lab are labelled simulated at every appearance and every Lab screen carries the sandbox bar. Shadow mode says "would have", never "did". A status colour never appears without its word. The words the findings register bans do not appear.
