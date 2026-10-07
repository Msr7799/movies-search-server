import type { VercelRequest } from "@vercel/node";
import { endpoint } from "../../../http/handler.js";
import { searchTmdb, type MediaType } from "../../../services/movie-metadata.js";
import { AppError } from "../../../http/errors.js";

export default endpoint(["GET"], async (request: VercelRequest) => {
  const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (q.length < 2 || q.length > 120) throw new AppError(400, "INVALID_QUERY", "اكتب اسم فيلم أو مسلسل صالحاً.");
  const rawType = typeof request.query.type === "string" ? request.query.type : "multi";
  const type: MediaType | "multi" = rawType === "movie" || rawType === "tv" ? rawType : "multi";
  return { results: await searchTmdb(q, type, 14) };
});
