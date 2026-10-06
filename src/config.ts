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
    return integer("SEARCH_LIMIT_PER_10_MINUTES", 5, 1, 100);
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
    return process.env.TAVILY_SEARCH_DEPTH === "advanced"
      ? ("advanced" as const)
      : ("basic" as const);
  },
  get region() {
    return (process.env.APP_REGION || "Bahrain").slice(0, 80);
  },
};

export function requireEnv(
  name: "TAVILY_API_KEY" | "GEMINI_API_KEY" | "GEMINI_AUTO_SUGGESTED_API_KEY",
) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

export function serviceReadiness() {
  return {
    tavily: Boolean(process.env.TAVILY_API_KEY),
    geminiSearch: Boolean(process.env.GEMINI_API_KEY),
    geminiSuggestions: Boolean(process.env.GEMINI_AUTO_SUGGESTED_API_KEY),
    distributedStore: Boolean(
      process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN,
    ),
  };
}
