import { afterEach, describe, expect, it } from "vitest";
import { config, requireEnv, serviceReadiness } from "../src/config.js";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("configuration", () => {
  it("clamps unsafe numeric settings", () => {
    process.env.SEARCH_LIMIT_PER_10_MINUTES = "9999";
    expect(config.searchLimit).toBe(100);
  });

  it("never returns secret values in readiness", () => {
    process.env.TAVILY_API_KEY = "secret";
    const readiness = serviceReadiness();
    expect(readiness.tavily).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain("secret");
  });

  it("requires server credentials lazily", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => requireEnv("GEMINI_API_KEY")).toThrow("MISSING_ENV:GEMINI_API_KEY");
  });
});
