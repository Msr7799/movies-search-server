import { describe, expect, it } from "vitest";
import { makeCandidates, normalizeText, titleSimilarity } from "../src/services/scoring.js";

describe("candidate scoring", () => {
  it("normalizes multilingual punctuation", () => {
    expect(normalizeText("  Veer—Zaara! ")).toBe("veer zaara");
    expect(normalizeText("فيلم: ديفداس")).toBe("فيلم ديفداس");
  });

  it("prefers an exact title match", () => {
    expect(titleSimilarity("Devdas", ["Devdas", "ديفداس"])).toBe(1);
    expect(titleSimilarity("Devdas full movie", ["Devdas"])).toBeGreaterThan(0.8);
  });

  it("deduplicates arbitrary HTTPS URLs without provider configuration", () => {
    const candidates = makeCandidates([
      { title: "Devdas full movie", url: "https://movies.example/details/devdas", content: "complete film", score: 0.8 },
      { title: "Devdas trailer", url: "https://video.example/watch/x", content: "official trailer", score: 0.95 },
      { title: "duplicate", url: "https://movies.example/details/devdas", content: "duplicate", score: 0.1 },
    ], ["Devdas"]);
    expect(candidates).toHaveLength(2);
    expect(candidates.find((candidate) => candidate.url.includes("movies.example"))?.inferredKind).toBe("full_movie");
  });
});
