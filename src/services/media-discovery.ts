import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isAllowedProviderUrl, isPlayableProviderUrl, playableSource } from "../domain/providers.js";
import type { DiscoveryResult } from "../domain/types.js";

const MAX_PAGE_BYTES = 900 * 1024;
const MAX_MANIFEST_BYTES = 320 * 1024;
const PAGE_TIMEOUT_MS = 6_500;
const MEDIA_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

type ExtractedMedia = { hls: string[]; video: string[]; audio: string[] };
type FetchTextResult = { url: string; contentType: string; text: string };

type HlsInfo = ReturnType<typeof analyzeHlsManifest>;

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
  options: { maxBytes: number; timeoutMs: number; requireProvider: boolean; referer?: string },
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
          Accept: "text/html,application/xhtml+xml,application/json,application/vnd.apple.mpegurl,application/x-mpegURL,video/*;q=0.9,*/*;q=0.5",
          "User-Agent": "AnyMovieMediaProbe/1.2",
          ...(options.referer ? { Referer: options.referer } : {}),
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
      if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
        await response.body?.cancel();
        return { url: current, contentType, text: "" };
      }
      return { url: current, contentType, text: await readTextLimited(response, options.maxBytes) };
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
    .replace(/\\x2f/gi, "/")
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

function mediaKind(value: string) {
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls" as const;
  if (/\.(?:mp4|webm|m4v|mov|ogv|ogg)$/.test(pathname)) return "video" as const;
  if (/\.(?:m4a|mp3|aac|wav|flac|oga)$/.test(pathname)) return "audio" as const;
  return undefined;
}

export function extractMediaCandidates(markup: string, baseUrl: string): ExtractedMedia {
  const text = decodeMarkup(markup);
  const hls = new Set<string>();
  const video = new Set<string>();
  const audio = new Set<string>();
  const add = (raw: string, forced?: "hls" | "video" | "audio") => {
    const value = safeResolvedMediaUrl(raw, baseUrl);
    if (!value) return;
    const kind = forced ?? mediaKind(value);
    if (kind === "hls") hls.add(value);
    else if (kind === "video") video.add(value);
    else if (kind === "audio") audio.add(value);
  };

  const quoted = /["']([^"'<>\s]+?\.(?:m3u8|mp4|webm|m4v|mov|ogv|ogg|m4a|mp3|aac|wav|flac|oga)(?:\?[^"'<>\s]*)?)["']/gi;
  for (const match of text.matchAll(quoted)) if (match[1]) add(match[1]);

  const absolute = /https:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm|m4v|mov|ogv|ogg|m4a|mp3|aac|wav|flac|oga)(?:\?[^\s"'<>\\]*)?/gi;
  for (const match of text.matchAll(absolute)) if (match[0]) add(match[0]);

  const namedHls = /["'](?:hls(?:manifest)?(?:url)?|hls_manifest_url|hls_url|m3u8(?:url)?|playlist(?:url)?|manifest(?:url)?|master(?:url)?)["']\s*[:=]\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(namedHls)) if (match[1]) add(match[1], "hls");

  const namedVideo = /["'](?:video(?:url)?|progressive(?:url)?|file|src)["']\s*[:=]\s*["']([^"']+\.(?:mp4|webm|m4v|mov|ogv|ogg)(?:\?[^"']*)?)["']/gi;
  for (const match of text.matchAll(namedVideo)) if (match[1]) add(match[1], "video");

  const sourceTags = /<(?:source|video|audio)\b[^>]*>/gi;
  for (const tagMatch of text.matchAll(sourceTags)) {
    const tag = tagMatch[0];
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    if (/type=["'](?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl)["']/i.test(tag)) add(src, "hls");
    else add(src);
  }

  const metaTags = /<meta\b[^>]*>/gi;
  for (const tagMatch of text.matchAll(metaTags)) {
    const tag = tagMatch[0];
    if (!/(?:og:video(?::url)?|twitter:player:stream)/i.test(tag)) continue;
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) add(content);
  }

  return { hls: [...hls].slice(0, 12), video: [...video].slice(0, 12), audio: [...audio].slice(0, 8) };
}

export function analyzeHlsManifest(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const valid = normalized.trimStart().startsWith("#EXTM3U");
  const variants = valid ? (normalized.match(/^#EXT-X-STREAM-INF:/gim)?.length ?? 0) : 0;
  const audioRenditions = valid ? (normalized.match(/^#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/gim)?.length ?? 0) : 0;
  const mediaPlaylist = valid && /(?:^|\n)#EXTINF:/i.test(normalized);
  const encrypted = valid && /#EXT-X-(?:SESSION-)?KEY:[^\n]*METHOD=(?!NONE(?:,|$))/i.test(normalized);
  const durations = valid ? [...normalized.matchAll(/^#EXTINF:([0-9.]+)/gim)].map((match) => Number(match[1])).filter(Number.isFinite) : [];
  const durationSeconds = durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0)) : undefined;
  return {
    valid,
    master: valid && variants > 0,
    variantCount: variants,
    audioRenditionCount: audioRenditions,
    ...(mediaPlaylist ? { live: !/(?:^|\n)#EXT-X-ENDLIST(?:\n|$)/i.test(normalized) } : {}),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    encrypted,
  };
}

async function inspectHls(url: string, referer?: string) {
  try {
    const response = await fetchPublicText(url, {
      maxBytes: MAX_MANIFEST_BYTES,
      timeoutMs: MEDIA_TIMEOUT_MS,
      requireProvider: false,
      ...(referer ? { referer } : {}),
    });
    const info = analyzeHlsManifest(response.text);
    const verified = info.valid || response.contentType.includes("mpegurl");
    return { verified, info };
  } catch {
    return { verified: false, info: analyzeHlsManifest("") };
  }
}

function hlsInfoPatch(info: HlsInfo): Partial<DiscoveryResult> {
  return {
    hlsMaster: info.master,
    hlsVariantCount: info.variantCount,
    hlsAudioRenditionCount: info.audioRenditionCount,
    ...(info.live === undefined ? {} : { hlsLive: info.live }),
    ...(info.durationSeconds === undefined ? {} : { hlsDurationSeconds: info.durationSeconds }),
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

function hostnameOf(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function matches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function vimeoId(value: string) {
  const parsed = new URL(value);
  return parsed.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
}

async function discoverVimeo(pageUrl: string): Promise<Partial<DiscoveryResult> | undefined> {
  const id = vimeoId(pageUrl);
  if (!id) return undefined;
  try {
    const configUrl = `https://player.vimeo.com/video/${encodeURIComponent(id)}/config`;
    const response = await fetchPublicText(configUrl, { maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS, requireProvider: true, referer: pageUrl });
    const json = JSON.parse(response.text) as Record<string, any>;
    const files = json.request?.files;
    const cdns = files?.hls?.cdns && typeof files.hls.cdns === "object" ? Object.values(files.hls.cdns) as Array<any> : [];
    const hlsUrl = cdns.map((item) => typeof item?.url === "string" ? item.url : "").find(Boolean);
    const progressive = Array.isArray(files?.progressive) ? files.progressive : [];
    const direct = progressive
      .filter((item: any) => typeof item?.url === "string" && item.url.startsWith("https://"))
      .sort((a: any, b: any) => Number(b?.height ?? 0) - Number(a?.height ?? 0))[0]?.url as string | undefined;
    if (hlsUrl) {
      const inspected = await inspectHls(hlsUrl, pageUrl);
      if (inspected.verified) return {
        playable: true, playUrl: hlsUrl, hlsUrl, kind: "hls", detectedBy: "provider_api",
        ...(direct ? { downloadable: true, downloadUrl: direct } : {}),
        ...hlsInfoPatch(inspected.info),
      };
    }
    if (direct) return { playable: true, playUrl: direct, kind: "video", downloadable: true, downloadUrl: direct, detectedBy: "provider_api" };
  } catch {
    return undefined;
  }
  return undefined;
}

function dailymotionId(value: string) {
  const parsed = new URL(value);
  return parsed.pathname.match(/\/(?:video|embed\/video)\/([^_/?]+)/)?.[1];
}

async function discoverDailymotion(pageUrl: string): Promise<Partial<DiscoveryResult> | undefined> {
  const id = dailymotionId(pageUrl);
  if (!id) return undefined;
  try {
    const metadataUrl = `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(id)}`;
    const response = await fetchPublicText(metadataUrl, { maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS, requireProvider: true, referer: pageUrl });
    const json = JSON.parse(response.text) as Record<string, any>;
    const qualities = json.qualities && typeof json.qualities === "object" ? json.qualities as Record<string, Array<any>> : {};
    const streams = Object.entries(qualities).flatMap(([quality, entries]) => Array.isArray(entries) ? entries.map((entry) => ({ quality, ...entry })) : []);
    const hls = streams.find((entry: any) => typeof entry?.url === "string" && (String(entry?.type).toLowerCase().includes("mpegurl") || entry.url.includes(".m3u8")))?.url as string | undefined;
    const direct = streams
      .filter((entry: any) => typeof entry?.url === "string" && /^https:\/\//.test(entry.url) && String(entry?.type).toLowerCase().startsWith("video/mp4"))
      .sort((a: any, b: any) => Number.parseInt(String(b.quality), 10) - Number.parseInt(String(a.quality), 10))[0]?.url as string | undefined;
    if (hls) {
      const inspected = await inspectHls(hls, pageUrl);
      if (inspected.verified) return {
        playable: true, playUrl: hls, hlsUrl: hls, kind: "hls", detectedBy: "provider_api",
        ...(direct ? { downloadable: true, downloadUrl: direct } : {}),
        ...hlsInfoPatch(inspected.info),
      };
    }
    if (direct) return { playable: true, playUrl: direct, kind: "video", downloadable: true, downloadUrl: direct, detectedBy: "provider_api" };
  } catch {
    return undefined;
  }
  return undefined;
}

function archiveId(value: string) {
  return new URL(value).pathname.match(/^\/(?:details|embed)\/([^/?]+)/)?.[1];
}

function archiveFileUrl(id: string, name: string) {
  const path = name.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://archive.org/download/${encodeURIComponent(id)}/${path}`;
}

async function discoverArchive(pageUrl: string): Promise<Partial<DiscoveryResult> | undefined> {
  const id = archiveId(pageUrl);
  if (!id) return undefined;
  try {
    const metadataUrl = `https://archive.org/metadata/${encodeURIComponent(id)}`;
    const response = await fetchPublicText(metadataUrl, { maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS, requireProvider: true, referer: pageUrl });
    const json = JSON.parse(response.text) as { files?: Array<Record<string, unknown>> };
    const files = Array.isArray(json.files) ? json.files : [];
    const candidates = files.flatMap((file) => {
      const name = typeof file.name === "string" ? file.name : "";
      if (!/\.(?:mp4|m4v|webm)$/i.test(name)) return [];
      const size = Number(file.size ?? 0);
      const source = typeof file.source === "string" ? file.source : "";
      const format = typeof file.format === "string" ? file.format : "";
      return [{ name, size: Number.isFinite(size) ? size : 0, source, format }];
    }).sort((a, b) => (b.source === "original" ? 1 : 0) - (a.source === "original" ? 1 : 0) || b.size - a.size);
    const best = candidates[0];
    if (!best) return undefined;
    const direct = archiveFileUrl(id, best.name);
    return { playable: true, playUrl: direct, kind: "video", downloadable: true, downloadUrl: direct, detectedBy: "provider_api" };
  } catch {
    return undefined;
  }
}

async function providerSpecificDiscovery(pageUrl: string) {
  const host = hostnameOf(pageUrl);
  if (matches(host, "vimeo.com")) return discoverVimeo(pageUrl);
  if (matches(host, "dailymotion.com")) return discoverDailymotion(pageUrl);
  if (matches(host, "archive.org")) return discoverArchive(pageUrl);
  return undefined;
}

export async function discoverPlayableMedia(pageUrl: string): Promise<Partial<DiscoveryResult>> {
  const direct = playableSource(pageUrl);
  const directPatch = directDownloadPatch(direct);
  if (direct.playable && direct.kind === "hls" && direct.hlsUrl) {
    const inspected = await inspectHls(direct.hlsUrl, pageUrl);
    return { ...direct, ...directPatch, ...(inspected.verified ? hlsInfoPatch(inspected.info) : {}) };
  }
  if (direct.playable && direct.kind !== "embed") return { ...direct, ...directPatch };
  if (!isAllowedProviderUrl(pageUrl)) return { ...direct, ...directPatch };

  const specific = await providerSpecificDiscovery(pageUrl);
  if (specific?.playable) return specific;

  const host = hostnameOf(pageUrl);
  const probeUsefulEmbed = direct.kind === "embed" && (matches(host, "vimeo.com") || matches(host, "archive.org") || matches(host, "dailymotion.com"));
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
    const verifiedHls = await Promise.all(extracted.hls.slice(0, 4).map(async (hlsUrl) => ({ hlsUrl, inspected: await inspectHls(hlsUrl, page.url) })));
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
    // Preserve a trusted embed fallback if probing is unavailable.
  }
  return { ...direct, ...directPatch };
}

export async function discoverObservedMedia(candidateUrl: string, originUrl: string): Promise<Partial<DiscoveryResult>> {
  if (!isPlayableProviderUrl(originUrl)) return { playable: false };
  await assertPublicHttpsUrl(candidateUrl);
  const parsed = new URL(candidateUrl);
  const pathname = parsed.pathname.toLowerCase();
  const looksHls = pathname.endsWith(".m3u8") || /(?:m3u8|hls|playlist|manifest)/i.test(`${pathname}${parsed.search}`);
  if (looksHls) {
    const inspected = await inspectHls(candidateUrl, originUrl);
    if (inspected.verified) return {
      playable: true,
      playUrl: candidateUrl,
      hlsUrl: candidateUrl,
      kind: "hls",
      detectedBy: "webview_observed",
      ...hlsInfoPatch(inspected.info),
    };
  }
  if (/\.(?:mp4|webm|m4v|mov|ogv|ogg)$/i.test(pathname)) {
    return { playable: true, playUrl: candidateUrl, kind: "video", downloadable: true, downloadUrl: candidateUrl, detectedBy: "webview_observed" };
  }
  return { playable: false };
}

export async function enrichDiscoveryResults(results: DiscoveryResult[]) {
  return Promise.all(results.map(async (result) => ({ ...result, ...(await discoverPlayableMedia(result.url)) })));
}
