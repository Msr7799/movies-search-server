import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listPublicCatalog } from "../src/admin/catalog.js";
import { healthController } from "../src/controllers/health-controller.js";
import { mediaController } from "../src/controllers/media-controller.js";
import { providersController } from "../src/controllers/providers-controller.js";
import { searchController } from "../src/controllers/search-controller.js";
import { suggestionsController } from "../src/controllers/suggestions-controller.js";
import { AppError } from "../src/http/errors.js";
import { endpoint } from "../src/http/handler.js";
import { movieMetadata, searchTmdb, tmdbMetadata, type MediaType } from "../src/services/movie-metadata.js";

function routeFor(request: VercelRequest) {
  const value = request.query.route;
  const raw = Array.isArray(value) ? value.join("/") : typeof value === "string" ? value : "";
  return raw.replace(/^\/+|\/+$/g, "");
}

function jsonBody(request: VercelRequest) {
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) as unknown : request.body;
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    throw new AppError(400, "INVALID_JSON", "صيغة JSON غير صالحة.");
  }
}

function deterministicTmdbId(tmdbId: number, mediaType: MediaType) {
  return createHash("sha256").update(`tmdb:${mediaType}:${tmdbId}`).digest("hex").slice(0, 24);
}

const rootHandler = endpoint(["GET"], (_request, context) => ({
  name: "Any Movie API",
  version: "2.3.0",
  status: "ok",
  documentation: "/api/openapi",
  endpoints: {
    health: "/api/v1/health",
    providers: "/api/v1/providers",
    suggestions: "/api/v1/suggestions",
    search: "/api/v1/search",
    media: "/api/v1/media",
    catalog: "/api/v1/catalog",
    movieMetadata: "/api/v1/movie-metadata?title=Inception%202010",
    tmdbSearch: "/api/v1/tmdb/search?q=Inception&type=multi",
    tmdbDetails: "/api/v1/tmdb/details?id=27205&type=movie",
    admin: "/admin",
  },
  requestId: context.requestId,
}));

const healthHandler = endpoint(["GET"], healthController);
const providersHandler = endpoint(["GET"], providersController);
const searchHandler = endpoint(["POST"], searchController);
const suggestionsHandler = endpoint(["POST"], suggestionsController);
const mediaHandler = endpoint(["POST"], mediaController);

const catalogHandler = endpoint(["GET"], async () => ({
  movies: await listPublicCatalog(),
  updatedAt: new Date().toISOString(),
}));

const metadataHandler = endpoint(["GET"], async (request: VercelRequest) => {
  const title = typeof request.query.title === "string" ? request.query.title.trim() : "";
  if (title.length < 2 || title.length > 180) {
    throw new AppError(400, "INVALID_TITLE", "اسم الفيلم غير صالح.");
  }
  return { metadata: await movieMetadata(title) };
});

const tmdbSearchHandler = endpoint(["GET"], async (request: VercelRequest) => {
  const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (q.length < 2 || q.length > 120) {
    throw new AppError(400, "INVALID_QUERY", "اكتب اسم فيلم أو مسلسل صالحاً.");
  }
  const rawType = typeof request.query.type === "string" ? request.query.type : "multi";
  const type: MediaType | "multi" = rawType === "movie" || rawType === "tv" ? rawType : "multi";
  return { results: await searchTmdb(q, type, 14) };
});

const tmdbDetailsHandler = endpoint(["GET"], async (request: VercelRequest) => {
  const id = Number(typeof request.query.id === "string" ? request.query.id : 0);
  const rawType = typeof request.query.type === "string" ? request.query.type : "movie";
  const type: MediaType = rawType === "tv" ? "tv" : "movie";
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "INVALID_TMDB_ID", "معرّف TMDB غير صالح.");
  }
  return { metadata: await tmdbMetadata(id, type) };
});

const catalogFromTmdbHandler = endpoint(["POST"], async (request: VercelRequest) => {
  const body = jsonBody(request);
  const tmdbId = Number(body.tmdbId ?? 0);
  const mediaType: MediaType = body.mediaType === "tv" ? "tv" : "movie";
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new AppError(400, "INVALID_TMDB_ID", "معرّف TMDB غير صالح.");
  }

  const metadata = await tmdbMetadata(tmdbId, mediaType);
  const now = new Date().toISOString();
  return {
    movie: {
      id: deterministicTmdbId(tmdbId, mediaType),
      title: metadata.title,
      ...(metadata.originalTitle ? { originalTitle: metadata.originalTitle } : {}),
      ...(metadata.overview ? { description: metadata.overview } : {}),
      ...(metadata.poster ? { poster: metadata.poster } : {}),
      ...(metadata.backdrop ? { backdrop: metadata.backdrop } : {}),
      ...(metadata.releaseDate ? { releaseDate: metadata.releaseDate } : {}),
      ...(metadata.year ? { year: metadata.year } : {}),
      ...(metadata.runtime ? { runtime: metadata.runtime } : {}),
      ...(metadata.rating !== undefined ? { tmdbRating: metadata.rating } : {}),
      genres: metadata.genres,
      categories: [],
      images: metadata.images,
      trailers: metadata.trailers,
      directors: metadata.directors,
      writers: metadata.writers,
      cast: metadata.cast,
      tmdbId,
      mediaType,
      status: "metadata_only",
      sources: [],
      subtitles: [],
      createdAt: now,
      updatedAt: now,
    },
  };
});

export default function handler(request: VercelRequest, response: VercelResponse) {
  const route = routeFor(request);

  switch (route) {
    case "":
      return rootHandler(request, response);
    case "health":
      return healthHandler(request, response);
    case "providers":
      return providersHandler(request, response);
    case "catalog":
      return catalogHandler(request, response);
    case "movie-metadata":
      return metadataHandler(request, response);
    case "suggestions":
      return suggestionsHandler(request, response);
    case "search":
      return searchHandler(request, response);
    case "media":
      return mediaHandler(request, response);
    case "tmdb/search":
      return tmdbSearchHandler(request, response);
    case "tmdb/details":
      return tmdbDetailsHandler(request, response);
    case "catalog/from-tmdb":
      return catalogFromTmdbHandler(request, response);
    default:
      response.setHeader("Cache-Control", "no-store");
      return response.status(404).json({
        error: {
          code: "ROUTE_NOT_FOUND",
          message: "المسار المطلوب غير موجود.",
        },
      });
  }
}
