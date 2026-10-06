import { config, requireEnv } from "../config.js";
import type { TavilyResult } from "../domain/types.js";
import { withRetry } from "../infrastructure/retry.js";

type TavilyCrawlResult = { url?: string; raw_content?: string; content?: string };

async function tavilyPost(path: string, body: Record<string, unknown>, timeoutMs: number) {
  const apiKey = requireEnv("TAVILY_API_KEY");
  return withRetry(async () => {
    const response = await fetch(`https://api.tavily.com${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`TAVILY_FAILED:${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  });
}

export async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const payload = await tavilyPost("/search", {
    query: query.slice(0, 390),
    topic: "general",
    search_depth: config.tavilyDepth,
    max_results: config.tavilyMaxResults,
    include_answer: false,
    include_raw_content: false,
    include_favicon: false,
  }, 16_000);
  return Array.isArray(payload.results) ? payload.results as TavilyResult[] : [];
}

/**
 * Small, bounded fallback. It is not a provider allow-list: it starts from a search
 * result and lets Tavily discover nearby pages on the same site. We then inspect those
 * URLs ourselves for actual media and never trust crawl text as proof of playability.
 */
export async function tavilyCrawl(startUrl: string, query: string): Promise<TavilyResult[]> {
  const payload = await tavilyPost("/crawl", {
    url: startUrl,
    query: query.slice(0, 300),
    max_depth: 1,
    max_breadth: 4,
    limit: config.tavilyCrawlLimit,
    allow_external: false,
    extract_depth: config.tavilyDepth,
    include_images: false,
  }, 20_000);

  const rows = Array.isArray(payload.results) ? payload.results as TavilyCrawlResult[] : [];
  return rows.flatMap((row) => {
    if (!row?.url) return [];
    return [{
      url: row.url,
      title: row.url,
      content: (row.raw_content ?? row.content ?? "").replace(/\s+/g, " ").slice(0, 900),
      score: 0.35,
    } satisfies TavilyResult];
  });
}
