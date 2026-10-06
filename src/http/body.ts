import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { AppError } from "./errors.js";

export function parseBody<T>(request: VercelRequest, schema: z.ZodType<T>): T {
  let value: unknown = request.body;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new AppError(400, "INVALID_JSON", "صيغة JSON غير صالحة."); }
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues[0]?.message || "بيانات الطلب غير صالحة.";
    throw new AppError(400, "VALIDATION_ERROR", message);
  }
  return result.data;
}
