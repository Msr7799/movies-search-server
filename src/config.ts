import { effectiveSecret, type ManagedKey } from "./admin/settings.js";

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}
function csv(value: string | undefined, fallback: string[]) {
  const values =
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  return values.length > 0 ? [...new Set(values)] : fallback;
}

export const config = {
  get allowedOrigins() {
    return csv(process.env.ALLOWED_ORIGINS, []);
  },
  get searchModels() {
    return csv(
      process.env.GEMINI_SEARCH_MODELS ?? process.env.GEMINI_MODELS_LITE,
      ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
    );
  },
  get suggestModels() {
    return csv(
      process.env.GEMINI_SUGGEST_MODELS ?? process.env.GEMINI_MODELS_LITE,
      ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
    );
  },
  get searchLimit() {
    return integer("SEARCH_LIMIT_PER_10_MINUTES", 20, 1, 100);
  },
  get suggestLimit() {
    return integer("SUGGEST_LIMIT_PER_MINUTE", 20, 1, 200);
  },
  get searchCacheSeconds() {
    return integer("SEARCH_CACHE_SECONDS", 21_600, 60, 604_800);
  },
  get suggestCacheSeconds() {
    return integer("SUGGEST_CACHE_SECONDS", 86_400, 60, 604_800);
  },
  get tavilyDepth() {
    const value = process.env.TAVILY_SEARCH_DEPTH;
    if (value === "advanced" || value === "fast" || value === "ultra-fast") return value;
    return "basic" as const;
  },
  get tavilyMaxResults() {
    return integer("TAVILY_MAX_RESULTS", 20, 5, 20);
  },
  get tavilyCrawlLimit() {
    return integer("TAVILY_CRAWL_LIMIT", 24, 4, 80);
  },
  get tavilyCrawlRoots() {
    return integer("TAVILY_CRAWL_ROOTS", 3, 0, 6);
  },
  get tavilyCrawlDepth() {
    return integer("TAVILY_CRAWL_DEPTH", 2, 1, 5);
  },
  get tavilyCrawlBreadth() {
    return integer("TAVILY_CRAWL_BREADTH", 20, 1, 80);
  },
  get tavilyCrawlTimeoutSeconds() {
    return integer("TAVILY_CRAWL_TIMEOUT_SECONDS", 35, 10, 60);
  },
  get tavilyCrawlExtractDepth() {
    return process.env.TAVILY_CRAWL_EXTRACT_DEPTH === "advanced" ? ("advanced" as const) : ("basic" as const);
  },
  get region() {
    return (process.env.APP_REGION || "").slice(0, 80);
  },
};

export async function requireEnv(name: ManagedKey) {
  const value = await effectiveSecret(name);
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

export async function serviceReadiness() {
  const [tavily, geminiSearch, geminiSuggestions] = await Promise.all([
    effectiveSecret("TAVILY_API_KEY"),
    effectiveSecret("GEMINI_API_KEY"),
    effectiveSecret("GEMINI_AUTO_SUGGESTED_API_KEY"),
  ]);
  return {
    tavily: Boolean(tavily),
    geminiSearch: Boolean(geminiSearch),
    geminiSuggestions: Boolean(geminiSuggestions),
    distributedStore: Boolean(
      process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN,
    ),
  };
}
