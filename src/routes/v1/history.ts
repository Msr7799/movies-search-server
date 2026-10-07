import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { recordPlaybackHistory } from "../../admin/history.js";
import { AppError } from "../../http/errors.js";
import { endpoint, type RequestContext } from "../../http/handler.js";
import { enforceRateLimit } from "../../infrastructure/rate-limit.js";
import { parseBody } from "../../http/body.js";

const schema = z.object({
  visitorId: z.string().uuid(),
  movieId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),
  movie: z.object({
    id: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(180),
    poster: z.string().url().max(4_000).refine((value) => value.startsWith("https://")).optional(),
  }).strict(),
  progress: z.number().finite().min(0).max(86_400_000),
  duration: z.number().finite().min(0).max(86_400_000),
  watchedAt: z.number().int().positive(),
}).strict();

async function controller(request: VercelRequest, context: RequestContext) {
  const input = parseBody(request, schema);
  await enforceRateLimit("playback-history", context.ip, 120, 600);
  if (input.movieId !== input.movie.id) {
    throw new AppError(400, "INVALID_MOVIE_ID", "معرّف الفيلم غير متطابق.");
  }
  return recordPlaybackHistory({
    ...input,
    movie: {
      id: input.movie.id,
      title: input.movie.title,
      ...(input.movie.poster ? { poster: input.movie.poster } : {}),
    },
  });
}

export default endpoint(["POST"], controller);
