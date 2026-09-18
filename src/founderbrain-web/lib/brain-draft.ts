import type { Brain, BrainState, MissionSection } from "../types";

export const PENDING_JOB_STORAGE_KEY = "founderbrain.pending-job";

export type SaveOperation = { brain: Brain; expectedVersion: number; key: string };

/** Apply a field patch; clears section approval unless the field is `approved`. */
export function patchBrain(
  current: Brain,
  section: MissionSection,
  field: string,
  value: string | boolean,
): Brain {
  return {
    ...current,
    [section]: {
      ...current[section],
      [field]: value,
      approved: field === "approved" ? Boolean(value) : false,
    },
  } as Brain;
}

/**
 * Decide how to present a successful save relative to the latest draft.
 * Pure: no React. Returns notices and whether the draft should be considered clean.
 */
export function settleSaveDecision(
  latestDraft: Brain,
  saved: BrainState,
  operation: SaveOperation,
  _pendingVerification = false,
): { notice: string; draftMatchesSaved: boolean; nextDraft: Brain; changed: boolean } {
  const draftMatchesSaved = JSON.stringify(latestDraft) === JSON.stringify(operation.brain);
  if (draftMatchesSaved) {
    return {
      notice: "Saved.",
      draftMatchesSaved: true,
      nextDraft: saved.brain,
      changed: false,
    };
  }
  return {
    notice: "Saved. Keep editing to save the rest.",
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
