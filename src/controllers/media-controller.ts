import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { config } from "../config.js";
import { inferSourceKind, isAllowedProviderUrl, providerFor, providerPriorityFor } from "../domain/providers.js";
import { AppError } from "../http/errors.js";
import { assertJsonBodySize, type RequestContext } from "../http/handler.js";
import { parseBody } from "../http/body.js";
import { enforceRateLimit } from "../infrastructure/rate-limit.js";
import { discoverPlayableMedia } from "../services/media-discovery.js";

const schema = z.object({
  url: z.string().url().max(2_000),
}).strict();

export async function mediaController(request: VercelRequest, context: RequestContext) {
  assertJsonBodySize(request);
  const input = parseBody(request, schema) as { url: string };
  await enforceRateLimit("media", context.ip, Math.max(10, config.searchLimit * 2), 600);
  if (!isAllowedProviderUrl(input.url)) {
    throw new AppError(400, "UNSUPPORTED_PROVIDER", "هذا الرابط ليس من مزود مهيأ في السيرفر.");
  }

  const media = await discoverPlayableMedia(input.url);
  const provider = providerFor(input.url);
  return {
    result: {
      id: "manual",
      title: provider,
      provider,
      url: input.url,
      description: media.playable ? "تم فحص الرابط واكتشاف مصدر تشغيل مناسب." : "لم يتم العثور على بث مباشر آمن داخل الصفحة.",
      reason: "فحص مباشر من طبقة اكتشاف الوسائط في السيرفر.",
      contentType: inferSourceKind({ url: input.url, title: provider, content: "" }),
      playable: media.playable ?? false,
      providerPriority: providerPriorityFor(input.url) + 1,
      confidence: media.playable ? 0.95 : 0.45,
      ...media,
    },
    meta: { requestId: context.requestId, inspectedAt: new Date().toISOString() },
  };
}
