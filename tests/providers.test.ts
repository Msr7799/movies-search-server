import { afterEach, describe, expect, it } from "vitest";
import { getProviders, inferSourceKind, isAllowedProviderUrl, playableSource, providerFor } from "../src/domain/providers.js";

const originalProviders = process.env.PROVIDERS;
afterEach(() => {
  if (originalProviders === undefined) delete process.env.PROVIDERS;
  else process.env.PROVIDERS = originalProviders;
  delete process.env.PROVIDERS_JSON;
  delete process.env.PROVIDERS_IN_APP_PLAYBACK;
});

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

  it("reads provider names and order from the environment", () => {
    process.env.PROVIDERS = JSON.stringify([
      { domain: "media.example.com", name: "First", inAppPlayback: true },
      { domain: "catalog.example.org", name: "Second", inAppPlayback: false },
    ]);
    expect(getProviders()).toEqual([
      { domain: "media.example.com", name: "First", inAppPlayback: true },
      { domain: "catalog.example.org", name: "Second", inAppPlayback: false },
    ]);
    expect(providerFor("https://media.example.com/movie/master.m3u8")).toBe("First");
  });

  it("returns a direct HLS link only for an in-app configured provider", () => {
    process.env.PROVIDERS = JSON.stringify([
      { domain: "media.example.com", name: "Media", inAppPlayback: true },
      { domain: "blocked.example.com", name: "Blocked", inAppPlayback: false },
    ]);
    expect(playableSource("https://cdn.media.example.com/movie/master.m3u8?token=public")).toEqual({
      playable: true,
      playUrl: "https://cdn.media.example.com/movie/master.m3u8?token=public",
      hlsUrl: "https://cdn.media.example.com/movie/master.m3u8?token=public",
      kind: "hls",
    });
    expect(playableSource("https://blocked.example.com/movie/master.m3u8")).toEqual({ playable: false });
  });

  it("supports one boolean override for all configured providers", () => {
    process.env.PROVIDERS = JSON.stringify([
      { domain: "one.example.com", name: "One", inAppPlayback: false },
      { domain: "two.example.com", name: "Two", inAppPlayback: false },
    ]);
    process.env.PROVIDERS_IN_APP_PLAYBACK = "true";
    expect(getProviders().every((provider) => provider.inAppPlayback)).toBe(true);
  });
});
