import type { VercelRequest, VercelResponse } from "@vercel/node";
import discover from "../src/routes/discover.js";
import { endpoint } from "../src/http/handler.js";
import openapi from "../src/routes/openapi.js";
import suggest from "../src/routes/suggest.js";
import adminCatalog from "../src/routes/admin/catalog.js";
import adminCatalogFromTmdb from "../src/routes/admin/catalog/from-tmdb.js";
import adminHistory from "../src/routes/admin/history.js";
import adminLogin from "../src/routes/admin/login.js";
import adminLogout from "../src/routes/admin/logout.js";
import adminSession from "../src/routes/admin/session.js";
import adminSettings from "../src/routes/admin/settings.js";
import catalog from "../src/routes/v1/catalog.js";
import catalogFromTmdb from "../src/routes/v1/catalog/from-tmdb.js";
import health from "../src/routes/v1/health.js";
import history from "../src/routes/v1/history.js";
import media from "../src/routes/v1/media.js";
import movieMetadata from "../src/routes/v1/movie-metadata.js";
import search from "../src/routes/v1/search.js";
import suggestions from "../src/routes/v1/suggestions.js";
import tmdbDetails from "../src/routes/v1/tmdb/details.js";
import tmdbSearch from "../src/routes/v1/tmdb/search.js";

type RouteHandler = (request: VercelRequest, response: VercelResponse) => unknown;

const routes: Record<string, RouteHandler> = {
  "/api/discover": discover,
  "/api": endpoint(["GET"], () => ({status:"ok", name:"Any Movie API", version:"2.3.0", health:"/api/v1/health"})),
  "/api/openapi": openapi,
  "/api/suggest": suggest,
  "/api/admin/catalog": adminCatalog,
  "/api/admin/catalog/from-tmdb": adminCatalogFromTmdb,
  "/api/admin/history": adminHistory,
  "/api/admin/login": adminLogin,
  "/api/admin/logout": adminLogout,
  "/api/admin/session": adminSession,
  "/api/admin/settings": adminSettings,
  "/api/v1/catalog": catalog,
  "/api/v1/catalog/from-tmdb": catalogFromTmdb,
  "/api/v1/health": health,
  "/api/v1/history": history,
  "/api/v1/media": media,
  "/api/v1/movie-metadata": movieMetadata,
  "/api/v1/search": search,
  "/api/v1/suggestions": suggestions,
  "/api/v1/tmdb/details": tmdbDetails,
  "/api/v1/tmdb/search": tmdbSearch,
};

// All /api/* requests are rewritten to this single deployable Vercel Function.
// Handle both the original pathname and Vercel's internally rewritten URL.
function publicRoute(request: VercelRequest): string {
  const pathname = new URL(request.url ?? "/", "https://any-movie.invalid").pathname.replace(/\/+$/, "") || "/";
  if (pathname !== "/api/index" && pathname !== "/api") return pathname;
  const captured = request.query.__api_route;
  const segment = Array.isArray(captured) ? captured.join("/") : captured;
  if (!segment) return "/api";
  return `/api/${segment.replace(/^\/+|\/+$/g, "")}`;
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  const route = routes[publicRoute(request)];
  if (!route) return response.status(404).json({ error: "not_found" });
  return route(request, response);
}
