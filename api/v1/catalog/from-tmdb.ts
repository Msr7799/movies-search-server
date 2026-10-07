import { createHash } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { endpoint } from "../../../src/http/handler.js";
import { AppError } from "../../../src/http/errors.js";
import { tmdbMetadata, type MediaType } from "../../../src/services/movie-metadata.js";

function idFor(tmdbId: number, mediaType: MediaType) {
  return createHash("sha256").update(`tmdb:${mediaType}:${tmdbId}`).digest("hex").slice(0, 24);
}

/**
 * Public clients may resolve TMDB metadata for their own private library, but this
 * route deliberately does not write to MongoDB and never accepts playback URLs.
 * Publishing to the shared catalog remains an authenticated admin operation.
 */
export default endpoint(["POST"], async (request: VercelRequest) => {
  const body = typeof request.body === "string"
    ? JSON.parse(request.body) as Record<string, unknown>
    : request.body as Record<string, unknown> | undefined;
  const tmdbId = Number(body?.tmdbId ?? 0);
  const mediaType: MediaType = body?.mediaType === "tv" ? "tv" : "movie";
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new AppError(400, "INVALID_TMDB_ID", "معرّف TMDB غير صالح.");
  }
  const metadata = await tmdbMetadata(tmdbId, mediaType);
  return {
    movie: {
      id: idFor(tmdbId, mediaType),
      title: metadata.title,
      description: metadata.overview,
      poster: metadata.poster,
      backdrop: metadata.backdrop,
      genres: metadata.genres,
      categories: [],
      year: metadata.year,
      tmdbRating: metadata.rating,
      tmdbId,
      mediaType,
      status: "metadata_only",
      sources: [],
      subtitles: [],
      images: metadata.images,
      trailers: metadata.trailers,
      directors: metadata.directors,
      writers: metadata.writers,
      cast: metadata.cast,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
});
