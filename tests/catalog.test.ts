import { describe, expect, it } from "vitest";
import { parseCollectorCatalog } from "../src/admin/catalog.js";

describe("collector catalog import", () => {
  it("keeps HLS streams and rejects telemetry or non-media URLs", () => {
    const movies = parseCollectorCatalog({
      movie: {
        title: "Authorized Movie 2026",
        pageURL: "https://catalog.example/watch/1",
        createdAt: 1_791_377_992_690,
        streams: [
          { url: "https://cdn.example/movie/master.m3u8?token=temporary", quality: "MASTER" },
          { url: "https://metrics.example/ping.gif", quality: "360p" },
          { url: "javascript:alert(1)", quality: "HLS" },
        ],
      },
    });
    expect(movies).toHaveLength(1);
    expect(movies[0]?.sources).toHaveLength(1);
    expect(movies[0]?.sources[0]?.quality).toBe("MASTER");
  });

  it("drops entries without a valid title, page URL, or HLS stream", () => {
    expect(parseCollectorCatalog({ invalid: { title: "No stream", pageURL: "https://example.com", streams: [] } })).toEqual([]);
  });
});
