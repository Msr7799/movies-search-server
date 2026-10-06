import { createHash } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { config } from "../config.js";
import { MOVIE_LANGUAGES } from "../domain/options.js";
import type { SuggestionResponse } from "../domain/types.js";
import { parseBody } from "../http/body.js";
import { assertJsonBodySize, type RequestContext } from "../http/handler.js";
import { enforceRateLimit } from "../infrastructure/rate-limit.js";
import { cacheGet, cacheSet } from "../infrastructure/store.js";
import { suggestMovies } from "../services/suggestions.js";

const schema = z
  .object({
    query: z.string().trim().max(80, "الحد الأقصى 80 حرفًا."),
    movieLanguage: z
      .enum(
        Object.keys(MOVIE_LANGUAGES) as [
          keyof typeof MOVIE_LANGUAGES,
          ...(keyof typeof MOVIE_LANGUAGES)[],
        ],
      )
      .default("any"),
  })
  .strict();

export async function suggestionsController(
  request: VercelRequest,
  context: RequestContext,
) {
  assertJsonBodySize(request);
  const input = parseBody(request, schema);
  if (input.query.length < 3)
    return {
      suggestions: [],
      meta: { requestId: context.requestId, cached: false },
    };
  await enforceRateLimit("suggest", context.ip, config.suggestLimit, 60);
  const keySource = `${input.movieLanguage}:${input.query.toLocaleLowerCase().normalize("NFKC")}`;
  const cacheKey = `suggest:v1:${createHash("sha256").update(keySource).digest("hex")}`;
  const cached = await cacheGet<SuggestionResponse>(cacheKey);
  if (cached)
    return { ...cached, meta: { requestId: context.requestId, cached: true } };
  const response = await suggestMovies(
    input.query,
    MOVIE_LANGUAGES[input.movieLanguage],
    context.requestId,
  );
  await cacheSet(cacheKey, response, config.suggestCacheSeconds);
  return response;
}
