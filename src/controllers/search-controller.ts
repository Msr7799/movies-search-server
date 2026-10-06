import { createHash } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { config } from "../config.js";
import { MOVIE_LANGUAGES, SUBTITLE_LANGUAGES } from "../domain/options.js";
import { getProviderConfigSignature } from "../domain/providers.js";
import type { DiscoveryResponse } from "../domain/types.js";
import { cacheGet, cacheSet } from "../infrastructure/store.js";
import { enforceRateLimit } from "../infrastructure/rate-limit.js";
import { searchMovies } from "../services/movie-search.js";
import { parseBody } from "../http/body.js";
import { assertJsonBodySize, type RequestContext } from "../http/handler.js";

const schema = z.object({
  query: z.string().trim().min(2, "اكتب حرفين على الأقل.").max(120, "الحد الأقصى 120 حرفًا."),
  movieLanguage: z.enum(Object.keys(MOVIE_LANGUAGES) as [keyof typeof MOVIE_LANGUAGES, ...(keyof typeof MOVIE_LANGUAGES)[]]).default("any"),
  subtitleLanguage: z.enum(Object.keys(SUBTITLE_LANGUAGES) as [keyof typeof SUBTITLE_LANGUAGES, ...(keyof typeof SUBTITLE_LANGUAGES)[]]).default("any"),
  allowShortClips: z.boolean().default(false),
}).strict();

export async function searchController(request: VercelRequest, context: RequestContext) {
  assertJsonBodySize(request);
  const input = parseBody(request, schema);
  await enforceRateLimit("search", context.ip, config.searchLimit, 600);
  const normalized = { ...input, query: input.query.toLocaleLowerCase().normalize("NFKC") };
  const hash = createHash("sha256").update(JSON.stringify({ ...normalized, providers: getProviderConfigSignature() })).digest("hex");
  const cacheKey = `search:v2:${hash}`;
  const cached = await cacheGet<DiscoveryResponse>(cacheKey);
  if (cached) return { ...cached, meta: { ...cached.meta, requestId: context.requestId, cached: true } };

  const response = await searchMovies({
    query: input.query,
    movieLanguage: MOVIE_LANGUAGES[input.movieLanguage],
    subtitleLanguage: SUBTITLE_LANGUAGES[input.subtitleLanguage],
    allowShortClips: input.allowShortClips,
  }, context.requestId);
  await cacheSet(cacheKey, response, config.searchCacheSeconds);
  return response;
}
