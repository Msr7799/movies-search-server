export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Any Movie API",
    version: "2.1.0",
    description:
      "Arabic-first open-web movie media discovery API for web and mobile clients.",
  },
  servers: [{ url: "https://movies-search-server.vercel.app" }],
  paths: {
    "/api/v1/health": {
      get: {
        summary: "Service readiness",
        responses: { "200": { description: "Health status" } },
      },
    },
    "/api/v1/providers": {
      get: {
        summary: "Discovery mode (open web; no provider allow-list)",
        responses: { "200": { description: "Provider list" } },
      },
    },
    "/api/v1/catalog": {
      get: {
        summary: "Public centrally managed HLS catalog",
        responses: { "200": { description: "Public movie catalog" } },
      },
    },
    "/api/v1/suggestions": {
      post: {
        summary: "AI title suggestions using the isolated suggestion key",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["query"],
                properties: {
                  query: { type: "string", minLength: 3, maxLength: 80 },
                  movieLanguage: { type: "string", default: "any" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Suggestions" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/v1/media": {
      post: {
        summary: "Inspect any public HTTP/HTTPS page for direct video or HLS",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" }, originUrl: { type: "string", format: "uri", description: "Optional public HTTP/HTTPS page that originated an observed media request." } } } } },
        },
        responses: { "200": { description: "Detected media" }, "400": { description: "Invalid or unsafe URL" }, "429": { description: "Rate limited" } },
      },
    },
    "/api/v1/search": {
      post: {
        summary: "Identify a title, search the open web, and return verified playable media",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["query"],
                properties: {
                  query: { type: "string", minLength: 2, maxLength: 120 },
                  movieLanguage: { type: "string", default: "any" },
                  subtitleLanguage: { type: "string", default: "any" },
                  allowShortClips: { type: "boolean", default: false },
                  resultLimit: { type: "integer", minimum: 5, maximum: 30, default: 10 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Ranked discovery response" },
          "400": { description: "Invalid request" },
          "429": { description: "Rate limited" },
          "502": { description: "Upstream search/crawl failure" },
        },
      },
    },
  },
} as const;
