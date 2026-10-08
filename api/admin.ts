import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  adminConfigured,
  adminCookie,
  createAdminToken,
  isAdminRequest,
  requireAdmin,
  validAdminCredentials,
} from "../src/admin/auth.js";
import {
  deleteCatalogMovie,
  ensureCatalogFromTmdb,
  importCatalog,
  listCatalog,
  updateCatalogMovie,
} from "../src/admin/catalog.js";
import {
  publicSettings,
  updateSettings,
  type ManagedKey,
} from "../src/admin/settings.js";
import { parseBody } from "../src/http/body.js";
import { AppError } from "../src/http/errors.js";
import { endpoint } from "../src/http/handler.js";
import { mongoConfigured } from "../src/infrastructure/mongodb.js";
import { incrementWindow } from "../src/infrastructure/store.js";
import type { MediaType } from "../src/services/movie-metadata.js";

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

const providerSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  domain: z.string().trim().min(3).max(253)
    .transform((value) => value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .refine((value) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value), "اكتب اسم نطاق صالحًا بدون مسار."),
  enabled: z.boolean(),
  inAppPlayback: z.boolean(),
}).strict();

const settingsSchema = z.object({
  secrets: z.object({
    TAVILY_API_KEY: z.string().trim().min(8).max(500).nullable().optional(),
    SERPER_API_KEY: z.string().trim().min(8).max(500).nullable().optional(),
    GEMINI_API_KEY: z.string().trim().min(8).max(500).nullable().optional(),
    GEMINI_AUTO_SUGGESTED_API_KEY: z.string().trim().min(8).max(500).nullable().optional(),
    TMDB_API_KEY: z.string().trim().min(8).max(500).nullable().optional(),
    API_READ_AUTH_TOKEN: z.string().trim().min(8).max(2_000).nullable().optional(),
  }).strict().optional(),
  providers: z.array(providerSchema).max(100).optional(),
}).strict();

const sessionHandler = endpoint(["GET"], (request) => ({
  configured: adminConfigured(),
  authenticated: isAdminRequest(request),
  storageConfigured: mongoConfigured(),
}));

const settingsHandler = endpoint(["GET", "PATCH"], async (request: VercelRequest) => {
  requireAdmin(request);
  if (request.method === "GET") return publicSettings();

  const input = parseBody(request, settingsSchema);
  const secrets: Partial<Record<ManagedKey, string | null>> = {};
  for (const name of [
    "TAVILY_API_KEY",
    "SERPER_API_KEY",
    "GEMINI_API_KEY",
    "GEMINI_AUTO_SUGGESTED_API_KEY",
    "TMDB_API_KEY",
    "API_READ_AUTH_TOKEN",
  ] as const) {
    const value = input.secrets?.[name];
    if (value !== undefined) secrets[name] = value;
  }

  return updateSettings({
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    ...(input.providers ? { providers: input.providers } : {}),
  });
});

const catalogHandler = endpoint(["GET", "POST", "PATCH", "DELETE"], async (request: VercelRequest) => {
  requireAdmin(request);

  if (request.method === "GET") return { movies: await listCatalog() };

  if (request.method === "DELETE") {
    const id = typeof request.query.id === "string" ? request.query.id : "";
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new AppError(400, "INVALID_ID", "معرّف الفيلم غير صالح.");
    }
    return { deleted: await deleteCatalogMovie(id) };
  }

  const length = Number(request.headers["content-length"] ?? 0);
  if (length > 5_000_000) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "ملف JSON أكبر من 5MB.");
  }

  const wrapper = jsonBody(request);

  if (request.method === "PATCH") {
    const id = typeof wrapper.id === "string" ? wrapper.id : "";
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new AppError(400, "INVALID_ID", "معرّف الفيلم غير صالح.");
    }
    const categories = Array.isArray(wrapper.categories)
      ? wrapper.categories.filter((value): value is string => typeof value === "string")
      : undefined;
    const status = ["metadata_only", "draft", "published", "archived"].includes(String(wrapper.status))
      ? String(wrapper.status) as "metadata_only" | "draft" | "published" | "archived"
      : undefined;
    const updated = await updateCatalogMovie(id, {
      ...(typeof wrapper.title === "string" ? { title: wrapper.title } : {}),
      ...(typeof wrapper.description === "string" ? { description: wrapper.description } : {}),
      ...(typeof wrapper.sortOrder === "number" && Number.isFinite(wrapper.sortOrder) ? { sortOrder: wrapper.sortOrder } : {}),
      ...(categories ? { categories } : {}),
      ...(status ? { status } : {}),
    });
    if (!updated) throw new AppError(404, "MOVIE_NOT_FOUND", "الفيلم غير موجود.");
    return { movie: updated };
  }

  if (wrapper.rightsConfirmed !== true) {
    throw new AppError(400, "RIGHTS_CONFIRMATION_REQUIRED", "يجب تأكيد امتلاك حق نشر المصادر.");
  }
  return importCatalog(wrapper.catalog);
});

const catalogFromTmdbHandler = endpoint(["POST"], async (request: VercelRequest) => {
  requireAdmin(request);
  const body = jsonBody(request);
  const tmdbId = Number(body.tmdbId ?? 0);
  const mediaType: MediaType = body.mediaType === "tv" ? "tv" : "movie";
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new AppError(400, "INVALID_TMDB_ID", "معرّف TMDB غير صالح.");
  }
  return { movie: await ensureCatalogFromTmdb(tmdbId, mediaType) };
});

async function loginHandler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "method_not_allowed" });
  if (!adminConfigured()) return response.status(503).json({ error: "admin_not_configured" });

  const forwarded = request.headers["x-forwarded-for"];
  const ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket.remoteAddress || "unknown")
    .split(",")[0]?.trim() || "unknown";
  if (await incrementWindow(`admin-login:${ip}`, 600) > 10) {
    return response.status(429).json({ error: "too_many_attempts" });
  }

  const body = jsonBody(request);
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!validAdminCredentials(username, password)) {
    return response.status(401).json({ error: "invalid_credentials" });
  }

  response.setHeader("Set-Cookie", adminCookie(createAdminToken()));
  return response.status(200).json({ ok: true, cookie: ADMIN_COOKIE });
}

function logoutHandler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "method_not_allowed" });
  response.setHeader("Set-Cookie", adminCookie("", true));
  return response.status(200).json({ ok: true });
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  const route = routeFor(request);

  switch (route) {
    case "login":
      return loginHandler(request, response);
    case "logout":
      return logoutHandler(request, response);
    case "session":
      return sessionHandler(request, response);
    case "settings":
      return settingsHandler(request, response);
    case "catalog":
      return catalogHandler(request, response);
    case "catalog/from-tmdb":
      return catalogFromTmdbHandler(request, response);
    default:
      response.setHeader("Cache-Control", "no-store");
      return response.status(404).json({ error: "route_not_found" });
  }
}
