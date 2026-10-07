import type { VercelRequest } from "@vercel/node";
import { requireAdmin } from "../../../admin/auth.js";
import { ensureCatalogFromTmdb } from "../../../admin/catalog.js";
import { AppError } from "../../../http/errors.js";
import { endpoint } from "../../../http/handler.js";
import type { MediaType } from "../../../services/movie-metadata.js";

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
