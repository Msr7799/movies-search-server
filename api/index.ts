import { endpoint } from "../src/http/handler.js";

export default endpoint(["GET"], (_request, context) => ({
  name: "Any Movie API",
  version: "2.3.0",
  status: "ok",
  documentation: "/api/openapi",
  endpoints: {
    health: "/api/v1/health",
    providers: "/api/v1/providers",
    suggestions: "/api/v1/suggestions",
    search: "/api/v1/search",
    media: "/api/v1/media",
    catalog: "/api/v1/catalog",
    movieMetadata: "/api/v1/movie-metadata?title=Inception%202010",
    tmdbSearch: "/api/v1/tmdb/search?q=Inception&type=multi",
    tmdbDetails: "/api/v1/tmdb/details?id=27205&type=movie",
    admin: "/admin",
  },
  requestId: context.requestId,
}));
