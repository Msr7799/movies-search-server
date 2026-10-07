import { requireEnv } from "../config.js";
import type { TavilyResult } from "../domain/types.js";
import { withRetry } from "../infrastructure/retry.js";

type SerperOrganicResult = { title?: unknown; link?: unknown; snippet?: unknown; position?: unknown };

/** Normalizes Serper's Google results into the common discovery-search shape. */
export async function serperSearch(query: string, maxResults = 20): Promise<TavilyResult[]> {
  const apiKey = await requireEnv("SERPER_API_KEY");
  return withRetry(async () => {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ q: query.slice(0, 390), num: Math.max(5, Math.min(20, maxResults)) }),
      signal: AbortSignal.timeout(24_000),
    });
    if (!response.ok) throw new Error(`SERPER_FAILED:${response.status}`);
    const payload = await response.json() as { organic?: SerperOrganicResult[] };
    const rows = Array.isArray(payload.organic) ? payload.organic : [];
    return rows.flatMap((row, index) => {
      if (typeof row.link !== "string" || !row.link) return [];
      const position = typeof row.position === "number" ? row.position : index + 1;
      return [{
        ...(typeof row.title === "string" ? { title: row.title } : {}),
        url: row.link,
        content: typeof row.snippet === "string" ? row.snippet.replace(/\s+/g, " ").slice(0, 4000) : "",
        score: Math.max(0.15, 1 - Math.max(0, position - 1) * 0.045),
      } satisfies TavilyResult];
    });
  });
}
