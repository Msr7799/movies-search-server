import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../config.js";
import { AppError, publicError } from "./errors.js";

export type RequestContext = { requestId: string; ip: string };
export type Controller = (request: VercelRequest, context: RequestContext) => Promise<unknown> | unknown;

function originAllowed(origin: string | undefined) {
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

function ipFor(request: VercelRequest) {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return value?.trim().slice(0, 80) || request.socket.remoteAddress || "unknown";
}

export function endpoint(methods: string[], controller: Controller) {
  return async function handler(request: VercelRequest, response: VercelResponse) {
    const requestId = (Array.isArray(request.headers["x-request-id"])
      ? request.headers["x-request-id"][0]
      : request.headers["x-request-id"])?.slice(0, 100) || randomUUID();
    const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;

    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Vary", "Origin");
    if (originAllowed(origin) && origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", `${methods.join(", ")}, OPTIONS`);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Request-Id");
    response.setHeader("Access-Control-Max-Age", "86400");

    if (request.method === "OPTIONS") return response.status(204).end();
    if (!originAllowed(origin)) {
      return response.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "هذا المصدر غير مسموح.", requestId } });
    }
    if (!methods.includes(request.method ?? "")) {
      response.setHeader("Allow", [...methods, "OPTIONS"].join(", "));
      return response.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "طريقة الطلب غير مدعومة.", requestId } });
    }

    try {
      const result = await controller(request, { requestId, ip: ipFor(request) });
      return response.status(200).json(result);
    } catch (cause) {
      const error = publicError(cause);
      if (error.retryAfter) response.setHeader("Retry-After", String(error.retryAfter));
      console.error(JSON.stringify({ level: "error", requestId, code: error.code, cause: cause instanceof Error ? cause.message : "unknown" }));
      return response.status(error.status).json({ error: { code: error.code, message: error.message, requestId } });
    }
  };
}

export function assertJsonBodySize(request: VercelRequest, maxBytes = 4096) {
  const length = Number(request.headers["content-length"] ?? 0);
  if (length > maxBytes) throw new AppError(413, "PAYLOAD_TOO_LARGE", "حجم الطلب أكبر من المسموح.");
  const type = request.headers["content-type"];
  if (request.method === "POST" && type && !type.toLowerCase().includes("application/json")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "يجب إرسال الطلب بصيغة JSON.");
  }
}
