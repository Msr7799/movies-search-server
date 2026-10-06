import { afterEach, describe, expect, it } from "vitest";
import { makeCandidates, normalizeText, titleSimilarity } from "../src/services/scoring.js";

const originalProviders = process.env.PROVIDERS;
afterEach(() => {
  if (originalProviders === undefined) delete process.env.PROVIDERS;
  else process.env.PROVIDERS = originalProviders;
  delete process.env.PROVIDERS_JSON;
  delete process.env.PROVIDERS_IN_APP_PLAYBACK;
});

describe("candidate scoring", () => {
  it("normalizes multilingual punctuation", () => {
    expect(normalizeText("  Veer—Zaara! ")).toBe("veer zaara");
    expect(normalizeText("فيلم: ديفداس")).toBe("فيلم ديفداس");
  });

  it("prefers an exact title match", () => {
    expect(titleSimilarity("Devdas", ["Devdas", "ديفداس"])).toBe(1);
    expect(titleSimilarity("Devdas full movie", ["Devdas"])).toBeGreaterThan(0.8);
  });

  it("deduplicates URLs and identifies full exact matches", () => {
    const candidates = makeCandidates([
      { title: "Devdas full movie", url: "https://archive.org/details/devdas", content: "complete film", score: 0.8 },
      { title: "Devdas trailer", url: "https://youtube.com/watch?v=x", content: "official trailer", score: 0.95 },
      { title: "duplicate", url: "https://archive.org/details/devdas", content: "duplicate", score: 0.1 },
    ], ["Devdas"]);
    expect(candidates).toHaveLength(2);
    expect(candidates.find((candidate) => candidate.url.includes("archive.org"))?.inferredKind).toBe("full_movie");
  });

  it("orders candidates by the configured provider priority", () => {
    process.env.PROVIDERS = JSON.stringify([
      { domain: "second.test", name: "Configured first", inAppPlayback: false },
      { domain: "first.test", name: "Configured second", inAppPlayback: false },
    ]);
    const candidates = makeCandidates([
      { title: "Movie", url: "https://first.test/movie", content: "watch legally", score: 1 },
      { title: "Movie", url: "https://second.test/movie", content: "watch legally", score: 0.1 },
    ], ["Movie"]);
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      "https://second.test/movie",
      "https://first.test/movie",
    ]);
  });
});
