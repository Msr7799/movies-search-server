import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ADMIN_COOKIE, adminConfigured, adminCookie, createAdminToken, validAdminCredentials } from "../../admin/auth.js";
import { incrementWindow } from "../../infrastructure/store.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "method_not_allowed" });
  if (!adminConfigured()) return response.status(503).json({ error: "admin_not_configured" });
  const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0]?.trim() || "unknown";
  if (await incrementWindow(`admin-login:${ip}`, 600) > 10) return response.status(429).json({ error: "too_many_attempts" });
  const body = typeof request.body === "string" ? JSON.parse(request.body) as unknown : request.body;
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const username = typeof input.username === "string" ? input.username : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!validAdminCredentials(username, password)) return response.status(401).json({ error: "invalid_credentials" });
  response.setHeader("Set-Cookie", adminCookie(createAdminToken()));
  return response.status(200).json({ ok: true, cookie: ADMIN_COOKIE });
}
