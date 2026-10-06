import type { Candidate, ContentType, DiscoveryResult } from "./types.js";

export type ProviderConfig = {
  domain: string;
  name: string;
  inAppPlayback: boolean;
};

export const DEFAULT_PROVIDERS: readonly ProviderConfig[] = [
  { domain: "youtube.com", name: "YouTube", inAppPlayback: true },
  { domain: "youtu.be", name: "YouTube", inAppPlayback: true },
  { domain: "vimeo.com", name: "Vimeo", inAppPlayback: true },
  { domain: "archive.org", name: "Internet Archive", inAppPlayback: true },
  { domain: "justwatch.com", name: "JustWatch", inAppPlayback: false },
  { domain: "reelgood.com", name: "Reelgood", inAppPlayback: false },
  { domain: "netflix.com", name: "Netflix", inAppPlayback: false },
  { domain: "primevideo.com", name: "Prime Video", inAppPlayback: false },
  { domain: "amazon.com", name: "Amazon", inAppPlayback: false },
  { domain: "disneyplus.com", name: "Disney+", inAppPlayback: false },
  { domain: "hulu.com", name: "Hulu", inAppPlayback: false },
  { domain: "max.com", name: "Max", inAppPlayback: false },
  { domain: "tubitv.com", name: "Tubi", inAppPlayback: false },
  { domain: "plex.tv", name: "Plex", inAppPlayback: false },
  { domain: "pluto.tv", name: "Pluto TV", inAppPlayback: false },
  { domain: "mubi.com", name: "MUBI", inAppPlayback: false },
  { domain: "criterionchannel.com", name: "Criterion Channel", inAppPlayback: false },
  { domain: "kanopy.com", name: "Kanopy", inAppPlayback: false },
  { domain: "hoopladigital.com", name: "Hoopla", inAppPlayback: false },
  { domain: "rakuten.tv", name: "Rakuten TV", inAppPlayback: false },
  { domain: "tv.apple.com", name: "Apple TV", inAppPlayback: false },
  { domain: "shahid.mbc.net", name: "Shahid", inAppPlayback: false },
  { domain: "watchit.com", name: "WATCH IT", inAppPlayback: false },
  { domain: "filmzie.com", name: "Filmzie", inAppPlayback: false },
  { domain: "dailymotion.com", name: "Dailymotion", inAppPlayback: true },
];

function normalizeDomain(value: string) {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    const hostname = parsed.hostname.replace(/^www\./, "");
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname) ? hostname : "";
  } catch {
    return "";
  }
}

function parsedProviders(value: string | undefined): ProviderConfig[] {
  if (!value?.trim()) return [];
  try {
    const input: unknown = JSON.parse(value);
    if (!Array.isArray(input)) return [];
    const providers: ProviderConfig[] = [];
    const seen = new Set<string>();
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const domain = typeof record.domain === "string" ? normalizeDomain(record.domain) : "";
      const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
      if (!domain || !name || typeof record.inAppPlayback !== "boolean" || seen.has(domain)) continue;
      seen.add(domain);
      providers.push({ domain, name, inAppPlayback: record.inAppPlayback });
    }
    return providers;
  } catch {
    return [];
  }
}

export function getProviders(): readonly ProviderConfig[] {
  const configured = parsedProviders(process.env.PROVIDERS_JSON ?? process.env.PROVIDERS);
  const providers = configured.length > 0 ? configured : DEFAULT_PROVIDERS;
  const override = process.env.PROVIDERS_IN_APP_PLAYBACK?.trim().toLowerCase();
  if (override !== "true" && override !== "false") return providers;
  const inAppPlayback = override === "true";
  return providers.map((provider) => ({ ...provider, inAppPlayback }));
}

export function getProviderConfigSignature() {
  return getProviders().map(({ domain, name, inAppPlayback }) => `${domain}:${name}:${Number(inAppPlayback)}`).join("|");
}

export function getProviderDomains() {
  return getProviders().map(({ domain }) => domain);
}

export function getPlayableDomains() {
  return getProviders().filter(({ inAppPlayback }) => inAppPlayback).map(({ domain }) => domain);
}

function hostnameOf(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function configuredProvider(value: string) {
  const hostname = hostnameOf(value);
  const providers = getProviders();
  const index = providers.findIndex(({ domain }) => matchesDomain(hostname, domain));
  return index < 0 ? undefined : { provider: providers[index]!, index };
}

export function providerPriorityFor(value: string) {
  try {
    return configuredProvider(value)?.index ?? Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function isAllowedProviderUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(configuredProvider(value));
  } catch {
    return false;
  }
}

export function providerFor(value: string) {
  const hostname = hostnameOf(value);
  return configuredProvider(value)?.provider.name ?? hostname;
}

export function playableSource(value: string): Pick<DiscoveryResult, "playable" | "playUrl" | "hlsUrl" | "kind"> {
  const parsed = new URL(value);
  const configured = configuredProvider(value)?.provider;
  if (!configured?.inAppPlayback) return { playable: false };

  if (/\.m3u8$/i.test(parsed.pathname)) {
    return { playable: true, playUrl: parsed.href, hlsUrl: parsed.href, kind: "hls" };
  }
  if (/\.(mp4|webm|mov|m4v|ogg)$/i.test(parsed.pathname)) {
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
  if (fullPattern.test(evidence) || /\.(m3u8|mp4|webm|mov|m4v|ogg)$/i.test(parsed.pathname) || matchesDomain(host, "archive.org")) {
    return "full_movie";
  }
  const hosted = getPlayableDomains().some((domain) => matchesDomain(host, domain));
  return hosted ? "short_clip" : "availability_page";
}
