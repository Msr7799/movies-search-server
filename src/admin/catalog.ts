import { createHash } from "node:crypto";
import { database } from "../infrastructure/mongodb.js";
import { tmdbMetadata, type MediaType, type MovieMetadata, type Person } from "../services/movie-metadata.js";

export type CatalogStatus = "metadata_only" | "draft" | "published" | "archived";
export type CatalogSource = { id?: string; url: string; quality: string; resolution?: string; bandwidth?: number; master?: string };
export type CatalogMovie = {
  id: string;
  title: string;
  pageUrl?: string;
  createdAt: string;
  sources: CatalogSource[];
  updatedAt: string;
  poster?: string;
  backdrop?: string;
  description?: string;
  originalTitle?: string;
  releaseDate?: string;
  year?: number;
  runtime?: number;
  tmdbRating?: number;
  tmdbId?: number;
  mediaType: MediaType;
  status: CatalogStatus;
  sortOrder?: number;
  categories?: string[];
  genres?: string[];
  images?: string[];
  trailers?: string[];
  cast?: Person[];
  directors?: Person[];
};

function webUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4_000) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : undefined;
  } catch { return undefined; }
}

function hlsUrl(value: unknown) {
  const url = webUrl(value);
  if (!url) return undefined;
  return /\.m3u8(?:$|[?#])/i.test(url) ? url : undefined;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function catalogIdFromTmdb(tmdbId: number, mediaType: MediaType) {
  return createHash("sha256").update(`tmdb:${mediaType}:${tmdbId}`).digest("hex").slice(0, 24);
}

function fromMetadata(metadata: MovieMetadata, status: CatalogStatus = "metadata_only"): CatalogMovie {
  if (!metadata.tmdbId) throw new Error("INVALID_TMDB_ID");
  const now = new Date().toISOString();
  return {
    id: catalogIdFromTmdb(metadata.tmdbId, metadata.mediaType),
    title: metadata.title,
    ...(metadata.originalTitle ? { originalTitle: metadata.originalTitle } : {}),
    ...(metadata.overview ? { description: metadata.overview } : {}),
    ...(metadata.releaseDate ? { releaseDate: metadata.releaseDate } : {}),
    ...(metadata.year ? { year: metadata.year } : {}),
    ...(metadata.runtime ? { runtime: metadata.runtime } : {}),
    ...(metadata.rating !== undefined ? { tmdbRating: metadata.rating } : {}),
    ...(metadata.poster ? { poster: metadata.poster } : {}),
    ...(metadata.backdrop ? { backdrop: metadata.backdrop } : {}),
    tmdbId: metadata.tmdbId,
    mediaType: metadata.mediaType,
    status,
    genres: metadata.genres,
    categories: metadata.genres,
    images: metadata.images,
    trailers: metadata.trailers,
    cast: metadata.cast,
    directors: metadata.directors,
    sources: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function parseCollectorCatalog(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CATALOG_JSON");
  const root = value as Record<string, unknown>;
  const inputRows = Array.isArray(root.movies) ? root.movies : Object.values(root);
  const movies: CatalogMovie[] = [];
  for (const [position, item] of inputRows.slice(0, 500).entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const title = text(row.title, 180);
    const suppliedPageUrl = webUrl(row.pageURL) ?? webUrl(row.pageUrl) ?? webUrl(row.url);
    const streams = Array.isArray(row.streams) ? row.streams : Array.isArray(row.qualities) ? row.qualities : Array.isArray(row.sources) ? row.sources : [];
    const sources: CatalogSource[] = [];
    const seen = new Set<string>();
    for (const [sourceIndex, stream] of streams.slice(0, 40).entries()) {
      if (!stream || typeof stream !== "object" || Array.isArray(stream)) continue;
      const source = stream as Record<string, unknown>;
      const url = hlsUrl(source.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const master = hlsUrl(source.master) ?? hlsUrl(source.masterURL);
      sources.push({
        id: createHash("sha256").update(url).digest("hex").slice(0, 12),
        url,
        quality: text(source.quality, 30) || text(source.label, 60) || `HLS ${sourceIndex + 1}`,
        ...(text(source.resolution, 30) ? { resolution: text(source.resolution, 30) } : {}),
        ...(typeof source.bandwidth === "number" && Number.isFinite(source.bandwidth) ? { bandwidth: Math.max(0, Math.round(source.bandwidth)) } : {}),
        ...(master ? { master } : {}),
      });
    }
    const pageUrl = suppliedPageUrl ?? sources[0]?.url;
    if (!title || !pageUrl || sources.length === 0) continue;
    const id = createHash("sha256").update(`${pageUrl}|${title}`).digest("hex").slice(0, 24);
    const created = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? new Date(row.createdAt) : new Date();
    const poster = webUrl(row.thumbnailURL) ?? webUrl(row.poster) ?? webUrl(row.posterURL);
    const categories = Array.isArray(row.categories)
      ? [...new Set(row.categories.map((category) => text(category, 60)).filter(Boolean))].slice(0, 12)
      : [];
    const tmdbId = typeof row.tmdbId === "number" && Number.isInteger(row.tmdbId) && row.tmdbId > 0 ? row.tmdbId : undefined;
    const mediaType: MediaType = row.mediaType === "tv" ? "tv" : "movie";
    movies.push({
      id, title, pageUrl, createdAt: created.toISOString(), sources, updatedAt: new Date().toISOString(),
      ...(poster ? { poster } : {}),
      ...(text(row.description, 2_000) ? { description: text(row.description, 2_000) } : {}),
      ...(tmdbId ? { tmdbId } : {}),
      mediaType,
      status: "published",
      sortOrder: typeof row.sortOrder === "number" ? Math.max(0, Math.round(row.sortOrder)) : position,
      ...(categories.length > 0 ? { categories, genres: categories } : {}),
    });
  }
  return movies;
}

export async function importCatalog(value: unknown) {
  const movies = parseCollectorCatalog(value);
  const db = await database();
  if (movies.length > 0) {
    await db.collection<CatalogMovie>("movie_catalog").bulkWrite(movies.map((movie) => ({
      replaceOne: { filter: { id: movie.id }, replacement: movie, upsert: true },
    })));
  }
  const total = Array.isArray((value as Record<string, unknown>).movies) ? ((value as Record<string, unknown>).movies as unknown[]).length : Object.keys(value as object).length;
  return { imported: movies.length, ignored: Math.max(0, total - movies.length) };
}

export async function ensureCatalogFromTmdb(tmdbId: number, mediaType: MediaType) {
  const db = await database();
  const id = catalogIdFromTmdb(tmdbId, mediaType);
  const existing = await db.collection<CatalogMovie>("movie_catalog").findOne({ id }, { projection: { _id: 0 } });
  if (existing) return existing;
  const metadata = await tmdbMetadata(tmdbId, mediaType);
  const movie = fromMetadata(metadata, "metadata_only");
  try {
    await db.collection<CatalogMovie>("movie_catalog").insertOne(movie);
  } catch (error) {
    // A concurrent request can insert the same deterministic TMDB item first.
    const raced = await db.collection<CatalogMovie>("movie_catalog").findOne({ id }, { projection: { _id: 0 } });
    if (raced) return raced;
    throw error;
  }
  return movie;
}

export async function listCatalog(limit = 200) {
  const db = await database();
  return db.collection<CatalogMovie>("movie_catalog").find({}, { projection: { _id: 0 } }).sort({ sortOrder: 1, updatedAt: -1 }).limit(limit).toArray();
}

export async function listPublicCatalog(limit = 200) {
  const db = await database();
  // Backward compatibility: old rows without a status are considered published.
  return db.collection<CatalogMovie>("movie_catalog").find(
    { $or: [{ status: "published" }, { status: { $exists: false } }] },
    { projection: { _id: 0 } },
  ).sort({ sortOrder: 1, updatedAt: -1 }).limit(limit).toArray();
}

export async function deleteCatalogMovie(id: string) {
  const db = await database();
  const result = await db.collection<CatalogMovie>("movie_catalog").deleteOne({ id });
  return result.deletedCount === 1;
}

export async function updateCatalogMovie(id: string, changes: {
  title?: string;
  description?: string;
  sortOrder?: number;
  categories?: string[];
  status?: CatalogStatus;
  sources?: CatalogSource[];
}) {
  const title = changes.title === undefined ? undefined : text(changes.title, 180);
  if (changes.title !== undefined && !title) throw new Error("INVALID_TITLE");
  const categories = changes.categories === undefined
    ? undefined
    : [...new Set(changes.categories.map((category) => text(category, 60)).filter(Boolean))].slice(0, 12);
  const sources = changes.sources?.slice(0, 40).flatMap((source) => {
    const url = hlsUrl(source.url);
    if (!url) return [];
    const master = source.master ? hlsUrl(source.master) : undefined;
    return [{
      ...(source.id ? { id: text(source.id, 40) } : {}),
      url,
      quality: text(source.quality, 60) || "HLS",
      ...(source.resolution ? { resolution: text(source.resolution, 30) } : {}),
      ...(typeof source.bandwidth === "number" && Number.isFinite(source.bandwidth)
        ? { bandwidth: Math.max(0, Math.round(source.bandwidth)) }
        : {}),
      ...(master ? { master } : {}),
    }];
  });
  if (changes.sources !== undefined && sources?.length !== changes.sources.length) {
    throw new Error("INVALID_HLS_SOURCE");
  }
  const update = {
    ...(title !== undefined ? { title } : {}),
    ...(changes.description !== undefined ? { description: text(changes.description, 2_000) } : {}),
    ...(changes.sortOrder !== undefined ? { sortOrder: Math.max(0, Math.round(changes.sortOrder)) } : {}),
    ...(categories !== undefined ? { categories } : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    ...(sources !== undefined ? { sources } : {}),
    updatedAt: new Date().toISOString(),
  };
  const db = await database();
  return db.collection<CatalogMovie>("movie_catalog").findOneAndUpdate(
    { id }, { $set: update }, { returnDocument: "after", projection: { _id: 0 } },
  );
}
