export const MOVIE_LANGUAGES = {
  any: "any country or language",
  ar: "Arabic-language cinema",
  en: "English-language cinema",
  hi: "Indian cinema, especially Hindi and Bollywood",
  tr: "Turkish-language cinema",
  ko: "Korean-language cinema",
  ja: "Japanese-language cinema",
  fr: "French-language cinema",
  es: "Spanish-language cinema",
  world: "world cinema outside common English-language results",
} as const;

export const SUBTITLE_LANGUAGES = {
  any: "no subtitle-language requirement",
  ar: "Arabic subtitles",
  en: "English subtitles",
  tr: "Turkish subtitles",
  fr: "French subtitles",
  es: "Spanish subtitles",
  de: "German subtitles",
  it: "Italian subtitles",
} as const;

export type MovieLanguage = keyof typeof MOVIE_LANGUAGES;
export type SubtitleLanguage = keyof typeof SUBTITLE_LANGUAGES;
