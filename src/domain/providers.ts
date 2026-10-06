import type { Candidate, ContentType, DiscoveryResult } from "./types.js";

/**
 * Compatibility helpers for the Android/API model. Search is intentionally open-web:
 * there is no configured provider allow-list. The word "provider" in the response now
 * means the hostname that supplied the page/media.
 */
export type ProviderConfig = never;

export function getProviders(): readonly never[] {
  return [];
}

export function getProviderConfigSignature() {
  return "open-web-v2";
}

export function getProviderDomains() {
  return [] as string[];
}

export function getPlayableDomains() {
  return [] as string[];
}

function parsedPublicHttps(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return undefined;
    if (!parsed.hostname.includes(".")) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function providerPriorityFor(_value: string) {
  return 0;
}

export function isAllowedProviderUrl(value: string) {
  return Boolean(parsedPublicHttps(value));
}

export function isPlayableProviderUrl(value: string) {
  return Boolean(parsedPublicHttps(value));
}

export function providerFor(value: string) {
  return parsedPublicHttps(value)?.hostname.toLowerCase().replace(/^www\./, "") ?? "web";
}

export function playableSource(value: string): Pick<DiscoveryResult, "playable" | "playUrl" | "hlsUrl" | "kind" | "downloadable" | "downloadUrl" | "detectedBy"> {
  const parsed = parsedPublicHttps(value);
  if (!parsed) return { playable: false };

  if (/\.m3u8$/i.test(parsed.pathname)) {
    return { playable: true, playUrl: parsed.href, hlsUrl: parsed.href, kind: "hls", detectedBy: "direct_url" };
  }
  if (/\.(mp4|webm|mov|m4v|ogg|ogv)$/i.test(parsed.pathname)) {
    return { playable: true, playUrl: parsed.href, kind: "video", downloadable: true, downloadUrl: parsed.href, detectedBy: "direct_url" };
  }
  return { playable: false };
}

export function inferSourceKind(candidate: Pick<Candidate, "url" | "title" | "content">): ContentType {
  const parsed = new URL(candidate.url);
  const evidence = `${candidate.title} ${candidate.content}`.toLowerCase();
  const shortPattern = /\b(trailer|teaser|clip|scene|song|music video|recap|review|interview|behind the scenes|shorts?)\b/i;
  const fullPattern = /\b(full movie|full film|complete movie|complete film|watch full|feature film|movie online|مشاهدة فيلم|فيلم كامل|مترجم)\b/i;
  if (shortPattern.test(evidence)) return "short_clip";
  if (fullPattern.test(evidence) || /\.(m3u8|mp4|webm|mov|m4v|ogg|ogv)$/i.test(parsed.pathname)) return "full_movie";
  return "availability_page";
}
