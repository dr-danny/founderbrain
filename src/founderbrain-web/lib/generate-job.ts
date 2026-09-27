/**
 * Pure orchestration for `generate()`'s pre-flight: which channels to build
 * for, and which Brain version the job should be started against.
 *
 * Extracted out of the React hook so the ordering (channels come from the
 * live draft; the draft is saved and awaited before a job version is
 * chosen; a save failure or a conflicting edit blocks the job instead of
 * silently generating against a stale/superseded selection) can be unit
 * tested without a component-rendering harness.
 */
import { parseContentChannels } from "../../founderbrain-shared/channels.ts";
import { brainsEqual } from "./brain-draft.ts";
import type { Brain, BrainState } from "../types";

export type GenerateJobPlan =
  | { kind: "no_channels" }
  | { kind: "save_failed" }
  | { kind: "superseded" }
  | { kind: "ready"; state: BrainState };

export type GenerateJobDeps = {
  /** Reads the live draft. Called twice: before saving, and again after the
   * save resolves, to detect edits that landed while the save was in flight. */
  getDraft: () => Brain;
  /** The last-saved snapshot known to the caller. */
  state: BrainState;
  /** The app's existing save() path: persists a brain, resolves the
   * conflict/error UI itself, and returns the new saved state, or
   * `undefined` if the save did not go through (conflict, in-flight
   * duplicate, or unresolved error). */
  save: (brain: Brain) => Promise<BrainState | undefined>;
};

export async function prepareGenerateJob(deps: GenerateJobDeps): Promise<GenerateJobPlan> {
  const { getDraft, state, save } = deps;
  const draftBeforeSave = getDraft();
  if (!parseContentChannels(draftBeforeSave.context.contentChannels).length) {
    return { kind: "no_channels" };
  }
  if (brainsEqual(draftBeforeSave, state.brain)) {
    // Already saved; no need to write again just to start a job.
    return { kind: "ready", state };
  }
  const saved = await save(draftBeforeSave);
  if (!saved) {
    return { kind: "save_failed" };
  }
  const draftAfterSave = getDraft();
  if (!brainsEqual(draftAfterSave, draftBeforeSave)) {
    // The founder kept editing while the save was in flight (e.g. changed
    // the channel selection again). The version just saved does not include
    // those newer edits, so do not start a job against it silently.
    return { kind: "superseded" };
  }
  return { kind: "ready", state: saved };
}

/** A plain `{ current }` cell, structurally the same shape as a React ref,
 * so the duplicate-call guard below can be tested without React. */
export type LockRef = { current: boolean };

export type LockOutcome<T> = { kind: "ran"; result: T } | { kind: "already_running" };

/**
 * Guards against overlapping calls to a click handler across renders.
 * React state (e.g. a `generating` boolean) only reflects a new value after
 * a re-render, so two calls fired before that re-render would both see the
 * old value. A plain ref cell is mutated synchronously, so the second call
 * sees the lock immediately.
 */
export async function runExclusive<T>(lock: LockRef, fn: () => Promise<T>): Promise<LockOutcome<T>> {
  if (lock.current) return { kind: "already_running" };
  lock.current = true;
  try {
    return { kind: "ran", result: await fn() };
  } finally {
    lock.current = false;
  }
}
