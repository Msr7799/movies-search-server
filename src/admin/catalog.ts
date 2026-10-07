import { createHash } from "node:crypto";
import { database } from "../infrastructure/mongodb.js";

export type CatalogSource = { url: string; quality: string; resolution?: string; bandwidth?: number; master?: string };
export type CatalogMovie = {
  id: string;
  title: string;
  pageUrl: string;
  createdAt: string;
  sources: CatalogSource[];
  updatedAt: string;
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

export function parseCollectorCatalog(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CATALOG_JSON");
  const movies: CatalogMovie[] = [];
  for (const item of Object.values(value).slice(0, 500)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const title = text(row.title, 180);
    const pageUrl = webUrl(row.pageURL);
    const streams = Array.isArray(row.streams) ? row.streams : [];
    const sources: CatalogSource[] = [];
    const seen = new Set<string>();
    for (const stream of streams.slice(0, 40)) {
      if (!stream || typeof stream !== "object" || Array.isArray(stream)) continue;
      const source = stream as Record<string, unknown>;
      const url = hlsUrl(source.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const master = hlsUrl(source.master);
      sources.push({
        url,
        quality: text(source.quality, 30) || "HLS",
        ...(text(source.resolution, 30) ? { resolution: text(source.resolution, 30) } : {}),
        ...(typeof source.bandwidth === "number" && Number.isFinite(source.bandwidth) ? { bandwidth: Math.max(0, Math.round(source.bandwidth)) } : {}),
        ...(master ? { master } : {}),
      });
    }
    if (!title || !pageUrl || sources.length === 0) continue;
    const id = createHash("sha256").update(`${pageUrl}|${title}`).digest("hex").slice(0, 24);
    const created = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? new Date(row.createdAt) : new Date();
    movies.push({ id, title, pageUrl, createdAt: created.toISOString(), sources, updatedAt: new Date().toISOString() });
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
  return { imported: movies.length, ignored: Math.max(0, Object.keys(value as object).length - movies.length) };
}

export async function listCatalog(limit = 200) {
  const db = await database();
  return db.collection<CatalogMovie>("movie_catalog").find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(limit).toArray();
}

export async function deleteCatalogMovie(id: string) {
  const db = await database();
  const result = await db.collection<CatalogMovie>("movie_catalog").deleteOne({ id });
  return result.deletedCount === 1;
}
