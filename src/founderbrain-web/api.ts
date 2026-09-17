import type { Artifact, Brain, BrainState, Config, HistoryItem, Job, Me } from "./types";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details: { committedVersion?: number; [key: string]: unknown } = {}) { super(message); }
}

const makeKey = (): string => crypto.randomUUID();
const SESSION_EXPIRED = new ApiError(401, "session_expired", "Your sign-in has expired. Your draft is still on this page. Sign in again in a new tab, then retry.");

/**
 * The browser's view of the API. There is no token handling here on purpose: Cloudflare
 * Access holds the session in an HttpOnly cookie on this origin and `credentials:
 * "same-origin"` sends it. When that session has expired, Access answers an API fetch
 * with a redirect to its login page. We ask for `redirect: "manual"` so that shows up as
 * an opaque redirect rather than a CORS failure, and we turn it into one clear error.
 */
export class FounderBrainApi {
  constructor(private readonly demo = false) {}

  private headers(init: RequestInit): Headers {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.demo) headers.set("X-Dev-User", "demo");
    return headers;
  }

  private async fetchApi(path: string, init: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`/api${path}`, { ...init, headers: this.headers(init), signal: controller.signal, credentials: "same-origin", redirect: "manual" });
      if (response.type === "opaqueredirect" || response.status === 0) throw SESSION_EXPIRED;
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new ApiError(0, "timeout", "The request timed out. Your draft is still here. Check the saved version before retrying.");
      throw new ApiError(0, "network", "Network unavailable. Your draft is still here.");
    } finally { window.clearTimeout(timer); }
  }

  private async request<T>(path: string, init: RequestInit = {}, timeout = 12_000): Promise<T> {
    const response = await this.fetchApi(path, init, timeout);
    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    // An HTML body on an API path is Access's login page standing in for our JSON.
    if (!isJson && (response.status === 401 || response.status === 403 || response.ok)) throw SESSION_EXPIRED;
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string; committedVersion?: number } & T;
    if (!response.ok) throw new ApiError(response.status, body.error ?? "request_failed", body.message ?? "FounderBrain could not complete that request.", body);
    return body as T;
  }

  config() { return this.request<Config>("/config", {}, 8_000); }
  me() { return this.request<Me>("/me", {}, 8_000); }
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
    const response = await this.fetchApi(`/export?format=${format}`, {}, 20_000);
    if (!response.ok) throw new ApiError(response.status, "export_failed", "Export could not be prepared.");
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
    link.href = url; link.download = `founder-brain.${format === "markdown" ? "md" : "json"}`; link.click(); URL.revokeObjectURL(url);
  }
}
