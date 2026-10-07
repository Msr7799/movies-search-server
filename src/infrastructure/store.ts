type MemoryValue = { value: string; expiresAt: number };
const memory = new Map<string, MemoryValue>();

function redisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

async function redis(command: Array<string | number>) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("STORE_UNAVAILABLE");
  return (await response.json()) as { result?: unknown };
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  if (redisConfigured()) {
    try {
      const payload = await redis(["GET", key]);
      return typeof payload?.result === "string"
        ? (JSON.parse(payload.result) as T)
        : undefined;
    } catch {
      /* Degrade to local cache. */
    }
  }
  const item = memory.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return JSON.parse(item.value) as T;
}

export async function cacheSet(key: string, value: unknown, seconds: number) {
  const serialized = JSON.stringify(value);
  if (redisConfigured()) {
    try {
      await redis(["SET", key, serialized, "EX", seconds]);
      return;
    } catch {
      /* Degrade to local cache. */
    }
  }
  memory.set(key, {
    value: serialized,
    expiresAt: Date.now() + seconds * 1000,
  });
  if (memory.size > 500) {
    const oldest = memory.keys().next().value as string | undefined;
    if (oldest) memory.delete(oldest);
  }
}

export async function incrementWindow(key: string, seconds: number) {
  if (redisConfigured()) {
    try {
      const payload = await redis(["INCR", key]);
      const count = Number(payload?.result ?? 1);
      if (count === 1) await redis(["EXPIRE", key, seconds]);
      return count;
    } catch {
      /* Degrade to local limiter. */
    }
  }
  const current = memory.get(key);
  const count =
    current && current.expiresAt > Date.now() ? Number(current.value) + 1 : 1;
  memory.set(key, {
    value: String(count),
    expiresAt: Date.now() + seconds * 1000,
  });
  return count;
}
