import { effectiveSecret } from "../admin/settings.js";

const TMDB = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p";

export type MediaType = "movie" | "tv";
export type Person = { id: string; name: string; role?: string | undefined; image?: string | undefined };
export type TmdbSearchResult = {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | undefined;
  overview?: string | undefined;
  releaseDate?: string | undefined;
  year?: number | undefined;
  poster?: string | undefined;
  backdrop?: string | undefined;
  rating?: number | undefined;
};
export type MovieMetadata = {
  title: string;
  originalTitle?: string | undefined;
  overview?: string | undefined;
  releaseDate?: string | undefined;
  year?: number | undefined;
  runtime?: number | undefined;
  rating?: number | undefined;
  voteCount?: number | undefined;
  certification?: string | undefined;
  genres: string[];
  countries: string[];
  languages: string[];
  poster?: string | undefined;
  backdrop?: string | undefined;
  images: string[];
  trailers: string[];
  directors: Person[];
  writers: Person[];
  cast: Person[];
  imdbId?: string | undefined;
  tmdbId?: number | undefined;
  wikidataId?: string | undefined;
  mediaType: MediaType;
  source: "tmdb" | "wikidata" | "combined";
};

function clean(value: string) {
  return value
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/(?:مشاهدة|فيلم|مترجم|مدبلج|اون\s*لاين|أون\s*لاين|HD|Full|Movie|Watch|كيو\s*فيلم|ماي\s*سيما)/gi, " ")
    .replace(/[|_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function image(path: unknown, size = "w500") {
  return typeof path === "string" && path ? `${IMAGE}/${size}${path}` : undefined;
}

async function tmdb(path: string, params = new URLSearchParams()) {
  const [token, key] = await Promise.all([
    effectiveSecret("API_READ_AUTH_TOKEN"),
    effectiveSecret("TMDB_API_KEY"),
  ]);
  if (!token && !key) return null;
  if (!token && key) params.set("api_key", key);
  const response = await fetch(`${TMDB}${path}?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}`, Accept: "application/json" } : { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`TMDB_FAILED:${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

function people(rows: unknown, role: (row: Record<string, unknown>) => string): Person[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 30).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    if (!name) return [];
    return [{
      id: String(row.id ?? name),
      name,
      ...(role(row) ? { role: role(row) } : {}),
      ...(image(row.profile_path, "w185") ? { image: image(row.profile_path, "w185") } : {}),
    }];
  });
}

async function wiki(title: string): Promise<{ wikidataId?: string | undefined; overview?: string | undefined }> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({ action: "wbsearchentities", search: title, language: "en", uselang: "ar", type: "item", limit: "5", format: "json", origin: "*" }).toString();
  const response = await fetch(url, { headers: { "User-Agent": "AnyMovie/2.3 (movie metadata)" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return {};
  const payload = await response.json() as { search?: Array<{ id?: string; description?: string }> };
  const row = payload.search?.find((item) => /film|movie|series|television|فيلم|مسلسل/i.test(item.description ?? "")) ?? payload.search?.[0];
  return { wikidataId: row?.id, overview: row?.description };
}

function resultTitle(row: Record<string, unknown>, type: MediaType) {
  return String(type === "movie" ? row.title ?? "" : row.name ?? "").trim();
}
function resultOriginalTitle(row: Record<string, unknown>, type: MediaType) {
  return String(type === "movie" ? row.original_title ?? "" : row.original_name ?? "").trim();
}
function resultDate(row: Record<string, unknown>, type: MediaType) {
  return String(type === "movie" ? row.release_date ?? "" : row.first_air_date ?? "").trim();
}

export async function searchTmdb(rawQuery: string, requestedType: MediaType | "multi" = "multi", limit = 12): Promise<TmdbSearchResult[]> {
  const query = clean(rawQuery) || rawQuery.trim();
  if (!query) return [];
  const path = requestedType === "multi" ? "/search/multi" : `/search/${requestedType}`;
  const payload = await tmdb(path, new URLSearchParams({ query, language: "ar-AE", include_adult: "false" }));
  if (!payload) throw new Error("TMDB_NOT_CONFIGURED");
  const rows = Array.isArray(payload.results) ? payload.results : [];
  const output: TmdbSearchResult[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const mediaType = requestedType === "multi" ? String(row.media_type ?? "") : requestedType;
    if (mediaType !== "movie" && mediaType !== "tv") continue;
    const id = typeof row.id === "number" ? row.id : Number(row.id);
    const title = resultTitle(row, mediaType);
    if (!Number.isFinite(id) || !title) continue;
    const releaseDate = resultDate(row, mediaType);
    output.push({
      tmdbId: id,
      mediaType,
      title,
      ...(resultOriginalTitle(row, mediaType) ? { originalTitle: resultOriginalTitle(row, mediaType) } : {}),
      ...(String(row.overview ?? "").trim() ? { overview: String(row.overview).trim() } : {}),
      ...(releaseDate ? { releaseDate } : {}),
      ...(Number(releaseDate.slice(0, 4)) ? { year: Number(releaseDate.slice(0, 4)) } : {}),
      ...(image(row.poster_path, "w500") ? { poster: image(row.poster_path, "w500") } : {}),
      ...(image(row.backdrop_path, "w780") ? { backdrop: image(row.backdrop_path, "w780") } : {}),
      ...(typeof row.vote_average === "number" ? { rating: row.vote_average } : {}),
    });
    if (output.length >= Math.max(1, Math.min(20, limit))) break;
  }
  return output;
}

export async function tmdbMetadata(id: number, mediaType: MediaType): Promise<MovieMetadata> {
  if (!Number.isInteger(id) || id <= 0) throw new Error("INVALID_TMDB_ID");
  const details = await tmdb(`/${mediaType}/${id}`, new URLSearchParams({
    language: "ar-AE",
    append_to_response: "credits,images,external_ids,videos,release_dates,content_ratings",
    include_image_language: "ar,en,null",
  }));
  if (!details) throw new Error("TMDB_NOT_CONFIGURED");
  const english = await tmdb(`/${mediaType}/${id}`, new URLSearchParams({ language: "en-US" })).catch(() => null);
  const title = resultTitle(details, mediaType) || (english ? resultTitle(english, mediaType) : "") || `TMDB #${id}`;
  const originalTitle = resultOriginalTitle(details, mediaType);
  const releaseDate = resultDate(details, mediaType);
  const credits = details.credits as Record<string, unknown> | undefined;
  const crew = Array.isArray(credits?.crew) ? credits.crew as Record<string, unknown>[] : [];
  const imageBlock = details.images as Record<string, unknown> | undefined;
  const visuals = [...(Array.isArray(imageBlock?.posters) ? imageBlock.posters : []), ...(Array.isArray(imageBlock?.backdrops) ? imageBlock.backdrops : [])] as Record<string, unknown>[];
  const external = details.external_ids as Record<string, unknown> | undefined;
  const videos = details.videos as Record<string, unknown> | undefined;
  const trailers = (Array.isArray(videos?.results) ? videos.results : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (row.site !== "YouTube" || typeof row.key !== "string") return [];
    if (!/Trailer|Teaser/i.test(String(row.type ?? ""))) return [];
    return [`https://www.youtube.com/watch?v=${row.key}`];
  }).slice(0, 6);
  const runtime = mediaType === "movie"
    ? (typeof details.runtime === "number" ? details.runtime : undefined)
    : (Array.isArray(details.episode_run_time) && typeof details.episode_run_time[0] === "number" ? details.episode_run_time[0] as number : undefined);
  return {
    title,
    ...(originalTitle ? { originalTitle } : {}),
    ...(String(details.overview || english?.overview || "").trim() ? { overview: String(details.overview || english?.overview).trim() } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    ...(Number(releaseDate.slice(0, 4)) ? { year: Number(releaseDate.slice(0, 4)) } : {}),
    ...(runtime ? { runtime } : {}),
    ...(typeof details.vote_average === "number" ? { rating: details.vote_average } : {}),
    ...(typeof details.vote_count === "number" ? { voteCount: details.vote_count } : {}),
    genres: Array.isArray(details.genres) ? details.genres.map((x) => String((x as Record<string, unknown>).name ?? "")).filter(Boolean) : [],
    countries: Array.isArray(details.production_countries) ? details.production_countries.map((x) => String((x as Record<string, unknown>).name ?? "")).filter(Boolean) : [],
    languages: Array.isArray(details.spoken_languages) ? details.spoken_languages.map((x) => String((x as Record<string, unknown>).name ?? "")).filter(Boolean) : [],
    ...(image(details.poster_path, "w780") ? { poster: image(details.poster_path, "w780") } : {}),
    ...(image(details.backdrop_path, "original") ? { backdrop: image(details.backdrop_path, "original") } : {}),
    images: [...new Set(visuals.map((x) => image(x.file_path, "w780")).filter((x): x is string => Boolean(x)))].slice(0, 16),
    trailers,
    directors: people(crew.filter((x) => x.job === "Director" || x.department === "Directing"), (x) => String(x.job ?? "")),
    writers: people(crew.filter((x) => ["Writer", "Screenplay", "Story", "Novel"].includes(String(x.job))), (x) => String(x.job ?? "")),
    cast: people(credits?.cast, (x) => String(x.character ?? "")).slice(0, 20),
    ...(typeof external?.imdb_id === "string" ? { imdbId: external.imdb_id } : {}),
    tmdbId: id,
    mediaType,
    source: "tmdb",
  };
}

export async function movieMetadata(rawTitle: string): Promise<MovieMetadata> {
  const requestedYear = Number(rawTitle.match(/\b((?:19|20)\d{2})\b/)?.[1] ?? 0) || undefined;
  const title = clean(rawTitle) || rawTitle.trim();
  const [matches, wd] = await Promise.all([searchTmdb(title, "movie", 8).catch(() => []), wiki(title).catch(() => ({} as { wikidataId?: string | undefined; overview?: string | undefined }))]);
  const hit = requestedYear ? matches.find((item) => item.year === requestedYear) ?? matches[0] : matches[0];
  if (!hit) {
    return {
      title,
      ...(typeof wd.overview === "string" ? { overview: wd.overview } : {}),
      genres: [], countries: [], languages: [], images: [], trailers: [], directors: [], writers: [], cast: [],
      ...(typeof wd.wikidataId === "string" ? { wikidataId: wd.wikidataId } : {}),
      mediaType: "movie",
      source: "wikidata",
    };
  }
  const metadata = await tmdbMetadata(hit.tmdbId, hit.mediaType);
  return {
    ...metadata,
    ...(typeof wd.wikidataId === "string" ? { wikidataId: wd.wikidataId, source: "combined" as const } : {}),
  };
}
