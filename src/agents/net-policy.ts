import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Where the engine is allowed to send a customer's turns. Registering an
// endpoint makes the engine issue outbound requests to it, so a hosted engine
// must not become a way to reach whatever sits on its own network: cloud
// metadata services, internal admin ports, the engine itself.
//
// The rule is deny-by-default for anything private, with one explicit,
// environment-scoped allowance for local development, because a customer's
// laptop is exactly where the first pilot agent runs:
//
//   LIMULUS_ALLOW_PRIVATE_ENDPOINTS=1   permit loopback and private ranges
//
// Nothing here is disabled globally; the flag is read per validation.

export type EndpointCheck = { ok: true; url: URL; resolved: string[] } | { ok: false; reason: string };

const PRIVATE_V4 = [
  [/^10\./, "10.0.0.0/8"],
  [/^127\./, "loopback"],
  [/^169\.254\./, "link-local (cloud metadata lives here)"],
  [/^172\.(1[6-9]|2\d|3[01])\./, "172.16.0.0/12"],
  [/^192\.168\./, "192.168.0.0/16"],
  [/^0\./, "0.0.0.0/8"],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, "carrier-grade NAT"],
] as const;

function privateReason(ip: string): string | null {
  if (isIP(ip) === 4) {
    for (const [re, name] of PRIVATE_V4) if (re.test(ip)) return name;
    return null;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return "loopback";
  if (/^f[cd]/.test(v6)) return "unique-local (fc00::/7)";
  if (/^fe[89ab]/.test(v6)) return "link-local";
  if (v6.startsWith("::ffff:")) return privateReason(v6.slice(7));
  return null;
}

export const privateEndpointsAllowed = () => process.env.LIMULUS_ALLOW_PRIVATE_ENDPOINTS === "1";

/**
 * Validates an endpoint before it is stored or called. Scheme, credentials in
 * the URL, and every address the host resolves to are checked; a host that
 * resolves to a private address is refused unless the development allowance
 * is set. The resolved addresses are returned so a caller can see what it is
 * about to talk to.
 */
export async function validateEndpoint(raw: string): Promise<EndpointCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: `scheme must be http or https, not ${url.protocol.replace(":", "")}` };
  if (url.username || url.password) return { ok: false, reason: "credentials in the URL are not accepted; use the authentication field" };
  if (!url.hostname) return { ok: false, reason: "no host" };

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let resolved: string[];
  if (isIP(host)) resolved = [host];
  else if (host === "localhost" || host.endsWith(".localhost")) resolved = ["127.0.0.1"];
  else {
    try {
      resolved = (await lookup(host, { all: true })).map((a) => a.address);
    } catch (e) {
      return { ok: false, reason: `host does not resolve: ${(e as Error).message}` };
    }
    if (resolved.length === 0) return { ok: false, reason: "host does not resolve" };
  }

  if (!privateEndpointsAllowed()) {
    for (const ip of resolved) {
      const why = privateReason(ip);
      if (why) return { ok: false, reason: `${host} resolves to ${ip}, a private address (${why}). The engine only calls public endpoints; set LIMULUS_ALLOW_PRIVATE_ENDPOINTS=1 for local development.` };
    }
  }
  return { ok: true, url, resolved };
}

/** Reads a response body with a hard cap, so a misbehaving endpoint cannot exhaust the engine. */
export async function readCapped(res: Response, maxBytes = 262_144): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { text: Buffer.concat(chunks).toString("utf8"), truncated: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated: false };
}
