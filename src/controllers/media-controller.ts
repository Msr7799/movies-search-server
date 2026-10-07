import type { VercelRequest } from "@vercel/node";
import { z } from "zod";
import { config } from "../config.js";
import { inferSourceKind, providerFor } from "../domain/providers.js";
import { assertJsonBodySize, type RequestContext } from "../http/handler.js";
import { parseBody } from "../http/body.js";
import { enforceRateLimit } from "../infrastructure/rate-limit.js";
import { discoverObservedMedia, discoverPlayableMedia } from "../services/media-discovery.js";

const schema = z.object({
  url: z.string().url().max(2_000),
  originUrl: z.string().url().max(2_000).optional(),
  requestHeaders: z.record(z.string().max(64), z.string().max(1_000)).optional(),
}).strict();

export async function mediaController(request: VercelRequest, context: RequestContext) {
  assertJsonBodySize(request);
  const input = parseBody(request, schema) as { url: string; originUrl?: string; requestHeaders?: Record<string, string> };
  await enforceRateLimit("media", context.ip, Math.max(10, config.searchLimit * 2), 600);

  const providerUrl = input.originUrl ?? input.url;
  const media = input.originUrl
    ? await discoverObservedMedia(input.url, input.originUrl, input.requestHeaders ?? {})
    : await discoverPlayableMedia(input.url);

  const provider = providerFor(providerUrl);
  return {
    result: {
      id: "manual",
      title: provider,
      provider,
      url: providerUrl,
      description: media.playable ? "تم فحص الرابط واكتشاف مصدر تشغيل مباشر." : "لم يتم العثور على HLS أو فيديو مباشر قابل للتحقق داخل الصفحة.",
      reason: input.originUrl ? "تم التقاط طلب وسائط من WebView والتحقق منه في السيرفر." : "فحص عام للرابط بدون قائمة مزودين.",
      contentType: inferSourceKind({ url: providerUrl, title: provider, content: "" }),
      playable: media.playable ?? false,
      providerPriority: 1,
      confidence: media.playable ? 0.98 : 0.45,
      ...media,
    },
    meta: { requestId: context.requestId, inspectedAt: new Date().toISOString() },
  };
}
