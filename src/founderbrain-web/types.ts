/**
 * Browser-facing types that are not part of the shared Brain domain.
 * Brain / Artifact / BrainState / emptyBrain live in `src/founderbrain-shared/domain.ts`.
 */
export type {
  Artifact,
  Brain,
  BrainState,
  EvidenceStatus,
  MissionSection,
  Readiness,
  Stage,
} from "../founderbrain-shared/domain";
export {
  emptyBrain,
  fieldNeedsAttention,
  isPlaceholder,
  present,
  readiness,
  sectionWouldApprove,
} from "../founderbrain-shared/domain";

/**
 * What the API tells the browser about its surroundings. Sign-in is Hexclave, and the
 * browser builds its Hexclave client from `hexclave` at runtime so one static bundle serves
 * staging and production. Everything in here is public: the project id is in every token's
 * audience and the publishable key is, as named, publishable.
 */
export interface HexclaveClientConfig {
  projectId: string;
  apiUrl: string;
  publishableClientKey: string | null;
}
export interface Config {
  authMode: "hexclave" | "local-demo";
  hexclave: HexclaveClientConfig | null;
  aiEnabled: boolean;
  crmConnectEnabled?: boolean;
  siteImportEnabled?: boolean;
  routinesEnabled?: boolean;
}
export interface RoutineDraft {
  id: string;
  kind: "monday_plan" | "content_top_up" | "readiness";
  periodKey: string;
  title: string;
  body: string;
  status: "pending" | "read" | "dismissed";
  createdAt: string;
}

export interface RoutineSettings {
  timezone: string;
  mondayPlan: boolean;
  contentTopUp: boolean;
  readinessDigest: boolean;
}

export interface Me {
  email: string;
}
export interface HistoryItem {
  version: number;
  sha: string;
  at: string;
  /** What the workspace was at this save (from /api/history). */
  venture?: string;
  track?: "b2b" | "b2c";
  hybrid?: boolean;
  approved?: string[];
  /** Sections that differ from the version before; all sections for the first save. */
  changed?: string[];
}
export interface Job {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "uncertain";
  error?: string;
  artifact?: import("../founderbrain-shared/domain").Artifact;
}

/** Actual metered usage and the founder-facing price (GET /api/usage).
 *  Cost and markup stay server-side; the price already includes the buffer. */
export interface UsageResponse {
  ai: {
    events: number;
    inputTokens: number;
    outputTokens: number;
    priceMicroUsd: number;
    priceInputUsdPerMillion: number | null;
    priceOutputUsdPerMillion: number | null;
  };
  firecrawl: {
    scrapes: number;
    credits: number;
    priceMicroUsd: number;
    priceUsdPerCredit: number;
  };
  totalMicroUsd: number;
}
