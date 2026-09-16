import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./decide.ts";
import { publicKeyPem, readChain, verifyChain } from "./record.ts";
import { scenarios } from "./scenarios.ts";
import { readOutcomes, readSettlements, recordSettlement, verifyOutcomeForDecision } from "./outcome.ts";
import { buildReceipt, verifyReceipt, type Receipt } from "./receipt.ts";
import { referenceAgents } from "./bench/agents.ts";
import { runPack } from "./bench/runner.ts";
import { agentSummaries, readReports, reportHistory, sealReport, verifyReport } from "./bench/report.ts";
import { scenarios as packScenarios } from "./bench/pack-payments-v1.ts";
import { authenticate, createKey, listKeys, revokeKey, type Scope } from "./auth.ts";
import { check as checkIdempotency, remember } from "./idempotency.ts";
import { verdictFor } from "./verdict.ts";
import { readLabRuns, readTraces, runSuite, verifyLabRun } from "./sandbox/lab.ts";
import { referenceToolAgents } from "./sandbox/agents.ts";
import { checkScope, readQualifications, revokeQualification, verifyQualification } from "./qualification.ts";
import { addEndpoint, emit, listEndpoints, readDeliveries, removeEndpoint } from "./webhooks.ts";
import type { DecisionRequest } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const port = Number(process.env.PORT ?? 8787);

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      return res.end();
    }

    if (path === "/health") {
      return json(res, 200, {
        ok: true,
        service: "limulus",
        version: "0.1.0",
        authRequired: process.env.LIMULUS_REQUIRE_AUTH === "1",
      });
    }

    // Everything under /v1 needs a key when auth is enforced. Receipt
    // verification stays open on purpose: anyone holding a receipt must be able
    // to check it, including people who are not our customers.
    if (path.startsWith("/v1/") && path !== "/v1/receipts/verify") {
      const scope: Scope = path.startsWith("/v1/keys") ||
        path.startsWith("/v1/webhooks") ||
        (req.method === "POST" && path.startsWith("/v1/qualifications"))
        ? "admin"
        : req.method === "POST"
          ? path.startsWith("/v1/settlements")
            ? "settlements:write"
            : path.startsWith("/v1/bench") || path.startsWith("/v1/lab")
              ? "bench:run"
              : "decisions:write"
          : "read";

      const auth = authenticate(req.headers.authorization ?? (req.headers["x-api-key"] as string), scope);
      if (!auth.ok) return json(res, auth.status, { error: auth.message });
    }

    // Decide on one payment. This is the call an agent's gateway makes before
    // a payment order is released.
    if (path === "/v1/decisions" && req.method === "POST") {
      const body = (await readBody(req)) as Partial<DecisionRequest> & { scenario?: string };

      const request: DecisionRequest | undefined = body.scenario
        ? scenarios[body.scenario]?.request
        : (body as DecisionRequest);

      if (!request?.authorization || !request?.declaration || !request?.paymentOrder) {
        return json(res, 400, {
          error: "Send authorization, declaration, paymentOrder and documents, or a scenario name",
          scenarios: Object.keys(scenarios),
        });
      }

      // A retry after a timeout must not create a second decision.
      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
      const prior = checkIdempotency(idempotencyKey, body);
      if (prior.state === "conflict") return json(res, 409, { error: prior.message });
      if (prior.state === "replay") {
        res.setHeader("limulus-idempotent-replay", "true");
        return json(res, prior.status, prior.response);
      }

      const record = decide({ ...request, documents: request.documents ?? [] });
      remember(idempotencyKey, body, 200, record);

      void emit(`decision.${record.outcome}` as Parameters<typeof emit>[0], {
        decisionId: record.id,
        outcome: record.outcome,
        reasons: record.reasons,
        payee: record.paymentOrder.payeeName,
        amount: record.paymentOrder.amount,
        currency: record.paymentOrder.currency,
        invoiceId: record.declaration.invoiceId,
        recordHash: record.hash,
      });

      return json(res, 200, record);
    }

    // The release gate. Same evidence as /v1/decisions, but the answer is one
    // of four words a caller can branch on, with the qualification checked.
    if (path === "/v1/release" && req.method === "POST") {
      const body = (await readBody(req)) as Partial<DecisionRequest> & {
        scenario?: string;
        qualificationId?: string;
        agent?: { name?: string; version?: string; promptHash?: string; toolConfigHash?: string };
        workflow?: string;
      };

      const request: DecisionRequest | undefined = body.scenario
        ? scenarios[body.scenario]?.request
        : (body as DecisionRequest);

      if (!request?.authorization || !request?.declaration || !request?.paymentOrder) {
        return json(res, 400, {
          error: "Send authorization, declaration, paymentOrder and documents, or a scenario name",
          scenarios: Object.keys(scenarios),
        });
      }

      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
      const prior = checkIdempotency(idempotencyKey, body);
      if (prior.state === "conflict") return json(res, 409, { error: prior.message });
      if (prior.state === "replay") {
        res.setHeader("limulus-idempotent-replay", "true");
        return json(res, prior.status, prior.response);
      }

      const record = decide({ ...request, documents: request.documents ?? [] });
      const verdict = verdictFor(record, {
        qualificationId: body.qualificationId,
        requireQualification: process.env.LIMULUS_REQUIRE_QUALIFICATION === "1",
        baseUrl: `http://${req.headers.host ?? `localhost:${port}`}`,
        scope: body.agent
          ? {
              agentName: body.agent.name ?? "unknown",
              agentVersion: body.agent.version ?? "unknown",
              promptHash: body.agent.promptHash,
              toolConfigHash: body.agent.toolConfigHash,
              workflow: body.workflow ?? "invoice-payment",
              rail: record.paymentOrder.rail,
              payeeOnFile: record.authorization.approvedVendors.some(
                (v) => v.name.toLowerCase() === record.paymentOrder.payeeName.toLowerCase(),
              ),
            }
          : undefined,
      });

      remember(idempotencyKey, body, 200, verdict);

      void emit(`decision.${record.outcome}` as Parameters<typeof emit>[0], {
        decisionId: record.id,
        outcome: record.outcome,
        verdict: verdict.verdict,
        reasons: record.reasons,
        payee: record.paymentOrder.payeeName,
        amount: record.paymentOrder.amount,
        currency: record.paymentOrder.currency,
        invoiceId: record.declaration.invoiceId,
        recordHash: record.hash,
      });

      if (verdict.retryAfterMs) res.setHeader("retry-after", String(Math.ceil(verdict.retryAfterMs / 1000)));
      return json(res, 200, verdict);
    }

    // ---- The Lab: run an agent in the simulated world -----------------------
    if (path === "/v1/lab/runs" && req.method === "POST") {
      const body = (await readBody(req)) as {
        agent?: string;
        endpoint?: string;
        version?: string;
        promptHash?: string;
        trials?: number;
        qualifyFor?: Parameters<typeof runSuite>[1] extends { qualifyFor?: infer Q } ? Q : never;
      };

      const target = body.endpoint
        ? { name: body.agent ?? new URL(body.endpoint).host, version: body.version ?? "external", endpoint: body.endpoint, promptHash: body.promptHash }
        : referenceToolAgents[body.agent ?? "careful"];

      if (!target) {
        return json(res, 400, {
          error: "Send an endpoint, or an agent name",
          agents: Object.keys(referenceToolAgents),
        });
      }

      const { run, qualification } = await runSuite(target, {
        trials: body.trials ?? 3,
        qualifyFor: body.qualifyFor,
      });
      return json(res, 200, { run, qualification });
    }

    if (path === "/v1/lab/runs") {
      const runs = readLabRuns();
      return json(res, 200, {
        count: runs.length,
        // Grades are large; the list view gets the summary and the axes only.
        runs: runs.slice(-25).map(({ grades, ...rest }) => ({ ...rest, episodes: grades.length })),
      });
    }

    if (path.startsWith("/v1/lab/runs/")) {
      const id = path.split("/")[4];
      const run = readLabRuns().find((r) => r.id === id);
      if (!run) return json(res, 404, { error: "No such run" });
      return json(res, 200, { ...run, verification: verifyLabRun(run) });
    }

    if (path === "/v1/lab/episodes") {
      const runId = url.searchParams.get("runId") ?? undefined;
      const scenarioId = url.searchParams.get("scenarioId");
      const episodes = readTraces(runId).filter((t) => !scenarioId || t.scenarioId === scenarioId);
      return json(res, 200, { count: episodes.length, episodes: episodes.slice(-50) });
    }

    if (path === "/v1/lab/agents") {
      return json(
        res,
        200,
        Object.entries(referenceToolAgents).map(([key, a]) => ({ key, name: a.name, version: a.version })),
      );
    }

    // ---- Qualifications ----------------------------------------------------
    if (path === "/v1/qualifications" && req.method === "GET") {
      const quals = readQualifications();
      return json(res, 200, {
        count: quals.length,
        qualifications: quals.map((q) => ({
          ...q,
          state: q.revokedAt ? "revoked" : Date.parse(q.expiresAt) < Date.now() ? "expired" : "valid",
          verification: verifyQualification(q),
        })),
      });
    }

    if (path.endsWith("/revoke") && path.startsWith("/v1/qualifications/") && req.method === "POST") {
      const id = path.split("/")[3];
      const body = (await readBody(req)) as { reason?: string };
      const revoked = revokeQualification(id, body.reason ?? "revoked through the API");
      return revoked
        ? json(res, 200, revoked)
        : json(res, 404, { error: "No active qualification with that id" });
    }

    if (path.startsWith("/v1/qualifications/") && req.method === "GET") {
      const id = path.split("/")[3];
      const qualification = readQualifications().find((q) => q.id === id);
      if (!qualification) return json(res, 404, { error: "No such qualification" });

      // A caller can ask whether a specific payment is in scope before making it.
      const amount = url.searchParams.get("amount");
      const scope = amount
        ? checkScope(id, {
            agentName: qualification.binding.agent.name,
            agentVersion: url.searchParams.get("agentVersion") ?? qualification.binding.agent.version,
            workflow: url.searchParams.get("workflow") ?? qualification.binding.workflow,
            rail: url.searchParams.get("rail") ?? qualification.binding.rail,
            currency: url.searchParams.get("currency") ?? qualification.binding.currency,
            amount: Number(amount),
            payeeOnFile: url.searchParams.get("payeeOnFile") !== "false",
          })
        : undefined;

      return json(res, 200, { ...qualification, verification: verifyQualification(qualification), scope });
    }

    if (path === "/v1/scenarios") {
      return json(
        res,
        200,
        Object.entries(scenarios).map(([key, s]) => ({ key, title: s.title })),
      );
    }

    if (path === "/v1/records") {
      const chain = readChain();
      return json(res, 200, { count: chain.length, records: chain.slice(-50) });
    }

    if (path.startsWith("/v1/records/")) {
      const id = path.split("/").pop();
      const record = readChain().find((r) => r.id === id);
      return record ? json(res, 200, record) : json(res, 404, { error: "No such record" });
    }

    if (path === "/v1/verify") return json(res, 200, { ...verifyChain(), publicKey: publicKeyPem });

    // Key management. The key itself is returned once, at creation.
    if (path === "/v1/keys" && req.method === "POST") {
      const body = (await readBody(req)) as { name?: string; scopes?: Scope[]; environment?: "live" | "test" };
      if (!body?.name) return json(res, 400, { error: "Send a name for the key" });
      const { key, record } = createKey(body.name, body.scopes, body.environment ?? "test");
      return json(res, 200, {
        key,
        record,
        note: "This is the only time the key is shown. Store it now.",
      });
    }

    if (path === "/v1/keys") return json(res, 200, { keys: listKeys() });

    if (path.startsWith("/v1/keys/") && req.method === "DELETE") {
      const id = path.split("/").pop() ?? "";
      return revokeKey(id) ? json(res, 200, { revoked: id }) : json(res, 404, { error: "No such key" });
    }

    // Webhook endpoints.
    if (path === "/v1/webhooks" && req.method === "POST") {
      const body = (await readBody(req)) as { url?: string; events?: Parameters<typeof addEndpoint>[1] };
      if (!body?.url) return json(res, 400, { error: "Send the url to deliver to" });
      const endpoint = addEndpoint(body.url, body.events);
      return json(res, 200, {
        endpoint,
        note: "Store the secret now. Verify deliveries with the limulus-signature header.",
      });
    }

    if (path === "/v1/webhooks") return json(res, 200, { endpoints: listEndpoints() });

    if (path === "/v1/webhooks/deliveries") {
      return json(res, 200, { deliveries: readDeliveries().slice(-50) });
    }

    if (path.startsWith("/v1/webhooks/") && req.method === "DELETE") {
      const id = path.split("/").pop() ?? "";
      return removeEndpoint(id) ? json(res, 200, { removed: id }) : json(res, 404, { error: "No such endpoint" });
    }

    // Outcome verification: what the rail reported about a payment we decided on.
    if (path === "/v1/settlements" && req.method === "POST") {
      const body = (await readBody(req)) as Parameters<typeof recordSettlement>[0];
      if (!body?.decisionId || !body?.status || body?.amount === undefined) {
        return json(res, 400, {
          error: "Send decisionId, status, amount, currency, payeeAccountLast4, occurredAt and railReference",
        });
      }
      const settlement = recordSettlement({
        ...body,
        occurredAt: body.occurredAt ?? new Date().toISOString(),
      });
      // Re-verify the decision as soon as the rail reports anything.
      const outcome = verifyOutcomeForDecision(body.decisionId);

      void emit(`outcome.${outcome.status}` as Parameters<typeof emit>[0], {
        decisionId: outcome.decisionId,
        outcomeId: outcome.id,
        status: outcome.status,
        findings: outcome.findings,
        railReference: settlement.railReference,
      });

      return json(res, 200, { settlement, outcome });
    }

    if (path === "/v1/settlements") return json(res, 200, { settlements: readSettlements().slice(-50) });

    if (path.startsWith("/v1/outcomes/")) {
      const decisionId = path.split("/").pop() ?? "";
      try {
        return json(res, 200, verifyOutcomeForDecision(decisionId));
      } catch (error) {
        return json(res, 404, { error: (error as Error).message });
      }
    }

    if (path === "/v1/outcomes") {
      const outcomes = readOutcomes();
      return json(res, 200, { count: outcomes.length, outcomes: outcomes.slice(-50) });
    }

    // Receipts: the portable, independently verifiable form of a decision.
    if (path.startsWith("/v1/receipts/") && req.method === "GET") {
      const decisionId = path.split("/").pop() ?? "";
      try {
        return json(res, 200, buildReceipt(decisionId));
      } catch (error) {
        return json(res, 404, { error: (error as Error).message });
      }
    }

    if (path === "/v1/receipts/verify" && req.method === "POST") {
      const receipt = (await readBody(req)) as Receipt;
      if (!receipt?.hash || !receipt?.signature) {
        return json(res, 400, { error: "Send a receipt object with hash, signature and publicKey" });
      }
      return json(res, 200, verifyReceipt(receipt));
    }

    // Pre-deployment testing: run an agent against the scenario pack.
    if (path === "/v1/bench/runs" && req.method === "POST") {
      const body = (await readBody(req)) as { endpoint?: string; agent?: "naive" | "careful"; category?: string };
      const target =
        body.endpoint != null
          ? { name: "agent-under-test", endpoint: body.endpoint }
          : body.agent === "careful"
            ? referenceAgents.careful
            : referenceAgents.naive;
      const pack = body.category ? packScenarios.filter((s) => s.category === body.category) : packScenarios;
      if (pack.length === 0) return json(res, 400, { error: `No scenarios in category "${body.category}"` });
      const report = sealReport(await runPack(target, pack));
      return json(res, 200, report);
    }

    if (path === "/v1/bench/scenarios") {
      return json(
        res,
        200,
        packScenarios.map((s) => ({
          id: s.id,
          category: s.category,
          title: s.title,
          severity: s.severity,
          expected: s.expected,
          source: s.source,
        })),
      );
    }

    if (path === "/v1/bench/history") {
      const agent = url.searchParams.get("agent") ?? undefined;
      return json(res, 200, { agent: agent ?? "all", history: reportHistory(agent) });
    }

    if (path === "/v1/bench/agents") return json(res, 200, { agents: agentSummaries() });

    if (path === "/v1/bench/reports") {
      const reports = readReports();
      return json(res, 200, {
        count: reports.length,
        reports: reports.slice(-20).map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          agent: r.agent,
          score: r.score,
          level: r.level,
          hash: r.hash,
        })),
      });
    }

    if (path.startsWith("/v1/bench/reports/")) {
      const id = path.split("/").pop();
      const report = readReports().find((r) => r.id === id);
      return report
        ? json(res, 200, { report, verification: verifyReport(report) })
        : json(res, 404, { error: "No such report" });
    }

    // Static files for the demo page.
    const file = path === "/" ? "index.html" : path.replace(/^\/+/, "");
    const filePath = join(publicDir, file);
    if (filePath.startsWith(publicDir) && existsSync(filePath)) {
      res.writeHead(200, { "content-type": mime[extname(filePath)] ?? "application/octet-stream" });
      return res.end(readFileSync(filePath));
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, { error: (error as Error).message });
  }
});

server.listen(port, () => {
  console.log(`Limulus gateway on http://localhost:${port}`);
  console.log(`  POST /v1/decisions   decide on a payment (or {"scenario":"poisoned"})`);
  console.log(`  GET  /v1/scenarios   list demo scenarios`);
  console.log(`  GET  /v1/records     the signed chain`);
  console.log(`  GET  /v1/verify      recompute hashes and signatures`);
});
