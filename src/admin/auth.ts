import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { AppError } from "../http/errors.js";

export const ADMIN_COOKIE = "any_movie_server_admin";
const SESSION_SECONDS = 60 * 60 * 12;

function credentials() {
  return {
    username: process.env.ADMIN_USERNAME?.trim() || "",
    password: process.env.ADMIN_PASSWORD || "",
    secret: process.env.ADMIN_SESSION_SECRET || "",
  };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function equal(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

export function adminConfigured() {
  const value = credentials();
  return value.username.length >= 3 && value.password.length >= 12 && value.secret.length >= 32;
}

export function validAdminCredentials(username: string, password: string) {
  if (!adminConfigured()) return false;
  const configured = credentials();
  return equal(username.trim().toLowerCase(), configured.username.toLowerCase()) && equal(password, configured.password);
}

function signature(payload: string) {
  return createHmac("sha256", credentials().secret).update(payload).digest("base64url");
}

export function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    sub: credentials().username,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function cookieValue(request: VercelRequest) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name === ADMIN_COOKIE) return decodeURIComponent(parts.join("="));
  }
  return "";
}

export function isAdminRequest(request: VercelRequest) {
  if (!adminConfigured()) return false;
  const [payload, supplied] = cookieValue(request).split(".");
  if (!payload || !supplied || !equal(supplied, signature(payload))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    return decoded.sub === credentials().username && typeof decoded.exp === "number" && decoded.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function requireAdmin(request: VercelRequest) {
  if (!isAdminRequest(request)) throw new AppError(401, "ADMIN_REQUIRED", "يجب تسجيل دخول الأدمن.");
}

export function adminCookie(token: string, clear = false) {
  const maxAge = clear ? 0 : SESSION_SECONDS;
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function adminEncryptionSecret() {
  if (!adminConfigured()) throw new Error("MISSING_ENV:ADMIN_SESSION_SECRET");
  return credentials().secret;
}
