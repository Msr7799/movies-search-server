import {
  inferSourceKind,
  playableSource,
  providerFor,
} from "../domain/providers.js";
import type {
  Candidate,
  ContentType,
  DiscoveryResult,
  TavilyResult,
} from "../domain/types.js";

export function normalizeText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function titleSimilarity(candidateTitle: string, knownTitles: string[]) {
  const candidate = normalizeText(candidateTitle);
  if (!candidate) return 0;
  let best = 0;
  for (const rawTitle of knownTitles) {
    const title = normalizeText(rawTitle);
    if (!title) continue;
    if (candidate === title) best = Math.max(best, 1);
    else if (candidate.includes(title) || title.includes(candidate))
      best = Math.max(best, 0.82);
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
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.port
      )
        continue;
      parsed.hash = "";
      normalized = parsed.href;
    } catch {
      continue;
    }
    const previous = unique.get(normalized);
    if (!previous || (item.score ?? 0) > (previous.score ?? 0))
      unique.set(normalized, { ...item, url: normalized });
  }

  return [...unique.values()]
    .map((item, index): Candidate => {
      const url = item.url!;
      const parsed = new URL(url);
      const title = item.title?.trim() || parsed.hostname;
      const content = (item.content ?? "").replace(/\s+/g, " ").slice(0, 1200);
      const source = playableSource(url);
      const partial = { url, title, content };
      const kind = inferSourceKind(partial);
      const similarity = titleSimilarity(
        `${title} ${content.slice(0, 360)}`,
        knownTitles,
      );
      const kindBoost =
        kind === "full_movie"
          ? 0.2
          : kind === "availability_page"
            ? 0.01
            : -0.24;
      const playableBoost = source.playable ? 0.2 : 0;

      // General open-web intent ranking: keep dynamic watch/player pages near the top even
      // when Tavily gives them a modest score. This is domain-agnostic and does not depend
      // on a provider list. It is especially useful for indexed pages whose HTML crawler
      // later fails because the actual player is created by JavaScript.
      const route = `${parsed.pathname}${parsed.search}`.toLowerCase();
      const watchRoute =
        /(?:^|[\/_\-.])(?:watch|play|player|embed|stream|video)(?:[\/_\-.]|\.php|$)/i.test(
          route,
        );
      const mediaId = /[?&](?:vid|video|movie|media|id|watch|play)=[^&]+/i.test(
        parsed.search,
      );
      const playerIntentBoost = watchRoute ? 0.12 : mediaId ? 0.07 : 0;
      const fullEvidence =
        /\b(full movie|full film|complete movie|watch full|movie online|stream online)\b|(?:مشاهدة\s+فيلم|فيلم\s+كامل|مترجم)/i.test(
          `${title} ${content}`,
        );
      const fullEvidenceBoost = fullEvidence ? 0.09 : 0;
      const availabilityLanding =
        /\b(where to watch|streaming services|rent or buy|rent|buy online|subscription)\b/i.test(
          `${title} ${content}`,
        );
      const availabilityPenalty = availabilityLanding && !watchRoute ? 0.1 : 0;

      return {
        id: String(index + 1),
        title,
        url,
        content,
        tavilyScore: Math.max(0, Math.min(1, item.score ?? 0)),
        heuristicScore:
          similarity * 0.56 +
          (item.score ?? 0) * 0.22 +
          kindBoost +
          playableBoost +
          playerIntentBoost +
          fullEvidenceBoost -
          availabilityPenalty,
        playable: source.playable,
        inferredKind: kind,
        providerPriority: 0,
      };
    })
    .sort((a, b) => b.heuristicScore - a.heuristicScore)
    .slice(0, 220);
}

function subtitleHints(value: string) {
  const hints: string[] = [];
  if (
    /(?:arabic subtitles?|arabic subbed|ترجمة عربية|مترجم(?:ة)?(?:\s+ب)?العربية|مترجم عربي|مترجم)/i.test(
      value,
    )
  )
    hints.push("ar");
  if (/(?:english subtitles?|eng(?:lish)? subbed)/i.test(value))
    hints.push("en");
  if (/(?:turkish subtitles?|türkçe altyazı)/i.test(value)) hints.push("tr");
  return [...new Set(hints)];
}

export function toDiscoveryResult(
  candidate: Candidate,
  selected: {
    title?: string;
    description?: string;
    reason?: string;
    source_kind?: ContentType;
  } = {},
): DiscoveryResult {
  const source = playableSource(candidate.url);
  const contentType =
    candidate.inferredKind === "short_clip" ||
    selected.source_kind === "short_clip"
      ? "short_clip"
      : candidate.inferredKind === "full_movie" ||
          selected.source_kind === "full_movie"
        ? "full_movie"
        : "availability_page";
  const subtitleLanguages = subtitleHints(
    `${candidate.title} ${candidate.content}`,
  );
  return {
    id: candidate.id,
    title: selected.title?.trim() || candidate.title,
    provider: providerFor(candidate.url),
    url: candidate.url,
    description:
      selected.description?.trim() || candidate.content.slice(0, 240),
    reason:
      selected.reason?.trim() ||
      "تم العثور على الصفحة من بحث ويب عام ثم فحصها بحثًا عن مصدر وسائط مباشر.",
    contentType,
    providerPriority: 1,
    confidence: Math.max(
      0,
      Math.min(1, Number(candidate.heuristicScore.toFixed(3))),
    ),
    ...(subtitleLanguages.length > 0
      ? { subtitleLanguages, subtitleEvidence: "page_text" as const }
      : {}),
    ...source,
  };
}
