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

/**
 * General web search. There is deliberately no content-provider/domain allow-list.
 * The only filtering left here is Tavily's safety filter and later network-safety checks.
 */
export async function tavilySearch(query: string, maxResults = config.tavilyMaxResults, depth: "basic" | "advanced" | "fast" | "ultra-fast" = config.tavilyDepth): Promise<TavilyResult[]> {
  const body: Record<string, unknown> = {
    query: query.slice(0, 390),
    topic: "general",
    max_results: Math.max(5, Math.min(20, config.tavilyMaxResults, maxResults)),
    chunks_per_source: 3,
    include_answer: false,
    include_raw_content: false,
    include_favicon: false,
    include_domains: [],
    exclude_domains: [],
    filter_by_language: false,
    exact_match: false,
    // Keep adult/unsafe pages out of a general movie search. This is not a provider/domain restriction.
    safe_search: true,
    auto_parameters: false,
    search_depth: depth,
  };

  const payload = await tavilyPost("/search", body, 24_000);
  return Array.isArray(payload.results) ? payload.results as TavilyResult[] : [];
}

/**
 * Bounded open-web crawl fallback. It starts from a search result, may surface external
 * player/embed links, and only contributes candidate URLs. Media still has to pass the
 * server-side HTTPS/SSRF and HLS/video verification pipeline.
 */
export async function tavilyCrawl(startUrl: string, instructions: string): Promise<TavilyResult[]> {
  const payload = await tavilyPost("/crawl", {
    url: startUrl,
    instructions: instructions.slice(0, 600),
    chunks_per_source: 5,
    max_depth: config.tavilyCrawlDepth,
    max_breadth: config.tavilyCrawlBreadth,
    limit: config.tavilyCrawlLimit,
    allow_external: true,
    extract_depth: config.tavilyCrawlExtractDepth,
    format: "text",
    include_images: false,
    timeout: config.tavilyCrawlTimeoutSeconds,
  }, (config.tavilyCrawlTimeoutSeconds + 10) * 1000);

  const rows = Array.isArray(payload.results) ? payload.results as TavilyCrawlResult[] : [];
  return rows.flatMap((row) => {
    if (!row?.url) return [];
    return [{
      url: row.url,
      title: row.url,
      content: (row.raw_content ?? row.content ?? "").replace(/\s+/g, " ").slice(0, 1500),
      score: 0.35,
    } satisfies TavilyResult];
  });
}
