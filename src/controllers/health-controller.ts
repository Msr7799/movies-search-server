import { serviceReadiness } from "../config.js";
import { adminConfigured } from "../admin/auth.js";
import { mongoConfigured, pingMongo } from "../infrastructure/mongodb.js";
import type { RequestContext } from "../http/handler.js";

export async function healthController(_request: unknown, context: RequestContext) {
  const services = await serviceReadiness();
  const mongo = mongoConfigured()
    ? await pingMongo().catch(() => ({ connected: false, latencyMs: 0 }))
    : { connected: false, latencyMs: 0 };
  return {
    status: (services.tavily || services.serper) && services.geminiSearch && services.geminiSuggestions ? "ready" : "degraded",
    service: "any-movie-server",
    version: "2.3.0",
    time: new Date().toISOString(),
    services,
    control: { adminConfigured: adminConfigured(), mongo },
    region: process.env.VERCEL_REGION || process.env.APP_REGION || "local",
    runtime: process.version,
    requestId: context.requestId,
  };
}
