import { createHash } from "node:crypto";
import pino, { type Logger } from "pino";

/** Hash a subject for logs. Never log the raw Hexclave subject. */
export function subjectLogHash(subject: string): string {
  return createHash("sha256").update(subject).digest("hex").slice(0, 16);
}

/**
 * Pino for FounderBrain. Redacts anything that could be Brain text, tokens, or keys.
 * Request metadata (method, path, status, latency, request id, subject hash) is fine.
 */
export function createFounderBrainLogger(service: "api" | "worker", level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    level,
    base: { service: `founderbrain-${service}` },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers[\"x-stack-access-token\"]",
        "req.headers[\"x-founderbrain-origin\"]",
        "req.body",
        "brain",
        "prompt",
        "text",
        "ANTHROPIC_API_KEY",
        "ORIGIN_SECRET",
        "GE_MASTER_KEY",
      ],
      remove: true,
    },
  });
}

export type JobLogEvent = {
  jobId: string;
  workspaceId: string;
  status: string;
  providerRequestId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
  errorClass?: string;
};

export function logJobEvent(log: Logger, event: JobLogEvent): void {
  log.info(
    {
      jobId: event.jobId,
      workspaceId: event.workspaceId,
      status: event.status,
      providerRequestId: event.providerRequestId ?? undefined,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costMicroUsd: event.costMicroUsd,
      errorClass: event.errorClass,
    },
    "founderbrain.job",
  );
}
