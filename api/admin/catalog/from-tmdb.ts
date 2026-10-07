import type { VercelRequest } from "@vercel/node";
import { requireAdmin } from "../../../src/admin/auth.js";
import { ensureCatalogFromTmdb } from "../../../src/admin/catalog.js";
import { AppError } from "../../../src/http/errors.js";
import { endpoint } from "../../../src/http/handler.js";
import type { MediaType } from "../../../src/services/movie-metadata.js";

export default endpoint(["POST"], async (request: VercelRequest) => {
  requireAdmin(request);
  const body = typeof request.body === "string"
    ? JSON.parse(request.body) as Record<string, unknown>
    : request.body as Record<string, unknown> | undefined;
  const tmdbId = Number(body?.tmdbId ?? 0);
  const mediaType: MediaType = body?.mediaType === "tv" ? "tv" : "movie";
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new AppError(400, "INVALID_TMDB_ID", "معرّف TMDB غير صالح.");
  }
  return { movie: await ensureCatalogFromTmdb(tmdbId, mediaType) };
});
