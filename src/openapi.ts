export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Any Movie API",
    version: "1.0.0",
    description:
      "Arabic-first legal movie discovery API for web and mobile clients.",
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
        summary: "Supported legal providers",
        responses: { "200": { description: "Provider list" } },
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
    "/api/v1/search": {
      post: {
        summary: "Identify a title and rank legal viewing sources",
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
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Ranked discovery response" },
          "400": { description: "Invalid request" },
          "429": { description: "Rate limited" },
          "502": { description: "Upstream provider failure" },
        },
      },
    },
  },
} as const;
