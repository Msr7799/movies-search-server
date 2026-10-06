import { describe, expect, it } from "vitest";
import { inferSourceKind, isAllowedProviderUrl, playableSource, providerFor } from "../src/domain/providers.js";

describe("open web source helpers", () => {
  it("accepts arbitrary public-shaped HTTPS hosts without a provider list", () => {
    expect(isAllowedProviderUrl("https://video.example.com/watch/1")).toBe(true);
    expect(isAllowedProviderUrl("http://video.example.com/watch/1")).toBe(false);
    expect(isAllowedProviderUrl("not a URL")).toBe(false);
  });

  it("recognizes direct media by URL without domain configuration", () => {
    expect(playableSource("https://cdn.example.com/movie/master.m3u8?token=public")).toMatchObject({
      playable: true,
      kind: "hls",
    });
    expect(playableSource("https://cdn.other.example/movie/file.mp4")).toMatchObject({
      playable: true,
      kind: "video",
      downloadable: true,
    });
  });

  it("uses the hostname as the source label", () => {
    expect(providerFor("https://www.media.example.org/watch/1")).toBe("media.example.org");
    expect(inferSourceKind({ url: "https://site.example/watch", title: "Movie", content: "مشاهدة فيلم كامل مترجم" })).toBe("full_movie");
  });
});
