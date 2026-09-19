/**
 * Structured orientation / Typeform chapter progress for FounderBrain.
 * Kept out of Brain markdown: server-side row only, read back after write.
 */
import { z } from "zod";

export const ORIENTATION_FIRST_LOGIN_SCREENS = 4 as const;
export const CONTENT_CHAPTER_SCREENS = 6 as const;
export const OUTREACH_CHAPTER_SCREENS = 3 as const;
<<<<<<< HEAD
export const GHL_CHAPTER_SCREENS = 5 as const;
=======
export const GHL_CHAPTER_SCREENS = 4 as const;
>>>>>>> origin/main

export const trackSchema = z.enum(["b2b", "b2c"]);
export type FounderTrack = z.infer<typeof trackSchema>;

export const contentAnswersSchema = z
  .object({
    domainReady: z.boolean().optional(),
    instagramBusiness: z.boolean().optional(),
    thirtyPieces: z.boolean().optional(),
    bottleneck: z.string().max(500).optional(),
    workflow: z.string().max(200).optional(),
  })
  .strict();

export const outreachAnswersSchema = z
  .object({
    copyFinalised: z.boolean().optional(),
    prospectList: z.boolean().optional(),
    targetAccounts: z.boolean().optional(),
  })
  .strict();

export const ghlAnswersSchema = z
  .object({
    hasAccount: z.boolean().optional(),
    connected: z.boolean().optional(),
  })
  .strict();

const isoOrNull = z.string().datetime({ offset: true }).nullable();

export const orientationStateSchema = z
  .object({
    firstLoginScreen: z.number().int().min(1).max(ORIENTATION_FIRST_LOGIN_SCREENS),
    firstLoginCompletedAt: isoOrNull,
    track: trackSchema.nullable(),
    contentScreen: z.number().int().min(1).max(CONTENT_CHAPTER_SCREENS),
    contentCompletedAt: isoOrNull,
    contentAnswers: contentAnswersSchema,
    outreachScreen: z.number().int().min(1).max(OUTREACH_CHAPTER_SCREENS),
    outreachCompletedAt: isoOrNull,
    outreachAnswers: outreachAnswersSchema,
    ghlScreen: z.number().int().min(1).max(GHL_CHAPTER_SCREENS),
    ghlCompletedAt: isoOrNull,
    ghlAnswers: ghlAnswersSchema,
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type OrientationState = z.infer<typeof orientationStateSchema>;
export type ContentAnswers = z.infer<typeof contentAnswersSchema>;
export type OutreachAnswers = z.infer<typeof outreachAnswersSchema>;
export type GhlAnswers = z.infer<typeof ghlAnswersSchema>;

export const orientationPatchSchema = z
  .object({
    firstLoginScreen: z.number().int().min(1).max(ORIENTATION_FIRST_LOGIN_SCREENS).optional(),
    firstLoginComplete: z.boolean().optional(),
    track: trackSchema.nullable().optional(),
    contentScreen: z.number().int().min(1).max(CONTENT_CHAPTER_SCREENS).optional(),
    contentComplete: z.boolean().optional(),
    contentAnswers: contentAnswersSchema.optional(),
    outreachScreen: z.number().int().min(1).max(OUTREACH_CHAPTER_SCREENS).optional(),
    outreachComplete: z.boolean().optional(),
    outreachAnswers: outreachAnswersSchema.optional(),
    ghlScreen: z.number().int().min(1).max(GHL_CHAPTER_SCREENS).optional(),
    ghlComplete: z.boolean().optional(),
    ghlAnswers: ghlAnswersSchema.optional(),
  })
  .strict();

export type OrientationPatch = z.infer<typeof orientationPatchSchema>;

export function emptyOrientationState(now = new Date()): OrientationState {
  const updatedAt = now.toISOString();
  return {
    firstLoginScreen: 1,
    firstLoginCompletedAt: null,
    track: null,
    contentScreen: 1,
    contentCompletedAt: null,
    contentAnswers: {},
    outreachScreen: 1,
    outreachCompletedAt: null,
    outreachAnswers: {},
    ghlScreen: 1,
    ghlCompletedAt: null,
    ghlAnswers: {},
    updatedAt,
  };
}

export function isFirstLoginComplete(state: OrientationState): boolean {
  return state.firstLoginCompletedAt !== null;
}

/** Apply a validated patch onto current state. Completing a chapter clamps its screen. */
export function applyOrientationPatch(
  current: OrientationState,
  patch: OrientationPatch,
  now = new Date(),
): OrientationState {
  const next: OrientationState = {
    ...current,
    contentAnswers: { ...current.contentAnswers, ...patch.contentAnswers },
    outreachAnswers: { ...current.outreachAnswers, ...patch.outreachAnswers },
    ghlAnswers: { ...current.ghlAnswers, ...patch.ghlAnswers },
    updatedAt: now.toISOString(),
  };
  if (patch.track !== undefined) next.track = patch.track;
  if (patch.firstLoginScreen !== undefined) next.firstLoginScreen = patch.firstLoginScreen;
  if (patch.contentScreen !== undefined) next.contentScreen = patch.contentScreen;
  if (patch.outreachScreen !== undefined) next.outreachScreen = patch.outreachScreen;
  if (patch.ghlScreen !== undefined) next.ghlScreen = patch.ghlScreen;

  if (patch.firstLoginComplete) {
    next.firstLoginScreen = ORIENTATION_FIRST_LOGIN_SCREENS;
    next.firstLoginCompletedAt = next.firstLoginCompletedAt ?? now.toISOString();
  }
  if (patch.contentComplete) {
    next.contentScreen = CONTENT_CHAPTER_SCREENS;
    next.contentCompletedAt = next.contentCompletedAt ?? now.toISOString();
  }
  if (patch.outreachComplete) {
    next.outreachScreen = OUTREACH_CHAPTER_SCREENS;
    next.outreachCompletedAt = next.outreachCompletedAt ?? now.toISOString();
  }
  if (patch.ghlComplete) {
    next.ghlScreen = GHL_CHAPTER_SCREENS;
    next.ghlCompletedAt = next.ghlCompletedAt ?? now.toISOString();
  }
  return orientationStateSchema.parse(next);
}

export type AtlantaArtifactKey =
  | "brainThesis"
  | "voice"
  | "firstOutput"
  | "contentChapter"
  | "outreachChapter"
  | "trackSetup"
  | "ghlAccount";

export interface AtlantaArtifact {
  key: AtlantaArtifactKey;
  label: string;
  day: "friday" | "saturday" | "sunday";
  ready: boolean;
}

export interface AtlantaReadyMap {
  artifacts: AtlantaArtifact[];
  readyCount: number;
  total: number;
  /** All required artifacts present — Green. Partial is allowed but not Green. */
  green: boolean;
}

/**
 * Quantifiable Atlanta-ready bar from the prep guide (not invented).
 * Brain/voice/output come from mission readiness; chapters from orientation state.
 */
export function atlantaReadyMap(
  readiness: {
    identity: boolean;
    customer: boolean;
    offer: boolean;
    voice: boolean;
    output: boolean;
  },
  orientation: OrientationState,
): AtlantaReadyMap {
  const brainThesis = readiness.identity && readiness.customer && readiness.offer;
  const trackSetup =
    orientation.track === "b2b"
      ? orientation.contentAnswers.domainReady === true
      : orientation.track === "b2c"
        ? orientation.contentAnswers.instagramBusiness === true
        : false;
  const artifacts: AtlantaArtifact[] = [
    {
      key: "brainThesis",
      label: "Brain + thesis saved (Identity, Customer, Offer)",
      day: "friday",
      ready: brainThesis,
    },
    {
      key: "voice",
      label: "Voice saved",
      day: "saturday",
      ready: readiness.voice,
    },
    {
      key: "firstOutput",
      label: "One private first output accepted",
      day: "friday",
      ready: readiness.output,
    },
    {
      key: "contentChapter",
      label: "Content chapter: 30 pieces, bottleneck, workflow",
      day: "saturday",
      ready: orientation.contentCompletedAt !== null,
    },
    {
      key: "outreachChapter",
      label: "Outreach chapter: copy + list / 25 accounts",
      day: "saturday",
      ready: orientation.outreachCompletedAt !== null,
    },
    {
      key: "trackSetup",
      label:
        orientation.track === "b2c"
          ? "Instagram set to Business"
          : orientation.track === "b2b"
            ? "Email domain ready"
            : "B2B email domain or B2C Instagram Business",
      day: "sunday",
      ready: trackSetup,
    },
    {
      key: "ghlAccount",
      label: "HighLevel connected",
      day: "sunday",
      ready: orientation.ghlAnswers.connected === true,
    },
  ];
  const readyCount = artifacts.filter((a) => a.ready).length;
  return {
    artifacts,
    readyCount,
    total: artifacts.length,
    green: readyCount === artifacts.length,
  };
}
