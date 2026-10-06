import { endpoint } from "../src/http/handler.js";

export default endpoint(["GET"], (_request, context) => ({
  name: "Any Movie API",
  version: "1.4.0",
  status: "ok",
  documentation: "/api/openapi",
  endpoints: {
    health: "/api/v1/health",
    providers: "/api/v1/providers",
    suggestions: "/api/v1/suggestions",
    search: "/api/v1/search",
    media: "/api/v1/media",
  },
  requestId: context.requestId,
}));
