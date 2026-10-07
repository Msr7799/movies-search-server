import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { requireAdmin } from "../../admin/auth.js";
import { publicSettings, updateSettings, type ManagedKey } from "../../admin/settings.js";
import { parseBody } from "../../http/body.js";
import { endpoint } from "../../http/handler.js";

const providerSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  domain: z.string().trim().min(3).max(253)
    .transform((value) => value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .refine((value) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value), "اكتب اسم نطاق صالحًا بدون مسار."),
  enabled: z.boolean(),
  inAppPlayback: z.boolean(),
}).strict();

const schema = z.object({
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

async function controller(request: VercelRequest) {
  requireAdmin(request);
  if (request.method === "GET") return publicSettings();
  const input = parseBody(request, schema);
  const secrets: Partial<Record<ManagedKey, string | null>> = {};
  for (const name of ["TAVILY_API_KEY", "SERPER_API_KEY", "GEMINI_API_KEY", "GEMINI_AUTO_SUGGESTED_API_KEY", "TMDB_API_KEY", "API_READ_AUTH_TOKEN"] as const) {
    const value = input.secrets?.[name];
    if (value !== undefined) secrets[name] = value;
  }
  return updateSettings({
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    ...(input.providers ? { providers: input.providers } : {}),
  });
}

export default endpoint(["GET", "PATCH"], controller);
