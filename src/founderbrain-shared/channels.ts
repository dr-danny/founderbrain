/**
 * Channels a founder can select for the 30 pieces.
 * Generation may use only these names. It must not default to LinkedIn or Instagram.
 */
export const CONTENT_CHANNELS = [
  "Instagram",
  "Facebook",
  "LinkedIn",
  "Reddit",
  "TikTok",
  "YouTube",
  "Threads",
] as const;

export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

const ALIASES: Record<string, ContentChannel> = {
  instagram: "Instagram",
  ig: "Instagram",
  facebook: "Facebook",
  fb: "Facebook",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  tiktok: "TikTok",
  "tik tok": "TikTok",
  youtube: "YouTube",
  threads: "Threads",
};

const FORMATS: Record<ContentChannel, string> = {
  Instagram: "Caption, Carousel, or Video script",
  Facebook: "Post or Caption",
  LinkedIn: "Short post, Long post, or Soft ask",
  Reddit: "Post",
  TikTok: "Video script",
  YouTube: "Video script or Description",
  Threads: "Short post",
};

export function parseContentChannels(value: string | undefined): ContentChannel[] {
  const found: ContentChannel[] = [];
  for (const part of (value ?? "").split(/[\n,;/]+/)) {
    const key = part.trim().toLowerCase().replace(/^@/, "");
    const channel = ALIASES[key];
    if (channel && !found.includes(channel)) found.push(channel);
  }
  return found;
}

export function formatContentChannels(channels: readonly string[]): string {
  return parseContentChannels(channels.join("\n")).join("\n");
}

export function toggleContentChannel(current: string | undefined, channel: ContentChannel): string {
  const selected = parseContentChannels(current);
  const next = selected.includes(channel)
    ? selected.filter((item) => item !== channel)
    : [...selected, channel];
  return CONTENT_CHANNELS.filter((item) => next.includes(item)).join("\n");
}

/** Server-built instruction. The model must not add a platform outside this list. */
export function channelGenerationRules(channels: readonly ContentChannel[]): string {
  if (!channels.length) {
    return "No channels are selected. Do not write posts, and do not default to LinkedIn or Instagram.";
  }
  const list = channels.join(", ");
  const formats = channels.map((channel) => `${channel}: ${FORMATS[channel]}`).join(". ");
  return (
    `Selected channels, and only these: ${list}. ` +
    `Every piece header Platform must be exactly one of: ${list}. ` +
    `Do not use any other platform. Do not default to LinkedIn or Instagram. ` +
    `Spread the pieces across only the selected channels. If one channel is selected, every piece is for that channel. ` +
    `Formats for the selected channels only: ${formats}. `
  );
}
