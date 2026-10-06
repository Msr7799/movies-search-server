export type ContentType = "full_movie" | "availability_page" | "short_clip";

export type DiscoveryResult = {
  id: string;
  title: string;
  provider: string;
  url: string;
  description: string;
  reason: string;
  contentType: ContentType;
  playable: boolean;
  playUrl?: string;
  hlsUrl?: string;
  kind?: "video" | "hls" | "embed";
  downloadable?: boolean;
  downloadUrl?: string;
  detectedBy?: "direct_url" | "content_type" | "html_manifest" | "html_media" | "provider_api" | "webview_observed";
  hlsMaster?: boolean;
  hlsVariantCount?: number;
  hlsAudioRenditionCount?: number;
  hlsSubtitleRenditionCount?: number;
  subtitleLanguages?: string[];
  subtitleEvidence?: "manifest" | "track" | "page_text";
  hlsDurationSeconds?: number;
  hlsLive?: boolean;
  hlsEncrypted?: boolean;
  providerPriority: number;
  confidence: number;
};

export type DiscoveryResponse = {
  understoodTitle: string;
  originalTitle?: string;
  year?: string;
  summary: string;
  results: DiscoveryResult[];
  meta: {
    requestId: string;
    cached: boolean;
    partial: boolean;
    searchedAt: string;
  };
};

export type Suggestion = {
  title: string;
  originalTitle: string;
  year: string;
};

export type SuggestionResponse = {
  suggestions: Suggestion[];
  meta: { requestId: string; cached: boolean };
};

export type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

export type Candidate = {
  id: string;
  title: string;
  url: string;
  content: string;
  tavilyScore: number;
  heuristicScore: number;
  playable: boolean;
  inferredKind: ContentType;
  providerPriority: number;
};
