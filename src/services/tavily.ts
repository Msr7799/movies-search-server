import { config, requireEnv } from "../config.js";
import type { TavilyResult } from "../domain/types.js";
import { withRetry } from "../infrastructure/retry.js";

type TavilyCrawlResult = { url?: string; raw_content?: string; content?: string };

async function tavilyPost(path: string, body: Record<string, unknown>, timeoutMs: number) {
  const apiKey = await requireEnv("TAVILY_API_KEY");
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
export async function tavilySearch(
  query: string,
  maxResults = config.tavilyMaxResults,
  depth: "basic" | "advanced" | "fast" | "ultra-fast" = config.tavilyDepth,
  includeRawContent = false,
): Promise<TavilyResult[]> {
  const body: Record<string, unknown> = {
    query: query.slice(0, 390),
    topic: "general",
    max_results: Math.max(5, Math.min(20, config.tavilyMaxResults, maxResults)),
    chunks_per_source: 3,
    include_answer: false,
    include_raw_content: includeRawContent,
    include_favicon: false,
    // Keep general web search safe without restricting it to any provider/domain.
    safe_search: true,
    auto_parameters: false,
    search_depth: depth,
  };

  const payload = await tavilyPost("/search", body, includeRawContent ? 30_000 : 24_000);
  const rows = Array.isArray(payload.results) ? payload.results as Array<TavilyResult & { raw_content?: unknown }> : [];
  return rows.map((row) => {
    const raw = typeof row.raw_content === "string" ? row.raw_content.replace(/\s+/g, " ").slice(0, 3200) : "";
    const snippet = typeof row.content === "string" ? row.content.replace(/\s+/g, " ") : "";
    return {
      ...(typeof row.title === "string" ? { title: row.title } : {}),
      ...(typeof row.url === "string" ? { url: row.url } : {}),
      content: [snippet, raw].filter(Boolean).join(" ").slice(0, 4000),
      ...(typeof row.score === "number" ? { score: row.score } : {}),
    };
  });
}

/**
 * Bounded open-web crawl fallback. It starts from a search result, may surface external
 * player/embed links, and only contributes candidate URLs. Media still has to pass the
 * server-side HTTP(S)/SSRF and HLS/video verification pipeline.
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
