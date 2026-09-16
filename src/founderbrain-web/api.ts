import type { Artifact, Brain, BrainState, Config, HistoryItem, Job } from "./types";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details: { committedVersion?: number; [key: string]: unknown } = {}) { super(message); }
}

type Auth = () => Promise<string | null>;
const makeKey = (): string => crypto.randomUUID();

export class FounderBrainApi {
  constructor(private readonly getToken: Auth, private readonly demo = false) {}

  private async request<T>(path: string, init: RequestInit = {}, timeout = 12_000): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.demo) headers.set("X-Dev-User", "demo");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    try {
      const response = await fetch(`/api${path}`, { ...init, headers, signal: controller.signal, credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string; committedVersion?: number } & T;
      if (!response.ok) throw new ApiError(response.status, body.error ?? "request_failed", body.message ?? "FounderBrain could not complete that request.", body);
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new ApiError(0, "timeout", "The request timed out. Your draft is still here. Check the saved version before retrying.");
      throw new ApiError(0, "network", "Network unavailable. Your draft is still here.");
    } finally { window.clearTimeout(timer); }
  }

  config() { return this.request<Config>("/config", {}, 8_000); }
  brain(version?: number) { return this.request<BrainState>(`/brain${version === undefined ? "" : `?version=${encodeURIComponent(version)}`}`); }
  history() { return this.request<{ versions: HistoryItem[] }>("/history"); }
  artifact() { return this.request<{ artifact: Artifact | null; stale: boolean }>("/artifact"); }
  save(brain: Brain, expectedVersion: number, idempotencyKey = makeKey()) { return this.request<BrainState>("/brain", { method: "PUT", body: JSON.stringify({ brain, expectedVersion, idempotencyKey }) }); }
  restore(version: number, expectedVersion: number, idempotencyKey = makeKey()) { return this.request<BrainState>("/restore", { method: "POST", body: JSON.stringify({ version, expectedVersion, idempotencyKey }) }); }
  startJob(expectedVersion: number, idempotencyKey = makeKey()) { return this.request<Pick<Job, "id" | "status">>("/jobs", { method: "POST", body: JSON.stringify({ expectedVersion, idempotencyKey }) }); }
  job(id: string) { return this.request<Job>(`/jobs/${encodeURIComponent(id)}`); }
  acceptArtifact(id: string, text: string, expectedVersion: number, idempotencyKey = makeKey()) { return this.request<{ artifact: Artifact; verified: boolean }>(`/artifact/${encodeURIComponent(id)}/accept`, { method: "POST", body: JSON.stringify({ text, expectedVersion, idempotencyKey }) }); }
  deleteWorkspace() { return this.request<{ deleted: true }>("/workspace", { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE" }) }); }
  async download(format: "json" | "markdown"): Promise<void> {
    const token = await this.getToken(); const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`); if (this.demo) headers.set("X-Dev-User", "demo");
    const response = await fetch(`/api/export?format=${format}`, { headers, credentials: "same-origin" });
    if (!response.ok) throw new ApiError(response.status, "export_failed", "Export could not be prepared.");
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
    link.href = url; link.download = `founder-brain.${format === "markdown" ? "md" : "json"}`; link.click(); URL.revokeObjectURL(url);
  }
}
