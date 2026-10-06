import { describe, expect, it } from "vitest";
import { analyzeHlsManifest, extractMediaCandidates } from "../src/services/media-discovery.js";

describe("media discovery parser", () => {
  it("extracts HLS and direct video URLs from HTML/JSON", () => {
    const found = extractMediaCandidates(`
      <script>{"hlsManifestUrl":"https:\\/\\/cdn.example.com\\/master.m3u8?token=abc\\u0026v=1"}</script>
      <video src="/media/movie.mp4"></video>
    `, "https://video.example.org/watch/123");
    expect(found.hls).toContain("https://cdn.example.com/master.m3u8?token=abc&v=1");
    expect(found.video).toContain("https://video.example.org/media/movie.mp4");
  });


  it("extracts named HLS URLs even without an m3u8 suffix", () => {
    const found = extractMediaCandidates(`<script>{"hlsManifestUrl":"https://cdn.example.com/manifest?id=42"}</script>`, "https://video.example.org/watch");
    expect(found.hls).toContain("https://cdn.example.com/manifest?id=42");
  });

  it("extracts typed HLS source tags regardless of attribute order", () => {
    const found = extractMediaCandidates(`<source src="/manifest?id=7" type="application/vnd.apple.mpegurl">`, "https://video.example.org/watch");
    expect(found.hls).toContain("https://video.example.org/manifest?id=7");
  });

  it("rejects non-HTTPS media candidates", () => {
    const found = extractMediaCandidates(`<source src="http://cdn.example.com/movie.mp4">`, "https://video.example.org/watch");
    expect(found.video).toEqual([]);
  });
  it("classifies HLS master and media playlists", () => {
    expect(analyzeHlsManifest("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",URI=\"audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO=\"audio\"\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000,AUDIO=\"audio\"\n1080.m3u8")).toMatchObject({ valid: true, master: true, variantCount: 2, audioRenditionCount: 1, encrypted: false });
    expect(analyzeHlsManifest("#EXTM3U\n#EXTINF:6,\na.ts\n#EXTINF:4.5,\nb.ts\n#EXT-X-ENDLIST")).toMatchObject({ valid: true, master: false, variantCount: 0, durationSeconds: 11, live: false });
    expect(analyzeHlsManifest("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:6,\na.ts")).toMatchObject({ valid: true, live: true, encrypted: true });
  });
});
