/** Clips on the thirty-pieces screen stay short enough to preview one at a time. */
export const MAX_VIDEO_SECONDS = 6;

export function videoLengthError(name: string, seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return `${name}: Could not read the length of this video. Trim it to 6 seconds or less and try again.`;
  }
  if (seconds > MAX_VIDEO_SECONDS + 0.05) {
    const rounded = Math.round(seconds * 10) / 10;
    const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${name} is ${shown} seconds. Clips can be up to 6 seconds. Trim it and try again.`;
  }
  return null;
}
