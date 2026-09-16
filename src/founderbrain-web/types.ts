export type Stage = "exploring" | "building" | "launched" | "growing";
export type EvidenceStatus = "hypothesis" | "supported";

export interface Brain {
  schemaVersion: 1;
  identity: { name: string; venture: string; role: string; stage: Stage; goal: string; approved: boolean };
  customer: { segment: string; problem: string; outcome: string; workaround: string; evidenceStatus: EvidenceStatus; evidence: string; approved: boolean };
  offer: { description: string; delivery: string; outcome: string; cta: string; price: string; approved: boolean };
  voice: { tone: string; boundaries: string; sample: string; approved: boolean };
}
export interface Artifact { id: string; text: string; sourceVersion: number; sourceHash: string; inputHash: string; acceptedAt: string | null; createdAt: string; }
export interface BrainState { workspaceId: string; version: number; sha: string; updatedAt: string | null; brain: Brain; readiness: { identity: boolean; customer: boolean; offer: boolean; voice: boolean; output: boolean }; verified: boolean; artifact?: Artifact | null; }
export interface Config { authMode: "supabase" | "local-demo"; supabaseUrl?: string; supabaseAnonKey?: string; aiEnabled: boolean; }
export interface HistoryItem { version: number; sha: string; at: string; }
export interface Job { id: string; status: "queued" | "running" | "completed" | "failed" | "uncertain"; error?: string; artifact?: Artifact; }

export const emptyBrain = (): Brain => ({
  schemaVersion: 1,
  identity: { name: "", venture: "", role: "", stage: "exploring", goal: "", approved: false },
  customer: { segment: "", problem: "", outcome: "", workaround: "", evidenceStatus: "hypothesis", evidence: "", approved: false },
  offer: { description: "", delivery: "", outcome: "", cta: "", price: "", approved: false },
  voice: { tone: "", boundaries: "", sample: "", approved: false },
});
