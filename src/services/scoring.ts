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
    if (!item.url || unique.has(item.url)) continue;
    unique.set(item.url, item);
  }

  return [...unique.values()].map((item, index): Candidate => {
    const url = item.url!;
    const title = item.title?.trim() || new URL(url).hostname;
    const content = (item.content ?? "").replace(/\s+/g, " ").slice(0, 700);
    const source = playableSource(url);
    const partial = { url, title, content };
    const kind = inferSourceKind(partial);
    const similarity = titleSimilarity(title, knownTitles);
    const kindBoost = kind === "full_movie" ? 0.18 : kind === "availability_page" ? 0.1 : -0.15;
    const playableBoost = source.playable && kind === "full_movie" ? 0.12 : 0;
    return {
      id: String(index + 1), title, url, content,
      tavilyScore: Math.max(0, Math.min(1, item.score ?? 0)),
      heuristicScore: similarity * 0.55 + (item.score ?? 0) * 0.25 + kindBoost + playableBoost,
      playable: source.playable,
      inferredKind: kind,
    };
  }).sort((a, b) => b.heuristicScore - a.heuristicScore).slice(0, 20);
}

export function toDiscoveryResult(
  candidate: Candidate,
  selected: { title?: string; description?: string; reason?: string; source_kind?: ContentType },
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
    description: selected.description?.trim() || candidate.content.slice(0, 220),
    reason: selected.reason?.trim() || "نتيجة من مزود عرض قانوني معروف.",
    contentType,
    confidence: Math.max(0, Math.min(1, Number(candidate.heuristicScore.toFixed(3)))),
    ...source,
  };
}
