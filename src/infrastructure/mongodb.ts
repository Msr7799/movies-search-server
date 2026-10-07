import { MongoClient, type Db } from "mongodb";

const globalState = globalThis as typeof globalThis & {
  __ANY_MOVIE_MONGO_PROMISE__?: Promise<MongoClient>;
};

function mongoUri() {
  const raw = process.env.MONGODB_URI?.trim();
  if (!raw) throw new Error("MISSING_ENV:MONGODB_URI");
  const username = process.env.MONGODB_USERNAME?.trim();
  const password = process.env.MONGODB_PASSWORD ?? "";
  if (!username || !password || raw.includes("@")) return raw;
  const scheme = raw.match(/^mongodb(?:\+srv)?:\/\//i)?.[0];
  if (!scheme) return raw;
  return `${scheme}${encodeURIComponent(username)}:${encodeURIComponent(password)}@${raw.slice(scheme.length)}`;
}

export function mongoConfigured() {
  return Boolean(process.env.MONGODB_URI?.trim());
}

async function client() {
  if (!globalState.__ANY_MOVIE_MONGO_PROMISE__) {
    const instance = new MongoClient(mongoUri(), {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8_000,
    });
    globalState.__ANY_MOVIE_MONGO_PROMISE__ = instance.connect().catch((error) => {
      delete globalState.__ANY_MOVIE_MONGO_PROMISE__;
      throw error;
    });
  }
  return globalState.__ANY_MOVIE_MONGO_PROMISE__;
}

export async function database(): Promise<Db> {
  const connected = await client();
  return connected.db(process.env.MONGODB_DATABASE?.trim() || "any_movie_control");
}

export async function pingMongo() {
  const started = Date.now();
  const db = await database();
  await db.command({ ping: 1 });
  return { connected: true, latencyMs: Date.now() - started };
}
