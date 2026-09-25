// The model agent: a local server that puts any chat model behind the Lab's
// agent endpoint (src/experiments/model-agent.ts). The console reads its
// health to offer models in the Arena; it never holds a provider key itself.

export const MODEL_AGENT = process.env.LIMULUS_MODEL_AGENT ?? "http://localhost:9100";

export type ModelEntry = { id: string; provider: string; via: "direct" | "gateway" | "claude-cli"; through?: string };
export type ModelAgentHealth = { ok: boolean; endpoint: string; providers: { key: string; label: string }[]; models: ModelEntry[]; problems: string[] };

/** Null when the model agent is not running. */
export async function modelAgent(): Promise<ModelAgentHealth | null> {
  try {
    const res = await fetch(`${MODEL_AGENT}/health`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return (await res.json()) as ModelAgentHealth;
  } catch {
    return null;
  }
}

/** The agent endpoint for one model id, as an arm URL. */
export const modelEndpoint = (id: string) => `${MODEL_AGENT}/agent?model=${encodeURIComponent(id)}`;

const VENDOR: Record<string, string> = { openai: "OpenAI", google: "Google", anthropic: "Anthropic", "claude-cli": "Claude (local CLI)", xai: "xAI", "x-ai": "xAI", meta: "Meta", "meta-llama": "Meta", mistral: "Mistral", mistralai: "Mistral", deepseek: "DeepSeek", alibaba: "Alibaba", qwen: "Qwen", groq: "Groq", cohere: "Cohere", amazon: "Amazon", perplexity: "Perplexity", moonshotai: "Moonshot", zai: "Z.ai", "z-ai": "Z.ai", openrouter: "OpenRouter", nvidia: "NVIDIA", microsoft: "Microsoft" };
export const vendorName = (key: string) => VENDOR[key] ?? key;

/** A short arm label for a model id: "GPT-4o mini", "Gemini 2.5 Flash"; the id itself when nothing better is known. */
export function armLabel(id: string): string {
  const name = id.slice(id.indexOf("/") + 1);
  if (id.startsWith("claude-cli/")) return `Claude ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return name;
}
