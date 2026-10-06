import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isAllowedProviderUrl, playableSource } from "../domain/providers.js";
import type { DiscoveryResult } from "../domain/types.js";

const MAX_PAGE_BYTES = 768 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const PAGE_TIMEOUT_MS = 5_500;
const MEDIA_TIMEOUT_MS = 4_500;
const MAX_REDIRECTS = 3;

type ExtractedMedia = { hls: string[]; video: string[] };
type FetchTextResult = { url: string; contentType: string; text: string };

function privateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a = 0, b = 0] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateIp(address: string) {
  const version = isIP(address);
  if (version === 4) return privateIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("2001:db8")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

async function assertPublicHttpsUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) throw new Error("UNSAFE_MEDIA_URL");
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".local")) throw new Error("UNSAFE_MEDIA_HOST");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => privateIp(address))) throw new Error("PRIVATE_MEDIA_HOST");
  return parsed;
}

async function readTextLimited(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("MEDIA_RESPONSE_TOO_LARGE");
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

async function fetchPublicText(
  initialUrl: string,
  options: { maxBytes: number; timeoutMs: number; requireProvider: boolean },
): Promise<FetchTextResult> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHttpsUrl(current);
    if (options.requireProvider && !isAllowedProviderUrl(current)) throw new Error("PROVIDER_REDIRECT_BLOCKED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/vnd.apple.mpegurl,application/x-mpegURL,video/*;q=0.9,*/*;q=0.5",
          "User-Agent": "AnyMovieMediaProbe/1.1",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) throw new Error("MEDIA_REDIRECT_FAILED");
        await response.body?.cancel();
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) throw new Error(`MEDIA_HTTP_${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.startsWith("video/")) {
        await response.body?.cancel();
        return { url: current, contentType, text: "" };
      }
      return {
        url: current,
        contentType,
        text: await readTextLimited(response, options.maxBytes),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("MEDIA_REDIRECT_FAILED");
}

function decodeMarkup(value: string) {
  return value
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/");
}

function safeResolvedMediaUrl(value: string, baseUrl: string) {
  try {
    const parsed = new URL(decodeMarkup(value.trim()), baseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function extractMediaCandidates(markup: string, baseUrl: string): ExtractedMedia {
  const text = decodeMarkup(markup);
  const hls = new Set<string>();
  const video = new Set<string>();
  const add = (raw: string) => {
    const value = safeResolvedMediaUrl(raw, baseUrl);
    if (!value) return;
    const pathname = new URL(value).pathname.toLowerCase();
    if (pathname.endsWith(".m3u8")) hls.add(value);
    else if (/\.(?:mp4|webm|m4v|mov|ogg)$/.test(pathname)) video.add(value);
  };

  const quoted = /["']([^"'<>\s]+?\.(?:m3u8|mp4|webm|m4v|mov|ogg)(?:\?[^"'<>\s]*)?)["']/gi;
  for (const match of text.matchAll(quoted)) if (match[1]) add(match[1]);

  const absolute = /https:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm|m4v|mov|ogg)(?:\?[^\s"'<>\\]*)?/gi;
  for (const match of text.matchAll(absolute)) if (match[0]) add(match[0]);

  const namedHls = /["'](?:hls(?:manifest)?(?:url)?|hls_url|playlist(?:url)?|manifesturl)["']\s*[:=]\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(namedHls)) {
    const value = match[1] ? safeResolvedMediaUrl(match[1], baseUrl) : undefined;
    if (value) hls.add(value);
  }

  const sourceTags = /<source\b[^>]*>/gi;
  for (const tagMatch of text.matchAll(sourceTags)) {
    const tag = tagMatch[0];
    if (!/type=["'](?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl)["']/i.test(tag)) continue;
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    const value = src ? safeResolvedMediaUrl(src, baseUrl) : undefined;
    if (value) hls.add(value);
  }

  return { hls: [...hls].slice(0, 8), video: [...video].slice(0, 8) };
}

export function analyzeHlsManifest(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const valid = normalized.trimStart().startsWith("#EXTM3U");
  const variants = valid ? (normalized.match(/^#EXT-X-STREAM-INF:/gim)?.length ?? 0) : 0;
  const mediaPlaylist = valid && /(?:^|\n)#EXTINF:/i.test(normalized);
  const encrypted = valid && /#EXT-X-(?:SESSION-)?KEY:[^\n]*METHOD=(?!NONE(?:,|$))/i.test(normalized);
  return {
    valid,
    master: valid && variants > 0,
    variantCount: variants,
    ...(mediaPlaylist ? { live: !/(?:^|\n)#EXT-X-ENDLIST(?:\n|$)/i.test(normalized) } : {}),
    encrypted,
  };
}

async function inspectHls(url: string) {
  try {
    const response = await fetchPublicText(url, { maxBytes: MAX_MANIFEST_BYTES, timeoutMs: MEDIA_TIMEOUT_MS, requireProvider: false });
    const info = analyzeHlsManifest(response.text);
    const verified = info.valid || response.contentType.includes("mpegurl");
    return { verified, info };
  } catch {
    return { verified: false, info: analyzeHlsManifest("") };
  }
}

function hlsInfoPatch(info: ReturnType<typeof analyzeHlsManifest>): Partial<DiscoveryResult> {
  return {
    hlsMaster: info.master,
    hlsVariantCount: info.variantCount,
    ...(info.live === undefined ? {} : { hlsLive: info.live }),
    hlsEncrypted: info.encrypted,
  };
}

function directDownloadPatch(source: ReturnType<typeof playableSource>) {
  if (source.playable && source.kind === "video" && source.playUrl) {
    return { downloadable: true, downloadUrl: source.playUrl, detectedBy: "direct_url" as const };
  }
  if (source.playable) return { detectedBy: "direct_url" as const };
  return {};
}

export async function discoverPlayableMedia(pageUrl: string): Promise<Partial<DiscoveryResult>> {
  const direct = playableSource(pageUrl);
  const directPatch = directDownloadPatch(direct);
  if (direct.playable && direct.kind === "hls" && direct.hlsUrl) {
    const inspected = await inspectHls(direct.hlsUrl);
    return { ...direct, ...directPatch, ...(inspected.verified ? hlsInfoPatch(inspected.info) : {}) };
  }
  if (direct.playable && direct.kind !== "embed") return { ...direct, ...directPatch };
  if (!isAllowedProviderUrl(pageUrl)) return { ...direct, ...directPatch };
  const hostname = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  const probeUsefulEmbed = direct.kind === "embed" && (hostname === "vimeo.com" || hostname.endsWith(".vimeo.com") || hostname === "archive.org" || hostname.endsWith(".archive.org"));
  if (direct.playable && direct.kind === "embed" && !probeUsefulEmbed) return { ...direct, ...directPatch };

  try {
    const page = await fetchPublicText(pageUrl, { maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS, requireProvider: true });
    if (page.contentType.includes("mpegurl") || page.text.trimStart().startsWith("#EXTM3U")) {
      const info = analyzeHlsManifest(page.text);
      return { playable: true, playUrl: page.url, hlsUrl: page.url, kind: "hls", detectedBy: "content_type", ...hlsInfoPatch(info) };
    }
    if (page.contentType.startsWith("video/")) {
      return { playable: true, playUrl: page.url, kind: "video", downloadable: true, downloadUrl: page.url, detectedBy: "content_type" };
    }

    const extracted = extractMediaCandidates(page.text, page.url);
    const verifiedHls = await Promise.all(
      extracted.hls.slice(0, 3).map(async (hlsUrl) => ({ hlsUrl, inspected: await inspectHls(hlsUrl) })),
    );
    const hls = verifiedHls.find((item) => item.inspected.verified);
    if (hls) {
      return {
        playable: true,
        playUrl: hls.hlsUrl,
        hlsUrl: hls.hlsUrl,
        kind: "hls",
        detectedBy: "html_manifest",
        ...hlsInfoPatch(hls.inspected.info),
      };
    }
    const videoUrl = extracted.video[0];
    if (videoUrl) {
      await assertPublicHttpsUrl(videoUrl);
      return { playable: true, playUrl: videoUrl, kind: "video", downloadable: true, downloadUrl: videoUrl, detectedBy: "html_media" };
    }
  } catch {
    // Keep the deterministic provider/embed fallback when probing is unavailable.
  }
  return { ...direct, ...directPatch };
}

export async function enrichDiscoveryResults(results: DiscoveryResult[]) {
  return Promise.all(results.map(async (result) => ({ ...result, ...(await discoverPlayableMedia(result.url)) })));
}
