import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { config } from "../config.js";
import { inferSourceKind, isAllowedProviderUrl, isPlayableProviderUrl, providerFor, providerPriorityFor } from "../domain/providers.js";
import { AppError } from "../http/errors.js";
import { assertJsonBodySize, type RequestContext } from "../http/handler.js";
import { parseBody } from "../http/body.js";
import { enforceRateLimit } from "../infrastructure/rate-limit.js";
import { discoverObservedMedia, discoverPlayableMedia } from "../services/media-discovery.js";

const schema = z.object({
  url: z.string().url().max(2_000),
  originUrl: z.string().url().max(2_000).optional(),
}).strict();

export async function mediaController(request: VercelRequest, context: RequestContext) {
  assertJsonBodySize(request);
  const input = parseBody(request, schema) as { url: string; originUrl?: string };
  await enforceRateLimit("media", context.ip, Math.max(10, config.searchLimit * 2), 600);

  let media;
  let providerUrl = input.url;
  if (input.originUrl) {
    if (!isPlayableProviderUrl(input.originUrl)) {
      throw new AppError(400, "UNSUPPORTED_ORIGIN", "صفحة المصدر ليست من مزود تشغيل مهيأ في السيرفر.");
    }
    media = await discoverObservedMedia(input.url, input.originUrl);
    providerUrl = input.originUrl;
  } else {
    if (!isAllowedProviderUrl(input.url)) {
      throw new AppError(400, "UNSUPPORTED_PROVIDER", "هذا الرابط ليس من مزود مهيأ في السيرفر.");
    }
    media = await discoverPlayableMedia(input.url);
  }

  const provider = providerFor(providerUrl);
  return {
    result: {
      id: "manual",
      title: provider,
      provider,
      url: providerUrl,
      description: media.playable ? "تم فحص الرابط واكتشاف مصدر تشغيل مناسب." : "لم يتم العثور على بث مباشر آمن داخل الصفحة.",
      reason: input.originUrl ? "تم التقاط طلب وسائط أثناء تشغيل المشغل والتحقق منه في السيرفر." : "فحص مباشر من طبقة اكتشاف الوسائط في السيرفر.",
      contentType: inferSourceKind({ url: providerUrl, title: provider, content: "" }),
      playable: media.playable ?? false,
      providerPriority: providerPriorityFor(providerUrl) + 1,
      confidence: media.playable ? 0.98 : 0.45,
      ...media,
    },
    meta: { requestId: context.requestId, inspectedAt: new Date().toISOString() },
  };
}
