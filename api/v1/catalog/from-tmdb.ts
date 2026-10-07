import type { VercelRequest } from "@vercel/node";
import { endpoint } from "../../../src/http/handler.js";
import { AppError } from "../../../src/http/errors.js";
import { ensureCatalogFromTmdb } from "../../../src/admin/catalog.js";
import type { MediaType } from "../../../src/services/movie-metadata.js";

export default endpoint(["POST"], async (request: VercelRequest) => {
  const body = typeof request.body === "string" ? JSON.parse(request.body) as Record<string, unknown> : request.body as Record<string, unknown> | undefined;
  const tmdbId = Number(body?.tmdbId ?? 0);
  const mediaType: MediaType = body?.mediaType === "tv" ? "tv" : "movie";
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new AppError(400, "INVALID_TMDB_ID", "معرّف TMDB غير صالح.");
  // This route accepts only a TMDB id/type. All metadata is fetched server-side from TMDB,
  // so normal users cannot inject arbitrary titles, URLs or playback sources into the catalog.
  return { movie: await ensureCatalogFromTmdb(tmdbId, mediaType) };
});
