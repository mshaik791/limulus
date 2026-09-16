import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./decide.ts";
import { publicKeyPem, readChain, verifyChain } from "./record.ts";
import { scenarios } from "./scenarios.ts";
import { referenceAgents } from "./bench/agents.ts";
import { runPack } from "./bench/runner.ts";
import { readReports, sealReport, verifyReport } from "./bench/report.ts";
import { scenarios as packScenarios } from "./bench/pack-payments-v1.ts";
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

    if (path === "/health") return json(res, 200, { ok: true, service: "limulus", version: "0.1.0" });

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

      const record = decide({ ...request, documents: request.documents ?? [] });
      return json(res, 200, record);
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
