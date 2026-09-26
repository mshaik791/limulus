// The provider behind a model id, and its mark. A mark is the provider's own
// file (public/providers, see LICENSE.txt there), painted in the current text
// colour through a CSS mask so it sits on either theme like the Limulus mark
// does. A provider without a file on disk gets a lettermark tile, never a
// redrawn logo. Nothing here decides anything: it only says who served a
// model, from the id the endpoint reported.

export type Provider = { key: string; name: string; file?: string; letters: string };

const PROVIDERS: Record<string, Provider> = {
  openai: { key: "openai", name: "OpenAI", file: "openai.svg", letters: "OA" },
  anthropic: { key: "anthropic", name: "Anthropic", file: "anthropic.svg", letters: "A" },
  google: { key: "google", name: "Google", file: "googlegemini.svg", letters: "G" },
  deepseek: { key: "deepseek", name: "DeepSeek", file: "deepseek.svg", letters: "DS" },
  meta: { key: "meta", name: "Meta", file: "meta.svg", letters: "M" },
  mistral: { key: "mistral", name: "Mistral", file: "mistralai.svg", letters: "Mi" },
  qwen: { key: "qwen", name: "Qwen", file: "qwen.svg", letters: "Q" },
  xai: { key: "xai", name: "xAI", letters: "xAI" },
  cohere: { key: "cohere", name: "Cohere", letters: "Co" },
  perplexity: { key: "perplexity", name: "Perplexity", letters: "P" },
  amazon: { key: "amazon", name: "Amazon", letters: "Am" },
  moonshot: { key: "moonshot", name: "Moonshot", letters: "Mo" },
  zai: { key: "zai", name: "Z.ai", letters: "Z" },
  nvidia: { key: "nvidia", name: "NVIDIA", letters: "Nv" },
  microsoft: { key: "microsoft", name: "Microsoft", letters: "MS" },
};

const VENDOR_KEY: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  "claude-cli": "anthropic",
  google: "google",
  deepseek: "deepseek",
  meta: "meta",
  "meta-llama": "meta",
  mistral: "mistral",
  mistralai: "mistral",
  qwen: "qwen",
  alibaba: "qwen",
  xai: "xai",
  "x-ai": "xai",
  cohere: "cohere",
  perplexity: "perplexity",
  amazon: "amazon",
  moonshotai: "moonshot",
  zai: "zai",
  "z-ai": "zai",
  nvidia: "nvidia",
  microsoft: "microsoft",
};

// Family words for ids that arrive without a vendor prefix (a bare CLI alias
// such as "opus", or a snapshot name). Checked in order; first match wins.
const FAMILY_KEY: [RegExp, string][] = [
  [/^(opus|sonnet|haiku|claude)/, "anthropic"],
  [/^(gpt|o[1-9]|chatgpt|davinci)/, "openai"],
  [/^gemini/, "google"],
  [/^grok/, "xai"],
  [/^llama/, "meta"],
  [/^(mistral|mixtral|codestral)/, "mistral"],
  [/^deepseek/, "deepseek"],
  [/^qwen/, "qwen"],
];

/** The provider a model id names, or null when the id says nothing about one. */
export function providerOf(model?: string | null): Provider | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  if (slash > 0) {
    const vendor = model.slice(0, slash).toLowerCase();
    const key = VENDOR_KEY[vendor];
    if (key) return PROVIDERS[key];
  }
  const raw = (slash > 0 ? model.slice(slash + 1) : model).toLowerCase();
  for (const [re, key] of FAMILY_KEY) if (re.test(raw)) return PROVIDERS[key];
  return null;
}

/**
 * The mark itself. `size` is the box in px; the mark fills it. With no
 * provider known, renders nothing: a blank is more honest than a guess.
 */
export function ProviderMark({ model, provider, size = 20, className = "" }: { model?: string | null; provider?: Provider | null; size?: number; className?: string }) {
  const p = provider ?? providerOf(model);
  if (!p) return null;
  if (p.file) {
    const url = `url(/providers/${p.file})`;
    return (
      <span
        role="img"
        aria-label={p.name}
        title={p.name}
        className={`provider-mark inline-block shrink-0 align-middle ${className}`}
        style={{ width: size, height: size, background: "currentColor", WebkitMaskImage: url, maskImage: url, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskPosition: "center", maskPosition: "center" }}
      />
    );
  }
  return (
    <span role="img" aria-label={p.name} title={p.name} className={`provider-mark inline-flex shrink-0 items-center justify-center rounded-[5px] border border-line-2 align-middle font-semibold leading-none text-ink-2 ${className}`} style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}>
      {p.letters}
    </span>
  );
}
