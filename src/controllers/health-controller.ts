import { serviceReadiness } from "../config.js";
import type { RequestContext } from "../http/handler.js";

export function healthController(_request: unknown, context: RequestContext) {
  const services = serviceReadiness();
  return {
    status: services.tavily && services.geminiSearch && services.geminiSuggestions ? "ready" : "degraded",
    service: "any-movie-server",
    version: "1.0.0",
    time: new Date().toISOString(),
    services,
    requestId: context.requestId,
  };
}
