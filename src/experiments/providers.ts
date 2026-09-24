// Where a model id goes. Every provider here speaks the OpenAI chat-completions
// shape, so one request body works for all of them; only the base URL, the
// credential and the id the provider expects differ.
//
// A model id is "<provider>/<model>". The provider prefix picks the route:
//
//   openai/gpt-4o-mini            api.openai.com            OPENAI_API_KEY
//   google/gemini-2.5-flash       Gemini's OpenAI endpoint  GEMINI_API_KEY or GOOGLE_API_KEY
//   anthropic/claude-sonnet-4-5   Anthropic's OpenAI endpoint ANTHROPIC_API_KEY
//   xai/grok-4                    api.x.ai                  XAI_API_KEY
//   mistral/mistral-large-latest  api.mistral.ai            MISTRAL_API_KEY
//   deepseek/deepseek-chat        api.deepseek.com          DEEPSEEK_API_KEY
//   groq/llama-3.3-70b-versatile  api.groq.com              GROQ_API_KEY
//   openrouter/<vendor>/<model>   openrouter.ai             OPENROUTER_API_KEY
//   claude-cli/opus|sonnet|haiku  the local Claude CLI      no key; the CLI's own login
//
// With no direct key for a provider, the id goes as written to a gateway that
// serves every vendor under the same "<vendor>/<model>" convention: OpenRouter
// (OPENROUTER_API_KEY) or Vercel's AI Gateway (AI_GATEWAY_API_KEY, or the
// VERCEL_OIDC_TOKEN that `vercel env pull` writes). One OpenRouter key is
// enough to compare OpenAI, Google, Anthropic, xAI, Meta, Mistral, DeepSeek
// and the rest. Credentials are read from the environment and never printed.

export type Provider = {
  key: string;
  label: string;
  baseUrl: string;
  env: string[];
  /** The id the provider wants: usually the part after the prefix. */
  strip: boolean;
};

export const PROVIDERS: Provider[] = [
  { key: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", env: ["OPENAI_API_KEY"], strip: true },
  { key: "google", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], strip: true },
  { key: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", env: ["ANTHROPIC_API_KEY"], strip: true },
  { key: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1", env: ["XAI_API_KEY"], strip: true },
  { key: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", env: ["MISTRAL_API_KEY"], strip: true },
  { key: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", env: ["DEEPSEEK_API_KEY"], strip: true },
  { key: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", env: ["GROQ_API_KEY"], strip: true },
  { key: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", env: ["OPENROUTER_API_KEY"], strip: true },
];

/** Gateways take the id as written. First with a credential wins. */
export const GATEWAYS: Provider[] = [
  { key: "openrouter-gateway", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", env: ["OPENROUTER_API_KEY"], strip: false },
  { key: "vercel-gateway", label: "Vercel AI Gateway", baseUrl: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1", env: ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"], strip: false },
];

export const CLAUDE_CLI = "claude-cli";

const keyFor = (p: Provider): string | undefined => p.env.map((e) => process.env[e]).find(Boolean);

export type Route = { provider: Provider; key: string; model: string } | { provider: { key: typeof CLAUDE_CLI; label: string }; model: string };

/** Providers and gateways with a credential in this environment, direct ones first. */
export function configured(): Provider[] {
  return [...PROVIDERS, ...GATEWAYS].filter((p) => keyFor(p));
}

/**
 * The route for an id, or null with a reason. Direct provider first when its
 * key is present, a gateway otherwise; --via forces one.
 */
export function resolve(id: string, via: "auto" | "direct" | "gateway" = "auto"): { route: Route | null; reason?: string } {
  const slash = id.indexOf("/");
  const prefix = slash > 0 ? id.slice(0, slash) : "";
  const rest = slash > 0 ? id.slice(slash + 1) : id;
  if (prefix === CLAUDE_CLI) return { route: { provider: { key: CLAUDE_CLI, label: "Claude CLI" }, model: rest } };
  const direct = PROVIDERS.find((p) => p.key === prefix);
  const directKey = direct ? keyFor(direct) : undefined;
  const gateway = GATEWAYS.find((g) => keyFor(g));
  if (via !== "gateway" && direct && directKey) return { route: { provider: direct, key: directKey, model: direct.strip ? rest : id } };
  if (via !== "direct" && gateway) return { route: { provider: gateway, key: keyFor(gateway)!, model: id } };
  const gatewayVars = GATEWAYS.flatMap((g) => g.env).join(", ");
  if (!direct) return { route: null, reason: `no provider prefix in "${id}" and no gateway credential (${gatewayVars})` };
  return { route: null, reason: `no credential for ${direct.label} (${direct.env.join(" or ")}) and no gateway credential (${gatewayVars})` };
}

export type CatalogEntry = { id: string; provider: string; via: "direct" | "gateway" | "claude-cli"; through?: string };

const CHAT_ID = /^(gpt-|o[1-9]|chatgpt|gemini-|claude-|grok-|mistral-|codestral|magistral|deepseek-|llama|qwen|gemma|mixtral|open-mistral|ministral)/i;
const NOT_CHAT = /embed|tts|whisper|audio|realtime|image|dall-e|moderation|transcribe|search|vision-preview|-live|veo|imagen|aqa|rerank|ocr|guard|safety|batch/i;

/**
 * The models each configured provider says it serves, from its own /models,
 * filtered to chat models by name. Nothing is invented: a provider that does
 * not answer contributes nothing, and an id that is not listed can still be
 * typed by hand.
 */
export async function catalog(timeoutMs = 8000): Promise<{ entries: CatalogEntry[]; problems: string[] }> {
  const entries: CatalogEntry[] = [];
  const problems: string[] = [];
  const gateway = GATEWAYS.find((g) => keyFor(g));
  const seen = new Set<string>();
  await Promise.all(
    [...PROVIDERS.filter((p) => keyFor(p)), ...(gateway ? [gateway] : [])].map(async (p) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${p.baseUrl}/models`, { headers: { authorization: `Bearer ${keyFor(p)}` }, signal: controller.signal });
        if (!res.ok) {
          problems.push(`${p.label}: /models returned ${res.status}`);
          return;
        }
        const body = (await res.json()) as { data?: { id: string }[]; models?: { id: string }[] };
        const ids = (body.data ?? body.models ?? []).map((m) => String(m.id).replace(/^models\//, ""));
        const isGateway = p === gateway;
        for (const raw of ids) {
          const id = isGateway ? raw : `${p.key}/${raw}`;
          if (!id.includes("/")) continue;
          const name = id.slice(id.indexOf("/") + 1);
          if (!CHAT_ID.test(name) || NOT_CHAT.test(name)) continue;
          if (isGateway && PROVIDERS.some((d) => id.startsWith(`${d.key}/`) && keyFor(d))) continue; // a direct route wins
          if (seen.has(id)) continue;
          seen.add(id);
          entries.push({ id, provider: id.slice(0, id.indexOf("/")), via: isGateway ? "gateway" : "direct", ...(isGateway ? { through: p.label } : {}) });
        }
      } catch (e) {
        problems.push(`${p.label}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`);
      } finally {
        clearTimeout(t);
      }
    }),
  );
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, problems };
}
