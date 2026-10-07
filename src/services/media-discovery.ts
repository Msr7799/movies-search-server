import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { playableSource } from "../domain/providers.js";
import type { DiscoveryResult } from "../domain/types.js";

const MAX_PAGE_BYTES = 1_100 * 1024;
const MAX_MANIFEST_BYTES = 360 * 1024;
const PAGE_TIMEOUT_MS = 5_000;
const MEDIA_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;
const MAX_CRAWL_DEPTH = 2;
const MAX_CRAWL_PAGES = 10;
const SAFE_FORWARD_HEADERS = new Set([
  "accept",
  "accept-language",
  "origin",
  "referer",
  "range",
  "user-agent",
]);

type ExtractedMedia = {
  hls: string[];
  video: string[];
  audio: string[];
  pages: string[];
  subtitleLanguages: string[];
  subtitleEvidence?: "track" | "page_text";
};
type FetchTextResult = { url: string; contentType: string; text: string };
type HlsInfo = ReturnType<typeof analyzeHlsManifest>;

function privateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return true;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function privateIp(address: string) {
  const version = isIP(address);
  if (version === 4) return privateIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("2001:db8")
  )
    return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

export async function assertPublicWebUrl(value: string) {
  const parsed = new URL(value);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  )
    throw new Error("UNSAFE_MEDIA_URL");
  const hostname = parsed.hostname.toLowerCase();
  if (
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".local")
  )
    throw new Error("UNSAFE_MEDIA_HOST");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => privateIp(address))
  )
    throw new Error("PRIVATE_MEDIA_HOST");
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

function sanitizePlaybackHeaders(input?: Record<string, string>) {
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input ?? {})) {
    const normalized = key.toLowerCase();
    const value = String(raw ?? "").trim();
    if (!SAFE_FORWARD_HEADERS.has(normalized) || !value) continue;
    output[normalized] = value.slice(0, 1000);
  }
  return output;
}

async function fetchPublicText(
  initialUrl: string,
  options: {
    maxBytes: number;
    timeoutMs: number;
    referer?: string;
    headers?: Record<string, string>;
  },
): Promise<FetchTextResult> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicWebUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/json,text/plain,application/vnd.apple.mpegurl,application/x-mpegURL,video/*;q=0.9,audio/*;q=0.8,*/*;q=0.4",
          "User-Agent": "AnyMovieOpenWebProbe/2.1",
          ...sanitizePlaybackHeaders(options.headers),
          ...(options.referer &&
          !sanitizePlaybackHeaders(options.headers).referer
            ? { Referer: options.referer }
            : {}),
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS)
          throw new Error("MEDIA_REDIRECT_FAILED");
        await response.body?.cancel();
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) throw new Error(`MEDIA_HTTP_${response.status}`);
      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        contentType.startsWith("video/") ||
        contentType.startsWith("audio/")
      ) {
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
    .replace(/\\x2f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/");
}

function safeResolvedUrl(value: string, baseUrl: string) {
  try {
    const parsed = new URL(decodeMarkup(value.trim()), baseUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      return undefined;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
}

function normalizeSubtitleLanguage(value: string) {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (
    /^(?:ar|ara|arb)(?:-|$)/.test(normalized) ||
    /arabic|العربية|عربي/.test(normalized)
  )
    return "ar";
  if (/^(?:en|eng)(?:-|$)/.test(normalized) || /english/.test(normalized))
    return "en";
  if (/^(?:tr|tur)(?:-|$)/.test(normalized) || /turkish|türk/.test(normalized))
    return "tr";
  if (
    /^(?:fr|fra|fre)(?:-|$)/.test(normalized) ||
    /french|français/.test(normalized)
  )
    return "fr";
  if (
    /^(?:es|spa)(?:-|$)/.test(normalized) ||
    /spanish|español/.test(normalized)
  )
    return "es";
  if (
    /^(?:de|deu|ger)(?:-|$)/.test(normalized) ||
    /german|deutsch/.test(normalized)
  )
    return "de";
  if (
    /^(?:it|ita)(?:-|$)/.test(normalized) ||
    /italian|italiano/.test(normalized)
  )
    return "it";
  return normalized.split("-")[0]?.slice(0, 8) || undefined;
}

function subtitleHintsFromText(text: string) {
  const languages = new Set<string>();
  if (
    /(?:arabic subtitles?|arabic subbed|ترجمة عربية|مترجم(?:ة)?(?:\s+ب)?العربية|مترجم عربي|مترجم)/i.test(
      text,
    )
  )
    languages.add("ar");
  if (/(?:english subtitles?|eng(?:lish)? subbed)/i.test(text))
    languages.add("en");
  if (/(?:turkish subtitles?|türkçe altyazı)/i.test(text)) languages.add("tr");
  if (/(?:french subtitles?|sous[- ]titres? français)/i.test(text))
    languages.add("fr");
  if (/(?:spanish subtitles?|subtítulos? español)/i.test(text))
    languages.add("es");
  if (/(?:german subtitles?|deutsche untertitel)/i.test(text))
    languages.add("de");
  if (/(?:italian subtitles?|sottotitoli italiani)/i.test(text))
    languages.add("it");
  return [...languages];
}

function mediaKind(value: string) {
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls" as const;
  if (/\.(?:mp4|webm|m4v|mov|ogv|ogg)$/.test(pathname)) return "video" as const;
  if (/\.(?:m4a|mp3|aac|wav|flac|oga)$/.test(pathname)) return "audio" as const;
  return undefined;
}

export function extractMediaCandidates(
  markup: string,
  baseUrl: string,
): ExtractedMedia {
  const text = decodeMarkup(markup);
  const hls = new Set<string>();
  const video = new Set<string>();
  const audio = new Set<string>();
  const pages = new Set<string>();
  const subtitleLanguages = new Set<string>();
  let subtitleEvidence: "track" | "page_text" | undefined;
  const add = (raw: string, forced?: "hls" | "video" | "audio") => {
    const value = safeResolvedUrl(raw, baseUrl);
    if (!value) return;
    const kind = forced ?? mediaKind(value);
    if (kind === "hls") hls.add(value);
    else if (kind === "video") video.add(value);
    else if (kind === "audio") audio.add(value);
  };
  const addPage = (raw: string) => {
    const value = safeResolvedUrl(raw, baseUrl);
    if (value && value !== baseUrl) pages.add(value);
  };

  const quoted =
    /["']([^"'<>\s]+?\.(?:m3u8|mp4|webm|m4v|mov|ogv|ogg|m4a|mp3|aac|wav|flac|oga)(?:\?[^"'<>\s]*)?)["']/gi;
  for (const match of text.matchAll(quoted)) if (match[1]) add(match[1]);

  const absolute =
    /https?:\/\/[^\s'"<>\\]+?\.(?:m3u8|mp4|webm|m4v|mov|ogv|ogg|m4a|mp3|aac|wav|flac|oga)(?:\?[^\s'"<>\\]*)?/gi;
  for (const match of text.matchAll(absolute)) if (match[0]) add(match[0]);

  const namedHls =
    /["'](?:hls(?:manifest)?(?:url)?|hls_manifest_url|hls_url|m3u8(?:url)?|playlist(?:url)?|manifest(?:url)?|master(?:url)?)["']\s*[:=]\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(namedHls))
    if (match[1]) add(match[1], "hls");

  const namedVideo =
    /["'](?:video(?:url)?|progressive(?:url)?|file|src)["']\s*[:=]\s*["']([^"']+\.(?:mp4|webm|m4v|mov|ogv|ogg)(?:\?[^"']*)?)["']/gi;
  for (const match of text.matchAll(namedVideo))
    if (match[1]) add(match[1], "video");

  const namedPage =
    /["'](?:embed(?:url)?|player(?:url)?|iframe(?:url)?|watch(?:url)?|play(?:url)?|server(?:url)?)["']\s*[:=]\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(namedPage)) if (match[1]) addPage(match[1]);

  const jsNavigations =
    /(?:window\.open\s*\(|(?:window\.)?location(?:\.href)?\s*=\s*)["']([^"']+)["']/gi;
  for (const match of text.matchAll(jsNavigations))
    if (match[1]) addPage(match[1]);

  const dataUrls =
    /\bdata-(?:src|url|href|file|video|player|embed|server)=["']([^"']+)["']/gi;
  for (const match of text.matchAll(dataUrls)) {
    if (!match[1]) continue;
    const resolved = safeResolvedUrl(match[1], baseUrl);
    if (!resolved) continue;
    const kind = mediaKind(resolved);
    if (kind) add(resolved, kind);
    else addPage(resolved);
  }

  const sourceTags = /<(?:source|video|audio)\b[^>]*>/gi;
  for (const tagMatch of text.matchAll(sourceTags)) {
    const tag = tagMatch[0];
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    if (
      /type=["'](?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl)["']/i.test(
        tag,
      )
    )
      add(src, "hls");
    else add(src);
  }

  const metaTags = /<meta\b[^>]*>/gi;
  for (const tagMatch of text.matchAll(metaTags)) {
    const tag = tagMatch[0];
    if (!/(?:og:video(?::url)?|twitter:player:stream)/i.test(tag)) continue;
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) add(content);
  }

  const trackTags = /<track\b[^>]*>/gi;
  for (const tagMatch of text.matchAll(trackTags)) {
    const tag = tagMatch[0];
    if (!/(?:kind=["'](?:subtitles|captions)["']|srclang=)/i.test(tag))
      continue;
    const languageRaw =
      tag.match(/(?:srclang|lang)=["']([^"']+)["']/i)?.[1] ??
      tag.match(/label=["']([^"']+)["']/i)?.[1];
    const language = languageRaw
      ? normalizeSubtitleLanguage(languageRaw)
      : undefined;
    if (language) subtitleLanguages.add(language);
    subtitleEvidence = "track";
  }

  if (subtitleLanguages.size === 0) {
    for (const language of subtitleHintsFromText(text))
      subtitleLanguages.add(language);
    if (subtitleLanguages.size > 0) subtitleEvidence = "page_text";
  }

  const iframes = /<iframe\b[^>]*\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  for (const match of text.matchAll(iframes)) if (match[1]) addPage(match[1]);

  const anchors = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  for (const match of text.matchAll(anchors)) {
    const href = match[1];
    if (href && /(?:watch|player|embed|stream|video|play|server)/i.test(href))
      addPage(href);
  }

  const forms = /<form\b[^>]*\baction=["']([^"']+)["'][^>]*>/gi;
  for (const match of text.matchAll(forms)) {
    const action = match[1];
    if (
      action &&
      /(?:watch|player|embed|stream|video|play|server)/i.test(action)
    )
      addPage(action);
  }

  return {
    hls: [...hls].slice(0, 24),
    video: [...video].slice(0, 20),
    audio: [...audio].slice(0, 8),
    pages: [...pages].slice(0, 20),
    subtitleLanguages: [...subtitleLanguages],
    ...(subtitleEvidence ? { subtitleEvidence } : {}),
  };
}

function parseHlsAttributes(line: string) {
  const payload = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
  const attrs: Record<string, string> = {};
  let token = "";
  let quoted = false;
  const parts: string[] = [];
  for (const char of payload) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(token);
      token = "";
    } else token += char;
  }
  if (token) parts.push(token);
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim().toUpperCase();
    const value = part
      .slice(index + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (key) attrs[key] = value;
  }
  return attrs;
}

export function analyzeHlsManifest(text: string, manifestUrl?: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const valid = lines[0]?.startsWith("#EXTM3U") === true;
  const variants: Array<{
    url?: string;
    bandwidth?: number;
    resolution?: string;
    width?: number;
    height?: number;
    codecs?: string;
  }> = [];
  const subtitleLanguages = new Set<string>();
  let audioRenditions = 0;
  let subtitleRenditions = 0;
  let encrypted = false;
  let drmProtected = false;
  let durationSeconds = 0;
  let mediaPlaylist = false;
  let endList = false;

  if (valid) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line === "#EXT-X-ENDLIST") endList = true;
      if (line.startsWith("#EXTINF:")) {
        mediaPlaylist = true;
        const duration = Number.parseFloat(
          line.slice("#EXTINF:".length).split(",", 1)[0] ?? "",
        );
        if (Number.isFinite(duration)) durationSeconds += duration;
      }
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const attrs = parseHlsAttributes(line);
        let uri: string | undefined;
        for (let next = index + 1; next < lines.length; next += 1) {
          const candidate = lines[next]!;
          if (!candidate.startsWith("#")) {
            uri = candidate;
            break;
          }
        }
        const resolution = attrs.RESOLUTION;
        const match = resolution?.match(/^(\d+)x(\d+)$/i);
        const bandwidth = Number.parseInt(attrs.BANDWIDTH ?? "", 10);
        const resolvedUrl =
          uri && manifestUrl ? safeResolvedUrl(uri, manifestUrl) : uri;
        variants.push({
          ...(resolvedUrl ? { url: resolvedUrl } : {}),
          ...(Number.isFinite(bandwidth) && bandwidth > 0 ? { bandwidth } : {}),
          ...(resolution ? { resolution } : {}),
          ...(match
            ? { width: Number(match[1]), height: Number(match[2]) }
            : {}),
          ...(attrs.CODECS ? { codecs: attrs.CODECS } : {}),
        });
      }
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attrs = parseHlsAttributes(line);
        const type = (attrs.TYPE ?? "").toUpperCase();
        if (type === "AUDIO") audioRenditions += 1;
        if (type === "SUBTITLES") {
          subtitleRenditions += 1;
          const raw = attrs.LANGUAGE ?? attrs.NAME;
          const language = raw ? normalizeSubtitleLanguage(raw) : undefined;
          if (language) subtitleLanguages.add(language);
        }
      }
      if (
        line.startsWith("#EXT-X-KEY:") ||
        line.startsWith("#EXT-X-SESSION-KEY:")
      ) {
        const attrs = parseHlsAttributes(line);
        const method = (attrs.METHOD ?? "").toUpperCase();
        const keyFormat = (attrs.KEYFORMAT ?? "identity").trim().toLowerCase();
        if (method && method !== "NONE") encrypted = true;
        if (
          method.startsWith("SAMPLE-AES") ||
          !["", "identity"].includes(keyFormat)
        )
          drmProtected = true;
      }
    }
  }

  const firstVariantUri = variants.find((item) => item.url)?.url;
  return {
    valid,
    master: valid && variants.length > 0,
    variantCount: variants.length,
    variants,
    audioRenditionCount: audioRenditions,
    subtitleRenditionCount: subtitleRenditions,
    subtitleLanguages: [...subtitleLanguages],
    ...(firstVariantUri ? { firstVariantUri } : {}),
    ...(mediaPlaylist ? { live: !endList } : {}),
    ...(durationSeconds > 0
      ? { durationSeconds: Math.round(durationSeconds) }
      : {}),
    encrypted,
    drmProtected,
  };
}

async function inspectHls(
  url: string,
  referer?: string,
  requestHeaders?: Record<string, string>,
) {
  try {
    const playbackHeaders = sanitizePlaybackHeaders({
      ...(requestHeaders ?? {}),
      ...(referer ? { referer } : {}),
    });
    const response = await fetchPublicText(url, {
      maxBytes: MAX_MANIFEST_BYTES,
      timeoutMs: MEDIA_TIMEOUT_MS,
      ...(referer ? { referer } : {}),
      headers: playbackHeaders,
    });
    let info = analyzeHlsManifest(response.text, response.url);
    const verified = info.valid || response.contentType.includes("mpegurl");

    // Master playlists usually do not contain EXTINF durations. Inspect one child
    // playlist so the full-movie filter can distinguish a feature from a short clip.
    if (verified && info.master && info.firstVariantUri) {
      const childUrl = safeResolvedUrl(info.firstVariantUri, response.url);
      if (childUrl) {
        try {
          const childReferer = playbackHeaders.referer || response.url;
          const childHeaders = sanitizePlaybackHeaders({
            ...playbackHeaders,
            referer: childReferer,
          });
          const child = await fetchPublicText(childUrl, {
            maxBytes: MAX_MANIFEST_BYTES,
            timeoutMs: MEDIA_TIMEOUT_MS,
            referer: childReferer,
            headers: childHeaders,
          });
          const childInfo = analyzeHlsManifest(child.text, child.url);
          if (childInfo.valid) {
            info = {
              ...info,
              ...(childInfo.live === undefined ? {} : { live: childInfo.live }),
              ...(childInfo.durationSeconds === undefined
                ? {}
                : { durationSeconds: childInfo.durationSeconds }),
              encrypted: info.encrypted || childInfo.encrypted,
              drmProtected: info.drmProtected || childInfo.drmProtected,
            };
          }
        } catch {
          // A verified master playlist is still playable even if one variant probe fails.
        }
      }
    }
    return { verified, url: response.url, info, playbackHeaders };
  } catch {
    return {
      verified: false,
      url,
      info: analyzeHlsManifest(""),
      playbackHeaders: sanitizePlaybackHeaders({
        ...(requestHeaders ?? {}),
        ...(referer ? { referer } : {}),
      }),
    };
  }
}

async function inspectVideo(
  url: string,
  referer?: string,
  requestHeaders?: Record<string, string>,
) {
  try {
    const playbackHeaders = sanitizePlaybackHeaders({
      ...(requestHeaders ?? {}),
      ...(referer ? { referer } : {}),
    });
    const response = await fetchPublicText(url, {
      maxBytes: 32 * 1024,
      timeoutMs: MEDIA_TIMEOUT_MS,
      ...(referer ? { referer } : {}),
      headers: playbackHeaders,
    });
    return {
      verified: response.contentType.startsWith("video/"),
      url: response.url,
      playbackHeaders,
    };
  } catch {
    return {
      verified: false,
      url,
      playbackHeaders: sanitizePlaybackHeaders({
        ...(requestHeaders ?? {}),
        ...(referer ? { referer } : {}),
      }),
    };
  }
}

function hlsInfoPatch(info: HlsInfo): Partial<DiscoveryResult> {
  return {
    hlsMaster: info.master,
    hlsVariantCount: info.variantCount,
    hlsAudioRenditionCount: info.audioRenditionCount,
    hlsSubtitleRenditionCount: info.subtitleRenditionCount,
    ...(info.subtitleLanguages.length > 0
      ? {
          subtitleLanguages: info.subtitleLanguages,
          subtitleEvidence: "manifest" as const,
        }
      : {}),
    ...(info.live === undefined ? {} : { hlsLive: info.live }),
    ...(info.durationSeconds === undefined
      ? {}
      : { hlsDurationSeconds: info.durationSeconds }),
    hlsEncrypted: info.encrypted,
    hlsDrmProtected: info.drmProtected,
    ...(info.variants.length > 0 ? { hlsVariants: info.variants } : {}),
  };
}

function directPatch(source: ReturnType<typeof playableSource>) {
  if (source.playable && source.kind === "video" && source.playUrl) {
    return {
      downloadable: true,
      downloadUrl: source.playUrl,
      detectedBy: "direct_url" as const,
    };
  }
  if (source.playable) return { detectedBy: "direct_url" as const };
  return {};
}

function pageSubtitlePatch(
  extracted: ExtractedMedia,
): Partial<DiscoveryResult> {
  if (extracted.subtitleLanguages.length === 0) return {};
  return {
    subtitleLanguages: extracted.subtitleLanguages,
    ...(extracted.subtitleEvidence
      ? { subtitleEvidence: extracted.subtitleEvidence }
      : {}),
  };
}

function mergeSubtitleMetadata(
  primary: Partial<DiscoveryResult>,
  fallback: Partial<DiscoveryResult>,
): Partial<DiscoveryResult> {
  const languages = [
    ...new Set([
      ...(primary.subtitleLanguages ?? []),
      ...(fallback.subtitleLanguages ?? []),
    ]),
  ];
  const evidence = primary.subtitleEvidence ?? fallback.subtitleEvidence;
  return {
    ...fallback,
    ...primary,
    ...(languages.length > 0 ? { subtitleLanguages: languages } : {}),
    ...(evidence ? { subtitleEvidence: evidence } : {}),
  };
}

async function discoverPage(
  pageUrl: string,
  state: { visited: Set<string>; pages: number },
  depth: number,
  referer?: string,
): Promise<Partial<DiscoveryResult>> {
  if (
    depth > MAX_CRAWL_DEPTH ||
    state.pages >= MAX_CRAWL_PAGES ||
    state.visited.has(pageUrl)
  )
    return { playable: false };
  state.visited.add(pageUrl);
  state.pages += 1;

  const direct = playableSource(pageUrl);
  if (direct.playable && direct.kind === "hls" && direct.hlsUrl) {
    const inspected = await inspectHls(direct.hlsUrl, referer ?? pageUrl);
    if (inspected.verified)
      return {
        ...direct,
        playUrl: inspected.url,
        hlsUrl: inspected.url,
        ...directPatch(direct),
        ...hlsInfoPatch(inspected.info),
        ...(Object.keys(inspected.playbackHeaders).length > 0
          ? { playbackHeaders: inspected.playbackHeaders }
          : {}),
      };
  }
  if (direct.playable && direct.kind === "video" && direct.playUrl) {
    const inspected = await inspectVideo(direct.playUrl, referer);
    if (inspected.verified)
      return {
        ...direct,
        playUrl: inspected.url,
        downloadUrl: inspected.url,
        ...directPatch(direct),
        ...(Object.keys(inspected.playbackHeaders).length > 0
          ? { playbackHeaders: inspected.playbackHeaders }
          : {}),
      };
  }

  try {
    const page = await fetchPublicText(pageUrl, {
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: PAGE_TIMEOUT_MS,
      ...(referer ? { referer } : {}),
    });
    if (
      page.contentType.includes("mpegurl") ||
      page.text.trimStart().startsWith("#EXTM3U")
    ) {
      const info = analyzeHlsManifest(page.text, page.url);
      return {
        playable: true,
        playUrl: page.url,
        hlsUrl: page.url,
        kind: "hls",
        detectedBy: "content_type",
        ...hlsInfoPatch(info),
      };
    }
    if (page.contentType.startsWith("video/")) {
      return {
        playable: true,
        playUrl: page.url,
        kind: "video",
        downloadable: true,
        downloadUrl: page.url,
        detectedBy: "content_type",
      };
    }

    const extracted = extractMediaCandidates(page.text, page.url);
    const pageSubtitles = pageSubtitlePatch(extracted);
    const hlsChecks = await Promise.all(
      extracted.hls
        .slice(0, 10)
        .map(async (hlsUrl) => inspectHls(hlsUrl, page.url)),
    );
    const hls = hlsChecks.find((item) => item.verified);
    if (hls)
      return mergeSubtitleMetadata(
        {
          playable: true,
          playUrl: hls.url,
          hlsUrl: hls.url,
          kind: "hls",
          detectedBy: "html_manifest",
          ...hlsInfoPatch(hls.info),
          ...(Object.keys(hls.playbackHeaders).length > 0
            ? { playbackHeaders: hls.playbackHeaders }
            : {}),
        },
        pageSubtitles,
      );

    const videoChecks = await Promise.all(
      extracted.video
        .slice(0, 8)
        .map(async (videoUrl) => inspectVideo(videoUrl, page.url)),
    );
    const video = videoChecks.find((item) => item.verified);
    if (video)
      return {
        playable: true,
        playUrl: video.url,
        kind: "video",
        downloadable: true,
        downloadUrl: video.url,
        detectedBy: "html_media",
        ...pageSubtitles,
        ...(Object.keys(video.playbackHeaders).length > 0
          ? { playbackHeaders: video.playbackHeaders }
          : {}),
      };

    const nestedResults = await Promise.all(
      extracted.pages
        .slice(0, 6)
        .map((nested) => discoverPage(nested, state, depth + 1, page.url)),
    );
    const nestedPlayable = nestedResults.find((item) => item.playable);
    if (nestedPlayable)
      return mergeSubtitleMetadata(nestedPlayable, pageSubtitles);
  } catch {
    return { playable: false };
  }
  return { playable: false };
}

export async function discoverPlayableMedia(
  pageUrl: string,
): Promise<Partial<DiscoveryResult>> {
  await assertPublicWebUrl(pageUrl);
  return discoverPage(pageUrl, { visited: new Set<string>(), pages: 0 }, 0);
}

export async function discoverObservedMedia(
  candidateUrl: string,
  originUrl: string,
  requestHeaders: Record<string, string> = {},
): Promise<Partial<DiscoveryResult>> {
  await assertPublicWebUrl(originUrl);
  await assertPublicWebUrl(candidateUrl);
  const parsed = new URL(candidateUrl);
  const pathname = parsed.pathname.toLowerCase();
  const safeHeaders = sanitizePlaybackHeaders(requestHeaders);
  const referer = safeHeaders.referer || originUrl;
  const looksHls =
    pathname.endsWith(".m3u8") ||
    /(?:m3u8|hls|playlist|manifest)/i.test(`${pathname}${parsed.search}`);
  if (looksHls) {
    const inspected = await inspectHls(candidateUrl, referer, safeHeaders);
    if (inspected.verified)
      return {
        playable: true,
        playUrl: inspected.url,
        hlsUrl: inspected.url,
        kind: "hls",
        detectedBy: "webview_observed",
        ...hlsInfoPatch(inspected.info),
        ...(Object.keys(inspected.playbackHeaders).length > 0
          ? { playbackHeaders: inspected.playbackHeaders }
          : {}),
      };
  }
  if (/\.(?:mp4|webm|m4v|mov|ogv|ogg)$/i.test(pathname)) {
    const inspected = await inspectVideo(candidateUrl, referer, safeHeaders);
    if (inspected.verified)
      return {
        playable: true,
        playUrl: inspected.url,
        kind: "video",
        downloadable: true,
        downloadUrl: inspected.url,
        detectedBy: "webview_observed",
        ...(Object.keys(inspected.playbackHeaders).length > 0
          ? { playbackHeaders: inspected.playbackHeaders }
          : {}),
      };
  }
  return { playable: false };
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        output[index] = await worker(values[index]!);
      }
    },
  );
  await Promise.all(runners);
  return output;
}

export async function enrichDiscoveryResults(results: DiscoveryResult[]) {
  return mapLimit(results, 8, async (result) => {
    try {
      return { ...result, ...(await discoverPlayableMedia(result.url)) };
    } catch {
      return { ...result, playable: false };
    }
  });
}
