export type JobStatus = "queued" | "running" | "completed" | "failed" | "uncertain";

export type PollOutcome =
  | { kind: "completed" }
  | { kind: "failed"; error?: string }
  | { kind: "uncertain" }
  | { kind: "continue" }
  | { kind: "still_running" }
  | { kind: "unresolved" };

export const JOB_POLL_DEADLINE_MS = 150_000;
export const JOB_POLL_INITIAL_WAIT_MS = 2_000;
export const JOB_POLL_MAX_WAIT_MS = 5_000;

export function nextPollWaitMs(currentWaitMs: number): number {
  return Math.min(Math.round(currentWaitMs * 1.25), JOB_POLL_MAX_WAIT_MS);
}

export function interpretJobStatus(status: JobStatus): PollOutcome {
  if (status === "completed") return { kind: "completed" };
  if (status === "failed") return { kind: "failed" };
  if (status === "uncertain") return { kind: "uncertain" };
  return { kind: "continue" };
}

export function interpretPollTimeout(lastStatus: JobStatus | null): PollOutcome {
  if (lastStatus === "queued" || lastStatus === "running") return { kind: "still_running" };
  return { kind: "unresolved" };
}

export function stillRunningNotice(): string {
  return "Still writing. Come back in a minute. Don't start another draft yet.";
}

export function unresolvedJobNotice(): string {
  return "This didn't finish. Refresh, then try again.";
}
