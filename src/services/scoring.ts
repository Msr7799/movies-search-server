import { inferSourceKind, playableSource, providerFor } from "../domain/providers.js";
import type { Candidate, ContentType, DiscoveryResult, TavilyResult } from "../domain/types.js";

export function normalizeText(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function titleSimilarity(candidateTitle: string, knownTitles: string[]) {
  const candidate = normalizeText(candidateTitle);
  if (!candidate) return 0;
  let best = 0;
  for (const rawTitle of knownTitles) {
    const title = normalizeText(rawTitle);
    if (!title) continue;
    if (candidate === title) best = Math.max(best, 1);
    else if (candidate.includes(title) || title.includes(candidate)) best = Math.max(best, 0.82);
    else {
      const left = new Set(candidate.split(" "));
      const right = new Set(title.split(" "));
      const intersection = [...left].filter((token) => right.has(token)).length;
      const union = new Set([...left, ...right]).size;
      best = Math.max(best, union ? intersection / union : 0);
    }
  }
  return best;
}

export function makeCandidates(results: TavilyResult[], knownTitles: string[]) {
  const unique = new Map<string, TavilyResult>();
  for (const item of results) {
    if (!item.url) continue;
    let normalized: string;
    try {
      const parsed = new URL(item.url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) continue;
      parsed.hash = "";
      normalized = parsed.href;
    } catch {
      continue;
    }
    const previous = unique.get(normalized);
    if (!previous || (item.score ?? 0) > (previous.score ?? 0)) unique.set(normalized, { ...item, url: normalized });
  }

  return [...unique.values()].map((item, index): Candidate => {
    const url = item.url!;
    const title = item.title?.trim() || new URL(url).hostname;
    const content = (item.content ?? "").replace(/\s+/g, " ").slice(0, 900);
    const source = playableSource(url);
    const partial = { url, title, content };
    const kind = inferSourceKind(partial);
    const similarity = titleSimilarity(`${title} ${content.slice(0, 240)}`, knownTitles);
    const kindBoost = kind === "full_movie" ? 0.18 : kind === "availability_page" ? 0.04 : -0.2;
    const playableBoost = source.playable ? 0.18 : 0;
    return {
      id: String(index + 1), title, url, content,
      tavilyScore: Math.max(0, Math.min(1, item.score ?? 0)),
      heuristicScore: similarity * 0.58 + (item.score ?? 0) * 0.24 + kindBoost + playableBoost,
      playable: source.playable,
      inferredKind: kind,
      providerPriority: 0,
    };
  }).sort((a, b) => b.heuristicScore - a.heuristicScore).slice(0, 24);
}

export function toDiscoveryResult(
  candidate: Candidate,
  selected: { title?: string; description?: string; reason?: string; source_kind?: ContentType } = {},
): DiscoveryResult {
  const source = playableSource(candidate.url);
  const contentType = candidate.inferredKind === "short_clip" || selected.source_kind === "short_clip"
    ? "short_clip"
    : candidate.inferredKind === "full_movie" || selected.source_kind === "full_movie"
      ? "full_movie"
      : "availability_page";
  return {
    id: candidate.id,
    title: selected.title?.trim() || candidate.title,
    provider: providerFor(candidate.url),
    url: candidate.url,
    description: selected.description?.trim() || candidate.content.slice(0, 240),
    reason: selected.reason?.trim() || "تم العثور على الصفحة من بحث ويب عام ثم فحصها بحثًا عن مصدر وسائط مباشر.",
    contentType,
    providerPriority: 1,
    confidence: Math.max(0, Math.min(1, Number(candidate.heuristicScore.toFixed(3)))),
    ...source,
  };
}
