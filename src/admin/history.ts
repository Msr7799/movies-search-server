import { database } from "../infrastructure/mongodb.js";

export type PlaybackHistory = {
  visitorId: string;
  movieId: string;
  movie: { id: string; title: string; poster?: string };
  progress: number;
  duration: number;
  watchedAt: number;
  updatedAt: Date;
};

let indexPromise: Promise<string> | undefined;

function ensureHistoryIndex() {
  if (!indexPromise) {
    indexPromise = database()
      .then((db) => db.collection<PlaybackHistory>("playback_history").createIndex(
        { visitorId: 1, movieId: 1 },
        { unique: true, name: "visitor_movie_unique" },
      ))
      .catch((error: unknown) => {
        indexPromise = undefined;
        throw error;
      });
  }
  return indexPromise;
}

export async function recordPlaybackHistory(entry: Omit<PlaybackHistory, "updatedAt">) {
  await ensureHistoryIndex();
  const db = await database();
  await db.collection<PlaybackHistory>("playback_history").updateOne(
    { visitorId: entry.visitorId, movieId: entry.movieId },
    { $set: { ...entry, updatedAt: new Date() } },
    { upsert: true },
  );
  return { ok: true };
}

export async function listPlaybackHistory(limit = 300) {
  const db = await database();
  const documents = await db.collection<PlaybackHistory>("playback_history")
    .find({}, { projection: { _id: 0, visitorId: 0, updatedAt: 0 } })
    .sort({ watchedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 1_000))
    .toArray();
  const unique = new Map<string, Omit<PlaybackHistory, "visitorId" | "updatedAt">>();
  for (const document of documents) {
    if (document.movieId && !unique.has(document.movieId)) {
      const { movieId, movie, progress, duration, watchedAt } = document;
      unique.set(movieId, { movieId, movie, progress, duration, watchedAt });
    }
  }
  return [...unique.values()];
}

export async function renamePlaybackHistory(movieId: string, title: string) {
  const db = await database();
  const result = await db.collection<PlaybackHistory>("playback_history").updateMany(
    { movieId },
    { $set: { "movie.title": title, updatedAt: new Date() } },
  );
  return result.modifiedCount;
}

export async function deletePlaybackHistory(movieId: string) {
  const db = await database();
  const result = await db.collection<PlaybackHistory>("playback_history").deleteMany({ movieId });
  return result.deletedCount;
}
