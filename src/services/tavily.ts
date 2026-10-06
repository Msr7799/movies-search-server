import { config, requireEnv } from "../config.js";
import type { TavilyResult } from "../domain/types.js";
import { withRetry } from "../infrastructure/retry.js";

export async function tavilySearch(query: string, includeDomains: readonly string[]): Promise<TavilyResult[]> {
  const apiKey = requireEnv("TAVILY_API_KEY");
  return withRetry(async () => {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: query.slice(0, 390),
        topic: "general",
        search_depth: config.tavilyDepth,
        max_results: 8,
        include_answer: false,
        include_raw_content: false,
        include_favicon: false,
        include_domains: includeDomains,
        include_domains_mode: "restrict",
      }),
      signal: AbortSignal.timeout(16_000),
    });
    if (!response.ok) throw new Error(`TAVILY_FAILED:${response.status}`);
    const payload = await response.json() as { results?: TavilyResult[] };
    return payload.results ?? [];
  });
}
