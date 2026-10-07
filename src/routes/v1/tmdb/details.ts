import type { VercelRequest } from "@vercel/node";
import { endpoint } from "../../../http/handler.js";
import { tmdbMetadata, type MediaType } from "../../../services/movie-metadata.js";
import { AppError } from "../../../http/errors.js";

export default endpoint(["GET"], async (request: VercelRequest) => {
  const id = Number(typeof request.query.id === "string" ? request.query.id : 0);
  const rawType = typeof request.query.type === "string" ? request.query.type : "movie";
  const type: MediaType = rawType === "tv" ? "tv" : "movie";
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "INVALID_TMDB_ID", "معرّف TMDB غير صالح.");
  return { metadata: await tmdbMetadata(id, type) };
});
