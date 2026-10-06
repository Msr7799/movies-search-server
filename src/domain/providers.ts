import type { Candidate, ContentType, DiscoveryResult } from "./types.js";

export const LEGAL_PROVIDERS = [
  ["youtube.com", "YouTube"], ["youtu.be", "YouTube"], ["vimeo.com", "Vimeo"],
  ["archive.org", "Internet Archive"], ["justwatch.com", "JustWatch"],
  ["reelgood.com", "Reelgood"], ["netflix.com", "Netflix"],
  ["primevideo.com", "Prime Video"], ["amazon.com", "Amazon"],
  ["disneyplus.com", "Disney+"], ["hulu.com", "Hulu"], ["max.com", "Max"],
  ["tubitv.com", "Tubi"], ["plex.tv", "Plex"], ["pluto.tv", "Pluto TV"],
  ["mubi.com", "MUBI"], ["criterionchannel.com", "Criterion Channel"],
  ["kanopy.com", "Kanopy"], ["hoopladigital.com", "Hoopla"],
  ["rakuten.tv", "Rakuten TV"], ["tv.apple.com", "Apple TV"],
  ["shahid.mbc.net", "Shahid"], ["watchit.com", "WATCH IT"],
  ["filmzie.com", "Filmzie"], ["dailymotion.com", "Dailymotion"],
] as const;

export const LEGAL_DOMAINS = [...new Set(LEGAL_PROVIDERS.map(([domain]) => domain))];
export const PLAYABLE_DOMAINS = ["youtube.com", "youtu.be", "vimeo.com", "archive.org", "dailymotion.com"];

function hostnameOf(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isAllowedProviderUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const hostname = hostnameOf(value);
    return LEGAL_DOMAINS.some((domain) => matchesDomain(hostname, domain));
  } catch {
    return false;
  }
}

export function providerFor(value: string) {
  const hostname = hostnameOf(value);
  return LEGAL_PROVIDERS.find(([domain]) => matchesDomain(hostname, domain))?.[1] ?? hostname;
}

export function playableSource(value: string): Pick<DiscoveryResult, "playable" | "playUrl" | "kind"> {
  const parsed = new URL(value);
  if (/\.(mp4|webm|mov|m4v|ogg)(?:$|[?#])/i.test(parsed.href)) {
    return { playable: true, playUrl: parsed.href, kind: "video" };
  }

  const host = hostnameOf(value);
  if (matchesDomain(host, "youtu.be")) {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    if (id) return { playable: true, playUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}`, kind: "embed" };
  }
  if (matchesDomain(host, "youtube.com")) {
    const id = parsed.searchParams.get("v") ?? parsed.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
    if (id) return { playable: true, playUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}`, kind: "embed" };
  }
  if (matchesDomain(host, "archive.org")) {
    const id = parsed.pathname.match(/^\/(?:details|embed)\/([^/?]+)/)?.[1];
    if (id) return { playable: true, playUrl: `https://archive.org/embed/${encodeURIComponent(id)}`, kind: "embed" };
  }
  if (matchesDomain(host, "vimeo.com")) {
    const id = parsed.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
    if (id) return { playable: true, playUrl: `https://player.vimeo.com/video/${id}`, kind: "embed" };
  }
  if (matchesDomain(host, "dailymotion.com")) {
    const id = parsed.pathname.match(/\/(?:video|embed\/video)\/([^_/?]+)/)?.[1];
    if (id) return { playable: true, playUrl: `https://www.dailymotion.com/embed/video/${encodeURIComponent(id)}`, kind: "embed" };
  }
  return { playable: false };
}

export function inferSourceKind(candidate: Pick<Candidate, "url" | "title" | "content">): ContentType {
  const parsed = new URL(candidate.url);
  const host = hostnameOf(candidate.url);
  const evidence = `${candidate.title} ${candidate.content}`.toLowerCase();
  const shortPattern = /\b(trailer|teaser|clip|scene|song|music video|recap|review|interview|behind the scenes|shorts?)\b/i;
  const fullPattern = /\b(full movie|full film|complete movie|complete film|watch full|feature film)\b/i;
  if (shortPattern.test(evidence)) return "short_clip";
  if (fullPattern.test(evidence) || /\.(mp4|webm|mov|m4v|ogg)(?:$|[?#])/i.test(parsed.href) || matchesDomain(host, "archive.org")) {
    return "full_movie";
  }
  const hosted = PLAYABLE_DOMAINS.some((domain) => matchesDomain(host, domain));
  return hosted ? "short_clip" : "availability_page";
}
