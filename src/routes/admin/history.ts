import type { VercelRequest } from "@vercel/node";
import { requireAdmin } from "../../admin/auth.js";
import { deletePlaybackHistory, listPlaybackHistory, renamePlaybackHistory } from "../../admin/history.js";
import { AppError } from "../../http/errors.js";
import { endpoint } from "../../http/handler.js";

async function controller(request: VercelRequest) {
  requireAdmin(request);
  if (request.method === "GET") return { history: await listPlaybackHistory() };

  if (request.method === "DELETE") {
    const movieId = typeof request.query.movieId === "string" ? request.query.movieId : "";
    if (!movieId) throw new AppError(400, "INVALID_MOVIE_ID", "معرّف الفيلم غير صالح.");
    return { deleted: await deletePlaybackHistory(movieId) };
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body) as unknown : request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "INVALID_JSON", "الطلب غير صالح.");
  }
  const input = body as Record<string, unknown>;
  const movieId = typeof input.movieId === "string" ? input.movieId.trim() : "";
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim().slice(0, 180) : "";
  if (!movieId || title.length < 2) throw new AppError(400, "INVALID_HISTORY_UPDATE", "اسم الفيلم أو معرّفه غير صالح.");
  const updated = await renamePlaybackHistory(movieId, title);
  if (updated === 0) throw new AppError(404, "HISTORY_NOT_FOUND", "الفيلم غير موجود في السجل.");
  return { updated, title };
}

export default endpoint(["GET", "PATCH", "DELETE"], controller);
