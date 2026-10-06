import { describe, expect, it } from "vitest";
import { inferSourceKind, isAllowedProviderUrl, playableSource, providerFor } from "../src/domain/providers.js";

describe("provider safety", () => {
  it("accepts only HTTPS allowlisted providers", () => {
    expect(isAllowedProviderUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isAllowedProviderUrl("http://youtube.com/watch?v=abc")).toBe(false);
    expect(isAllowedProviderUrl("https://youtube.com.evil.example/watch?v=abc")).toBe(false);
    expect(isAllowedProviderUrl("not a URL")).toBe(false);
  });

  it("creates safe supported embed URLs", () => {
    expect(playableSource("https://youtu.be/AbC123")).toEqual({
      playable: true,
      playUrl: "https://www.youtube.com/embed/AbC123",
      kind: "embed",
    });
    expect(playableSource("https://www.netflix.com/title/123")).toEqual({ playable: false });
  });

  it("identifies provider and conservative source kind", () => {
    expect(providerFor("https://www.shahid.mbc.net/ar/movies/123")).toBe("Shahid");
    expect(inferSourceKind({ url: "https://youtube.com/watch?v=x", title: "Official trailer", content: "Trailer" })).toBe("short_clip");
    expect(inferSourceKind({ url: "https://archive.org/details/x", title: "Film", content: "Feature" })).toBe("full_movie");
  });
});
