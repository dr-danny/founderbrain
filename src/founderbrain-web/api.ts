/**
 * src/founderbrain-web/api.ts
 *
 * WHAT THIS IS. Browser client for the FounderBrain API. Each request pulls a
 * fresh Hexclave access token (or the local-demo header) and never relies on
 * cookies (`credentials: 'omit'`).
 */
import type { Artifact, Brain, BrainState, Config, HistoryItem, Job, Me } from "./types";
import type { OrientationPatch, OrientationState } from "../founderbrain-shared/orientation";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: { committedVersion?: number; [key: string]: unknown } = {},
  ) {
    super(message);
  }
}

const makeKey = (): string => crypto.randomUUID();
const SESSION_EXPIRED = new ApiError(
  401,
  "session_expired",
  "Your sign-in has expired. Your draft is still on this page. " +
    "Sign in again in a new tab, then retry.",
);
/** The header the API and the Worker read the Hexclave access token from. */
export const ACCESS_TOKEN_HEADER = "x-stack-access-token";

/** Returns the current Hexclave access token, or null when there is no session. */
export type TokenSource = () => Promise<string | null>;

/**
 * The browser's view of the API. Identity is a Hexclave access token, fetched from the SDK
 * right before each request so the SDK's own refresh logic is what keeps it current. No
 * cookies are relied on by the API and none are sent: `credentials: "omit"` makes that
 * explicit. A 401 from the API means the token was missing, expired or refused; it becomes
 * one clear error that keeps the draft on screen.
 */
export class FounderBrainApi {
  /**
   * @param token   where to get the access token; `null` for `/api/config`, which is fetched before sign-in.
   * @param demo    local demo mode: send the loopback-only dev header instead of a token.
   */
  constructor(
    private readonly token: TokenSource | null = null,
    private readonly demo = false,
  ) {}

  private async headers(init: RequestInit): Promise<Headers> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.demo) headers.set("X-Dev-User", "demo");
    else if (this.token) {
      const value = await this.token();
      if (!value) throw SESSION_EXPIRED;
      headers.set(ACCESS_TOKEN_HEADER, value);
    }
    return headers;
  }

  private async fetchApi(path: string, init: RequestInit, timeout: number): Promise<Response> {
    const headers = await this.headers(init);
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(`/api${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw new ApiError(
          0,
          "timeout",
          "The request timed out. Your draft is still here. Check the saved version before retrying.",
        );
      throw new ApiError(0, "network", "Network unavailable. Your draft is still here.");
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, timeout = 12_000): Promise<T> {
    const response = await this.fetchApi(path, init, timeout);
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      committedVersion?: number;
    } & T;
    if (response.status === 401 && this.token) throw SESSION_EXPIRED;
    if (!response.ok)
      throw new ApiError(
        response.status,
        body.error ?? "request_failed",
        body.message ?? "FounderBrain could not complete that request.",
        body,
      );
    return body as T;
  }

  config() {
    return this.request<Config>("/config", {}, 8_000);
  }
  me() {
    return this.request<Me>("/me", {}, 8_000);
  }
  orientation() {
    return this.request<OrientationState>("/orientation");
  }
  saveOrientation(patch: OrientationPatch) {
    return this.request<OrientationState>("/orientation", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  }
  oauthStatus() {
    return this.request<{ connected: boolean; locationId: string | null }>("/oauth/status");
  }
  startOauth() {
    return this.request<{ url: string }>("/oauth/start");
  }
  importSite(url: string) {
    return this.request<{ proposal: Record<string, unknown>; source: "ai" | "title" }>("/site-import", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }
  completeOauth(body: { code: string; state: string }) {
    return this.request<{ connected: boolean; locationId: string | null }>("/oauth/complete", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  brain(version?: number) {
    return this.request<BrainState>(
      `/brain${version === undefined ? "" : `?version=${encodeURIComponent(version)}`}`,
    );
  }
  history() {
    return this.request<{ versions: HistoryItem[] }>("/history");
  }
  artifact() {
    return this.request<{ artifact: Artifact | null; stale: boolean }>("/artifact");
  }
  save(brain: Brain, expectedVersion: number, idempotencyKey = makeKey()) {
    return this.request<BrainState>("/brain", {
      method: "PUT",
      body: JSON.stringify({ brain, expectedVersion, idempotencyKey }),
    });
  }
  restore(version: number, expectedVersion: number, idempotencyKey = makeKey()) {
    return this.request<BrainState>("/restore", {
      method: "POST",
      body: JSON.stringify({ version, expectedVersion, idempotencyKey }),
    });
  }
  startJob(expectedVersion: number, idempotencyKey = makeKey()) {
    return this.request<Pick<Job, "id" | "status">>("/jobs", {
      method: "POST",
      body: JSON.stringify({ expectedVersion, idempotencyKey }),
    });
  }
  job(id: string) {
    return this.request<Job>(`/jobs/${encodeURIComponent(id)}`);
  }
  acceptArtifact(id: string, text: string, expectedVersion: number, idempotencyKey = makeKey()) {
    return this.request<{ artifact: Artifact; verified: boolean }>(
      `/artifact/${encodeURIComponent(id)}/accept`,
      { method: "POST", body: JSON.stringify({ text, expectedVersion, idempotencyKey }) },
    );
  }
  deleteWorkspace() {
    return this.request<{ deleted: true }>("/workspace", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
  }
  async download(format: "json" | "markdown"): Promise<void> {
    const response = await this.fetchApi(`/export?format=${format}`, {}, 20_000);
    if (response.status === 401) throw SESSION_EXPIRED;
    if (!response.ok)
      throw new ApiError(response.status, "export_failed", "Export could not be prepared.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `founder-brain.${format === "markdown" ? "md" : "json"}`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
