#!/usr/bin/env node
//
// One command to go from "I have a Postgres" to "Embeddable is querying it".
//
//   node scripts/setup.mjs            load the data, then register the connection
//   node scripts/setup.mjs --load     load only
//   node scripts/setup.mjs --connect  register/update the connection only
//   node scripts/setup.mjs --test     just check what Embeddable can see
//
// Reads DATABASE_URL and EMBEDDABLE_API_KEY from ../.env. Neither is ever
// printed. The boilerplate's own connection-*.cjs scripts want the API key
// pasted into the file, which is how keys end up in git history — this reads
// it from the gitignored .env instead.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const WAREHOUSE = join(REPO, "build", "warehouse");
const BASE_URL = "https://api.us.embeddable.com"; // region confirmed US
const CONNECTION = "limulus"; // must match `data_source:` in the cube models

// ---------------------------------------------------------------- env
function loadEnv() {
  const path = join(REPO, ".env");
  if (!existsSync(path)) fail(`No .env at ${path}`);
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);
const step = (msg) => console.log(`\n${msg}`);

// ------------------------------------------------------------- loading
async function load(databaseUrl) {
  if (!existsSync(join(WAREHOUSE, "manifest.json")))
    fail("No build/warehouse/manifest.json — run `npm run warehouse` in the repo root first.");

  const manifest = JSON.parse(readFileSync(join(WAREHOUSE, "manifest.json"), "utf8"));
  const client = new pg.Client({
    connectionString: databaseUrl,
    // Managed Postgres (Neon, Supabase, RDS) terminates TLS with a chain Node
    // does not always carry. The data is invented and the transport is still
    // encrypted; we just don't verify the chain.
    ssl: { rejectUnauthorized: false },
  });

  step("Connecting to Postgres…");
  await client.connect();
  const { rows: [v] } = await client.query("select version()");
  ok(v.version.split(",")[0]);

  let total = 0;
  for (const table of manifest.tables) {
    const csv = join(WAREHOUSE, `${table.name}.csv`);
    if (!existsSync(csv)) { console.log(`  · ${table.name}: no csv, skipped`); continue; }

    const cols = table.columns.map((c) => `${c.name} ${c.type}`).join(", ");
    await client.query(`drop table if exists ${table.name}`);
    await client.query(`create table ${table.name} (${cols})`);

    const rows = parseCsv(readFileSync(csv, "utf8"));
    if (rows.length > 0) {
      // Batched multi-row inserts. 10k rows total, so this is quick and
      // avoids a second dependency just to stream COPY.
      const names = table.columns.map((c) => c.name);
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const values = [];
        const tuples = slice.map((r) => {
          const ph = names.map((n) => {
            values.push(coerce(r[n], table.columns.find((c) => c.name === n).type));
            return `$${values.length}`;
          });
          return `(${ph.join(",")})`;
        });
        await client.query(
          `insert into ${table.name} (${names.join(",")}) values ${tuples.join(",")}`,
          values,
        );
      }
    }
    total += rows.length;
    ok(`${table.name.padEnd(20)} ${String(rows.length).padStart(6)} rows`);
  }

  await client.end();
  console.log(`\n  ${total.toLocaleString()} rows loaded into ${manifest.tables.length} tables.`);
  return { databaseUrl, total };
}

/** Empty CSV cell means NULL, not empty string — and booleans must be real. */
function coerce(raw, type) {
  if (raw === undefined || raw === "") return null;
  if (type === "boolean") return raw === "true" ? true : raw === "false" ? false : null;
  if (type === "numeric" || type === "bigint") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

/** RFC4180 enough for what export.ts writes. */
function parseCsv(text) {
  const lines = [];
  let cur = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cur.push(field); field = ""; }
    else if (ch === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || cur.length > 0) { cur.push(field); lines.push(cur); }
  if (lines.length === 0) return [];
  const header = lines[0];
  return lines.slice(1)
    .filter((l) => l.length === header.length)
    .map((l) => Object.fromEntries(header.map((h, i) => [h, l[i]])));
}

// ---------------------------------------------------------- connection
function parseUrl(databaseUrl) {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.replace(/^\//, ""),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: true,
  };
}

async function api(apiKey, path, method = "GET", body) {
  const resp = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: resp.status, json };
}

async function connect(apiKey, databaseUrl) {
  const credentials = parseUrl(databaseUrl);

  step(`Registering the "${CONNECTION}" connection with Embeddable…`);
  const existing = await api(apiKey, "/connections");
  const already = (existing.json.connections ?? []).includes(CONNECTION);

  const payload = {
    name: CONNECTION,
    type: "postgres",
    concurrency: 20,
    credentials,
  };

  const res = already
    ? await api(apiKey, `/connections/${CONNECTION}`, "PUT", payload)
    : await api(apiKey, "/connections", "POST", payload);

  if (res.status >= 400) {
    fail(`${already ? "Update" : "Create"} failed (HTTP ${res.status}): ${JSON.stringify(res.json)}`);
  }
  ok(`${already ? "Updated" : "Created"} connection "${CONNECTION}" → ${credentials.host}`);
  return credentials;
}

async function test(apiKey) {
  step("Asking Embeddable to test the connection…");
  const res = await api(apiKey, `/connections/${CONNECTION}/test`, "POST");
  if (res.status >= 400) {
    console.error(`  ✗ HTTP ${res.status}: ${JSON.stringify(res.json)}`);
    console.error(`
  If this is a network error, the database is not reachable from Embeddable's
  cloud. Allowlist their US egress IPs on your database:

      98.82.255.116
      44.226.165.63
      54.149.56.113      (these two only if you connect via SSH)
      35.171.35.74
`);
    process.exit(1);
  }
  ok(`Connection test passed: ${JSON.stringify(res.json)}`);

  const list = await api(apiKey, "/connections");
  ok(`Connections now: ${(list.json.connections ?? []).join(", ")}`);
}

// ----------------------------------------------------------------- main
const env = loadEnv();
const apiKey = env.EMBEDDABLE_API_KEY;
const databaseUrl = env.DATABASE_URL;
const args = process.argv.slice(2);
const only = (f) => args.includes(f);
const doAll = args.length === 0;

if (!apiKey) fail("EMBEDDABLE_API_KEY is not set in .env");

if (doAll || only("--load") || only("--connect")) {
  if (!databaseUrl) {
    fail(`DATABASE_URL is not set in .env.

  Embeddable queries from its own cloud, so this has to be a Postgres reachable
  from the internet — a localhost database cannot work, even with
  \`embeddable dev\`. Neon's free tier is fine; none of this data is real.

  Then add to ${join(REPO, ".env")}:

      DATABASE_URL=postgres://user:pass@host/dbname

  and run this again.`);
  }
}

if (doAll || only("--load")) await load(databaseUrl);
if (doAll || only("--connect")) await connect(apiKey, databaseUrl);
if (doAll || only("--connect") || only("--test")) await test(apiKey);

if (doAll) {
  console.log(`
  Done. Next:

      npm run embeddable:build
      npm run embeddable:push -- --api-key <key> --email <you> --message "Limulus models"

  Then open the workspace and build against the twelve cubes.
`);
}
