const required = ["TAVILY_API_KEY", "GEMINI_API_KEY", "GEMINI_AUTO_SUGGESTED_API_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required variables: ${missing.join(", ")}`);
  process.exit(1);
}

async function gemini(name) {
  const model = "gemini-3.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env[name] },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Return only the word OK." }] }], generationConfig: { maxOutputTokens: 8 } }),
    signal: AbortSignal.timeout(30_000),
  });
  return { service: name === "GEMINI_API_KEY" ? "gemini-search" : "gemini-suggestions", ok: response.ok, status: response.status };
}

async function tavily() {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query: "Internet Archive public domain films", search_depth: "basic", max_results: 1 }),
    signal: AbortSignal.timeout(30_000),
  });
  return { service: "tavily", ok: response.ok, status: response.status };
}

// Run sequentially to avoid artificial concurrency pressure on free-tier quotas.
const results = [];
for (const operation of [() => gemini("GEMINI_API_KEY"), () => gemini("GEMINI_AUTO_SUGGESTED_API_KEY"), tavily]) {
  try { results.push({ status: "fulfilled", value: await operation() }); }
  catch { results.push({ status: "rejected" }); }
}
const statuses = results.map((result, index) => result.status === "fulfilled"
  ? result.value
  : { service: ["gemini-search", "gemini-suggestions", "tavily"][index], ok: false, status: "network-error" });
console.log(JSON.stringify(statuses, null, 2));
if (statuses.some((status) => !status.ok)) process.exit(1);
