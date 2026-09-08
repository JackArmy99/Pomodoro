import { YoutubeTranscript } from "youtube-transcript";

// Pull a YouTube video's caption track (if it has one) plus its title.
// Returns null when there are no captions — the caller then knows it needs the
// audio/ASR path instead.
export async function getYouTubeTranscript(
  url: string,
): Promise<{ title: string; text: string } | null> {
  let text = "";
  try {
    const segments = await YoutubeTranscript.fetchTranscript(url);
    text = segments
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return null; // no captions / unavailable
  }
  if (!text) return null;

  // Title via the public oEmbed endpoint (no API key needed).
  let title = "YouTube video";
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (res.ok) {
      const json = (await res.json()) as { title?: string };
      if (json.title) title = json.title;
    }
  } catch {
    // keep the default title
  }

  return { title, text };
}
