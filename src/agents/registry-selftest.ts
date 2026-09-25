import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The registry against fixture endpoints in this process. A temporary data
// directory, so nothing here touches the engine's real registry; the private
// allowance, because every fixture is on loopback.

process.env.LIMULUS_DATA_DIR = mkdtempSync(join(tmpdir(), "limulus-registry-"));
process.env.LIMULUS_ALLOW_PRIVATE_ENDPOINTS = "1";

const { checkConnection, createAgent, createVersion, getAgent, listAgents, listVersions, outboundHeaders, targetFor, updateAgent } = await import("./registry.ts");
const { validateEndpoint } = await import("./net-policy.ts");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, () => r((s.address() as { port: number }).port)));
const body = (req: import("node:http").IncomingMessage) =>
  new Promise<string>((r) => {
    let t = "";
    req.on("data", (d) => (t += d));
    req.on("end", () => r(t));
  });

// A well-behaved endpoint that also demands a token.
const TOKEN = "fixture-token-1234";
let sawCheckFlag = false;
const good = createServer(async (req, res) => {
  const turn = JSON.parse(await body(req));
  if (turn.check) sawCheckFlag = true;
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "no" }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "finish", action: "refuse", reason: "check", model: "fixture-1" }));
});
const html = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html>not an agent</html>");
});
const wrongShape = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ hello: "world" }));
});
const redirecting = createServer((_req, res) => {
  res.writeHead(302, { location: "http://example.com/" });
  res.end();
});
const [goodPort, htmlPort, shapePort, redirPort] = await Promise.all([listen(good), listen(html), listen(wrongShape), listen(redirecting)]);
const closedPort = await listen(createServer()).then(async (p) => p); // reserved then freed below
const spare = createServer();
const freed = await listen(spare);
await new Promise<void>((r) => spare.close(() => r()));

// ---- endpoint policy --------------------------------------------------------
{
  const cases: [string, boolean][] = [
    ["ftp://example.com/agent", false],
    ["http://user:pw@example.com/agent", false],
    ["not a url", false],
    [`http://localhost:${goodPort}/agent`, true],
    ["http://169.254.169.254/latest/meta-data", true], // allowed only because the dev allowance is on
  ];
  for (const [url, ok] of cases) check(`policy ${ok ? "accepts" : "rejects"} ${url}`, (await validateEndpoint(url)).ok === ok);
  process.env.LIMULUS_ALLOW_PRIVATE_ENDPOINTS = "0";
  check("without the allowance, loopback is refused", !(await validateEndpoint(`http://127.0.0.1:${goodPort}/agent`)).ok);
  check("without the allowance, the metadata address is refused", !(await validateEndpoint("http://169.254.169.254/latest/meta-data")).ok);
  check("without the allowance, 10/8 is refused", !(await validateEndpoint("http://10.1.2.3/agent")).ok);
  process.env.LIMULUS_ALLOW_PRIVATE_ENDPOINTS = "1";
}

// ---- register, and keep the credential out of every record ----------------------
const { agent, version } = await createAgent({
  name: "Invoice Payment Agent",
  workflow: "Accounts payable",
  endpoint: `http://localhost:${goodPort}/agent`,
  auth: { header: "authorization", scheme: "bearer", value: TOKEN },
  version: { label: "v1", model: "fixture-1", note: "first" },
});
check("an agent is registered with a first version", agent.id.startsWith("agt_") && version.agentId === agent.id && version.label === "v1");
check("the record carries a secret reference, not the secret", agent.connection.auth?.secretId.startsWith("sec_") === true && !JSON.stringify(agent).includes(TOKEN));
check("the registry file never contains the secret", !readFileSync(join(process.env.LIMULUS_DATA_DIR!, "agents.json"), "utf8").includes(TOKEN));
check("the secret file is not world-readable", (await import("node:fs")).statSync(join(process.env.LIMULUS_DATA_DIR!, "agent-secrets.json")).mode.toString(8).endsWith("600"));
check("registration survives a reload", listAgents().some((a) => a.id === agent.id) && listVersions(agent.id).length === 1);
check("the connection starts unchecked", agent.connection.state === "not_checked");
check("outbound headers resolve from the store", outboundHeaders(agent.connection).authorization === `Bearer ${TOKEN}`);

// ---- the check reports each failure kind separately -------------------------------
{
  const { result } = await checkConnection(agent.id);
  check("a reachable, authenticated, well-formed endpoint is connected", result.state === "connected", result.detail);
  check("the check turn is labelled as a check", sawCheckFlag);
  check("the reply's self-reported model is kept", result.reported?.model === "fixture-1");
  check("the result is stored on the agent", getAgent(agent.id)?.connection.state === "connected");

  await updateAgent(agent.id, { auth: { header: "authorization", scheme: "bearer", value: "wrong" } });
  check("changing the credential resets the state", getAgent(agent.id)?.connection.state === "not_checked");
  check("a rejected credential is auth_failed", (await checkConnection(agent.id)).result.state === "auth_failed");

  await updateAgent(agent.id, { auth: { header: "authorization", scheme: "bearer", value: TOKEN }, endpoint: `http://localhost:${htmlPort}/agent` });
  check("a non-JSON reply is incompatible", (await checkConnection(agent.id)).result.state === "incompatible");
  await updateAgent(agent.id, { endpoint: `http://localhost:${shapePort}/agent` });
  const shape = (await checkConnection(agent.id)).result;
  check("JSON that is not a step is incompatible", shape.state === "incompatible", shape.detail);
  await updateAgent(agent.id, { endpoint: `http://localhost:${redirPort}/agent` });
  check("a redirect is incompatible, not followed", (await checkConnection(agent.id)).result.state === "incompatible");
  await updateAgent(agent.id, { endpoint: `http://localhost:${freed}/agent` });
  const dead = (await checkConnection(agent.id)).result;
  check("a closed port is unreachable", dead.state === "unreachable", dead.detail);
  check("nothing in a check result echoes the credential", !JSON.stringify(dead).includes(TOKEN));
  await updateAgent(agent.id, { endpoint: `http://localhost:${goodPort}/agent` });
}

// ---- versions and the run target ---------------------------------------------------
{
  const v2 = createVersion(agent.id, { label: "v2", model: "fixture-2" });
  check("a second version is recorded", listVersions(agent.id).length === 2 && v2.declared?.model === "fixture-2");
  let dup = false;
  try {
    createVersion(agent.id, { label: "v2" });
  } catch {
    dup = true;
  }
  check("a duplicate version label is refused", dup);
  const target = targetFor(agent.id, v2.id);
  check("the run target names the agent, the version and the binding", target.name === agent.name && target.version === "v2" && target.registry?.versionId === v2.id);
  check("the run target carries the credential only as a header", target.headers?.authorization === `Bearer ${TOKEN}` && !JSON.stringify({ ...target, headers: undefined }).includes(TOKEN));
  await updateAgent(agent.id, { enabled: false });
  check("a disabled agent reads as disabled", getAgent(agent.id)?.connection.state === "disabled");
  let refused = false;
  try {
    targetFor(agent.id, v2.id);
  } catch {
    refused = true;
  }
  check("a disabled agent cannot be run", refused);
}

for (const s of [good, html, wrongShape, redirecting]) s.close();
void closedPort;
rmSync(process.env.LIMULUS_DATA_DIR!, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nAll registry checks passed");
process.exit(failures ? 1 : 0);
