import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { database, mongoConfigured } from "../infrastructure/mongodb.js";
import { adminEncryptionSecret } from "./auth.js";

export type ManagedKey = "TAVILY_API_KEY" | "GEMINI_API_KEY" | "GEMINI_AUTO_SUGGESTED_API_KEY";
export type ManagedProvider = {
  id: string;
  name: string;
  domain: string;
  enabled: boolean;
  inAppPlayback: boolean;
};

type SettingsDocument = {
  _id: "runtime";
  secrets?: Partial<Record<ManagedKey, string>>;
  providers?: ManagedProvider[];
  updatedAt?: Date;
};

const keys: ManagedKey[] = ["TAVILY_API_KEY", "GEMINI_API_KEY", "GEMINI_AUTO_SUGGESTED_API_KEY"];
let settingsCache: { value: SettingsDocument | null; expiresAt: number } | undefined;

function encryptionKey() {
  return createHash("sha256").update(adminEncryptionSecret()).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split(".").map((part) => Buffer.from(part ?? "", "base64url"));
  if (!iv || !tag || !ciphertext) throw new Error("INVALID_ENCRYPTED_SETTING");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function document() {
  if (settingsCache && settingsCache.expiresAt > Date.now()) return settingsCache.value;
  const db = await database();
  const value = await db.collection<SettingsDocument>("admin_settings").findOne({ _id: "runtime" });
  settingsCache = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export async function effectiveSecret(name: ManagedKey) {
  if (!mongoConfigured()) return process.env[name]?.trim() || "";
  try {
    const stored = await document();
    const encrypted = stored?.secrets?.[name];
    if (encrypted) return decrypt(encrypted);
  } catch {
    // Keep environment-based search available during a temporary database outage.
  }
  return process.env[name]?.trim() || "";
}

export async function publicSettings() {
  const stored = await document();
  const configuredKeys = Object.fromEntries(await Promise.all(keys.map(async (name) => [name, Boolean(await effectiveSecret(name))]))) as Record<ManagedKey, boolean>;
  return {
    configuredKeys,
    keyOverrides: Object.fromEntries(keys.map((name) => [name, Boolean(stored?.secrets?.[name])])),
    providers: stored?.providers ?? [],
    updatedAt: stored?.updatedAt?.toISOString() ?? null,
  };
}

export async function updateSettings(input: {
  secrets?: Partial<Record<ManagedKey, string | null>>;
  providers?: ManagedProvider[];
}) {
  const db = await database();
  const current = await document();
  const secrets = { ...(current?.secrets ?? {}) };
  for (const name of keys) {
    const value = input.secrets?.[name];
    if (value === null) delete secrets[name];
    else if (typeof value === "string" && value.trim()) secrets[name] = encrypt(value.trim());
  }
  const update: SettingsDocument = {
    _id: "runtime",
    secrets,
    providers: input.providers ?? current?.providers ?? [],
    updatedAt: new Date(),
  };
  await db.collection<SettingsDocument>("admin_settings").replaceOne({ _id: "runtime" }, update, { upsert: true });
  settingsCache = undefined;
  return publicSettings();
}

export async function managedProviders() {
  if (!mongoConfigured()) return [];
  return (await document())?.providers ?? [];
}
