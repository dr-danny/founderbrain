import type { Brain, BrainState, MissionSection } from "../types";

export const PENDING_JOB_STORAGE_KEY = "founderbrain.pending-job";

export type SaveOperation = { brain: Brain; expectedVersion: number; key: string };

/**
 * Apply a field patch; clears section approval unless the field is `approved`.
 *
 * No-op guard (Danny fix, unchanged counts resetting approval): if `value` is
 * identical to what is already on the section, return `current` unchanged. A
 * plain re-send of the same value (e.g. the sample-count refresh firing again
 * with the same number, or a track re-render with the same track) must never
 * clear approval or reopen the track-fork sections below.
 */
export function patchBrain(
  current: Brain,
  section: MissionSection,
  field: string,
  value: string | boolean | number,
): Brain {
  const currentSection = current[section] as Record<string, unknown>;
  if (currentSection[field] === value) {
    return current;
  }
  const next = {
    ...current,
    [section]: {
      ...current[section],
      [field]: value,
      approved: field === "approved" ? Boolean(value) : false,
    },
  } as Brain;
  // Track fork: changing it reopens everything that forks on the track,
  // exactly as the original intake re-asks audience and channels. Only
  // fires when the track actually changed (see the no-op guard above), so
  // re-patching with the same track no longer clears customer/context.
  if (section === "identity" && field === "track") {
    next.customer = { ...next.customer, approved: false };
    next.context = { ...next.context, approved: false };
  }
  return next;
}

/**
 * Decide how to present a successful save relative to the latest draft.
 * Pure: no React. Returns notices and whether the draft should be considered clean.
 */
export function settleSaveDecision(
  latestDraft: Brain,
  saved: BrainState,
  operation: SaveOperation,
  pendingVerification = false,
): { notice: string; draftMatchesSaved: boolean; nextDraft: Brain; changed: boolean } {
  const draftMatchesSaved = JSON.stringify(latestDraft) === JSON.stringify(operation.brain);
  if (draftMatchesSaved) {
    return {
      notice: pendingVerification
        ? `Saved as version ${saved.version}; server verification is pending.`
        : `Saved as version ${saved.version}.`,
      draftMatchesSaved: true,
      nextDraft: saved.brain,
      changed: false,
    };
  }
  return {
    notice: `Saved as version ${saved.version}. New local edits remain unsaved.`,
    draftMatchesSaved: false,
    nextDraft: latestDraft,
    changed: true,
  };
}

/** Reuse the pending save key when the payload and expected version match; else mint a new key. */
export function nextSaveOperation(
  existing: SaveOperation | null,
  next: Brain,
  expectedVersion: number,
  newKey: () => string,
): SaveOperation {
  if (
    existing &&
    JSON.stringify(existing.brain) === JSON.stringify(next) &&
    existing.expectedVersion === expectedVersion
  ) {
    return existing;
  }
  return { brain: structuredClone(next), expectedVersion, key: newKey() };
}

export function brainsEqual(a: Brain, b: Brain): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
