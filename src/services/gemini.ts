import { requireEnv } from "../config.js";
import { withRetry } from "../infrastructure/retry.js";

type GeminiKey = "GEMINI_API_KEY" | "GEMINI_AUTO_SUGGESTED_API_KEY";

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

export async function geminiJson<T>(options: {
  prompt: string;
  schema: object;
  models: string[];
  key: GeminiKey;
  timeoutMs: number;
}): Promise<T> {
  const apiKey = await requireEnv(options.key);
  const failures: string[] = [];

  for (const model of options.models) {
    try {
      return await withRetry(async () => {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: options.prompt }] }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
                responseSchema: options.schema,
              },
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
          },
        );
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable) throw new Error(`GEMINI_RETRYABLE:${response.status}`);
          throw new Error(`GEMINI_REJECTED:${response.status}`);
        }
        const payload = await response.json() as GeminiPayload;
        const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
        if (!text) throw new Error("GEMINI_EMPTY");
        return JSON.parse(text) as T;
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "unknown");
    }
  }

  throw new Error(`GEMINI_UNAVAILABLE:${failures.join("|")}`);
}
