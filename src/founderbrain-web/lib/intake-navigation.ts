/**
 * Deterministic navigation helpers for OrientationFlow's cursor: pure so the
 * routing math is testable without mounting the component or touching
 * sessionStorage.
 */
import type { Brain } from "../types";
import { GUIDE_STEPS, nextGuideStep, readStepValue } from "../guide-intake";

/** The full screen order: name, ready, site-ask, (site-url), then every guide step. */
export function guideSequence(includeUrl: boolean): string[] {
  const items = ["name", "ready", "site-ask"];
  if (includeUrl) items.push("site-url");
  for (const step of GUIDE_STEPS) items.push(`g:${step.id}`);
  items.push("complete");
  return items;
}

/**
 * Parse a stored cursor string. `Number("")` is `0`, not `NaN`, so an absent
 * or blank stored value must be treated as "no cursor" explicitly rather than
 * falling through `Number.isFinite` -- otherwise every fresh session (no
 * stored cursor) silently starts at index 0 instead of the welcome/name flow.
 */
export function parseStoredCursor(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * Resolve the cursor to open the orientation flow at. Only meant to be called
 * once, on mount (e.g. inside a `useState` initializer): it resumes saved
 * progress at the first missing *required* guide step, skipping already
 * filled steps, but must never fight an explicit Back/Continue click made
 * afterwards (those go through `moveTo`, not this function).
 */
export function resolveInitialCursor(params: {
  storedCursorRaw: string;
  welcomeDone: boolean;
  yesAccepted: boolean;
  screen: number;
  includeUrl: boolean;
  brain: Brain;
  track: string | null;
}): number {
  const { storedCursorRaw, welcomeDone, yesAccepted, screen, includeUrl, brain, track } = params;

  const stored = parseStoredCursor(storedCursorRaw);
  if (stored !== null) return stored;

  const seq = guideSequence(includeUrl);

  const hasSavedAnswers = GUIDE_STEPS.some((step) => step.id !== "stage" && Boolean(readStepValue(brain, track, step).trim()));
  if (welcomeDone || yesAccepted || hasSavedAnswers) {
    const missing = nextGuideStep(brain, track);
    if (missing) {
      const idx = seq.indexOf(`g:${missing.id}`);
      if (idx >= 0) return idx;
    }
    // Every required step is already answered (e.g. resumed on a new device,
    // or a workspace switch reset the scoped cursor key): land at the end
    // instead of replaying answered steps.
    return Math.max(seq.length - 1, 0);
  }

  return screen <= 1 ? 0 : 1;
}
