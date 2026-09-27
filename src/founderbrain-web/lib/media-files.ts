/**
 * Pure helper for the Files screen: splits Danny's media list (content photos,
 * videos, and Higgsfield generations) into the two read-only groups shown
 * there. Only "ready" media is shown -- pending/failed items stay in the
 * content library where they can be managed.
 */
import type { MediaItem } from "../types";

export type MediaFilesSplit = {
  /** Founder-uploaded photos/videos -- listed under "Uploaded by you". */
  uploaded: MediaItem[];
  /** Higgsfield-generated photos/videos -- listed under "Created by FounderBrain". */
  created: MediaItem[];
};

export function splitMediaForFiles(items: MediaItem[]): MediaFilesSplit {
  const ready = items.filter((item) => item.status === "ready");
  return {
    uploaded: ready.filter((item) => item.source === "upload"),
    created: ready.filter((item) => item.source === "higgsfield"),
  };
}
