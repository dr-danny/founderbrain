import { z } from "zod";

/**
 * Pure FounderBrain domain: types, schema, emptyBrain, present, readiness, canonicalize.
 * No Node imports — shared by the API (`src/founderbrain`) and the web app.
 * Hashing stays server-side (`contentHash` in domain.ts) because it needs node:crypto.
 */

const text = z.string().max(2000);
const section = { approved: z.boolean() };

export const brainSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z
      .object({
        name: text,
        venture: text,
        role: text,
        stage: z.enum(["exploring", "building", "launched", "growing"]),
        goal: text,
        ...section,
      })
      .strict(),
    customer: z
      .object({
        segment: text,
        problem: text,
        outcome: text,
        workaround: text,
        evidenceStatus: z.enum(["hypothesis", "supported"]),
        evidence: text,
        ...section,
      })
      .strict(),
    offer: z
      .object({
        description: text,
        delivery: text,
        outcome: text,
        cta: text,
        price: text,
        ...section,
      })
      .strict(),
    voice: z.object({ tone: text, boundaries: text, sample: text, ...section }).strict(),
  })
  .strict();

export type Brain = z.infer<typeof brainSchema>;
export type Stage = Brain["identity"]["stage"];
export type EvidenceStatus = Brain["customer"]["evidenceStatus"];
export type MissionSection = "identity" | "customer" | "offer" | "voice";

export interface Artifact {
  id: string;
  text: string;
  sourceVersion: number;
  sourceHash: string;
  inputHash: string;
  acceptedAt: string | null;
  createdAt: string;
}
export interface Readiness {
  identity: boolean;
  customer: boolean;
  offer: boolean;
  voice: boolean;
  output: boolean;
}
export interface BrainState {
  workspaceId: string;
  version: number;
  sha: string;
  updatedAt: string | null;
  brain: Brain;
  readiness: Readiness;
  verified: boolean;
  artifact?: Artifact | null;
}

export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function emptyBrain(): Brain {
  return {
    schemaVersion: 1,
    identity: { name: "", venture: "", role: "", stage: "exploring", goal: "", approved: false },
    customer: {
      segment: "",
      problem: "",
      outcome: "",
      workaround: "",
      evidenceStatus: "hypothesis",
      evidence: "",
      approved: false,
    },
    offer: { description: "", delivery: "", outcome: "", cta: "", price: "", approved: false },
    voice: { tone: "", boundaries: "", sample: "", approved: false },
  };
}

/** Non-empty and not a placeholder the contract rejects (`unknown`, `n/a`, `tbd`, `not sure`). */
export function present(...values: string[]): boolean {
  return values.every(
    (v) => v.trim().length > 0 && !/^(unknown|n\/a|tbd|not sure)$/i.test(v.trim()),
  );
}

export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /^(unknown|n\/a|tbd|not sure)$/i.test(trimmed);
}

export function fieldNeedsAttention(value: string): boolean {
  return !present(value);
}

/**
 * Section readiness. `sourceHash` is optional so the browser can hint without hashing;
 * when omitted, `output` is false even if an artifact exists.
 */
export function readiness(
  brain: Brain,
  artifact?: Artifact | null,
  sourceHash?: string | null,
): Readiness {
  return {
    identity:
      brain.identity.approved &&
      present(
        brain.identity.name,
        brain.identity.venture,
        brain.identity.role,
        brain.identity.goal,
      ),
    customer:
      brain.customer.approved &&
      present(brain.customer.segment, brain.customer.problem, brain.customer.outcome) &&
      (brain.customer.evidenceStatus === "hypothesis" || present(brain.customer.evidence)),
    offer:
      brain.offer.approved &&
      present(brain.offer.description, brain.offer.delivery, brain.offer.outcome, brain.offer.cta),
    voice:
      brain.voice.approved && present(brain.voice.tone, brain.voice.boundaries, brain.voice.sample),
    output: Boolean(artifact?.acceptedAt && sourceHash && artifact.sourceHash === sourceHash),
  };
}

/** Would this section pass readiness if the founder marked it approved right now? */
export function sectionWouldApprove(brain: Brain, section: MissionSection): boolean {
  const probe = structuredClone(brain);
  probe[section].approved = true;
  return readiness(probe)[section];
}

export function validateBrain(value: unknown, sourceHashForOutput?: string | null): Brain {
  const result = brainSchema.safeParse(value);
  if (!result.success) {
    throw new DomainError(
      422,
      "invalid_brain",
      "Check the field types and lengths. Each field allows up to 2,000 characters.",
    );
  }
  const brain = result.data;
  const ready = readiness(brain, null, sourceHashForOutput ?? null);
  for (const key of ["identity", "customer", "offer", "voice"] as const) {
    if (brain[key].approved && !ready[key]) {
      throw new DomainError(
        422,
        "incomplete_section",
        `Complete the required ${key} fields before approving, or save them as a draft.`,
      );
    }
  }
  return brain;
}

/** Stable JSON format is part of the persisted v1 contract. Never silently change it. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v))
      .join(",") +
    "}"
  );
}
