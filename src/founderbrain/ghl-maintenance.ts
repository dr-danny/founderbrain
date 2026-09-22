/**
 * src/founderbrain/ghl-maintenance.ts
 *
 * WHAT THIS IS. The GoHighLevel read the what-worked maintenance run needs:
 * published Social Planner posts from the last seven days, with whatever
 * figures GoHighLevel returned for each. Read only. Nothing is created,
 * edited, sent or deleted through this module.
 *
 * WHERE THE SHAPE COMES FROM. `POST /social-media-posting/:locationId/posts/list`
 * and `GET /social-media-posting/:locationId/posts/:id`, Version v3, scope
 * `socialplanner/post.readonly`, per HighLevel's published API docs (checked
 * 2026-09-22). skip and limit are documented as strings, not numbers.
 *
 * HONESTY RULE. Per-post figures are parsed defensively and only rendered when
 * the API returned them. A post with no figures in the response is listed with
 * "no figures returned", never estimated, never compared to a benchmark.
 */
import { readConnection } from "./crm-oauth.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "v3";

export type PostFigures = {
  readonly id: string | null;
  readonly firstLine: string | null;
  readonly platform: string | null;
  readonly scheduledAt: string | null;
  readonly figures: Readonly<Record<string, number>>;
};

export type RecentPostsRead =
  | { readonly kind: "ok"; readonly posts: readonly PostFigures[] }
  | { readonly kind: "not_connected" }
  | { readonly kind: "vendor_error"; readonly status: number };

function firstLineOf(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const line = text.split("\n").find((l) => l.trim().length > 0);
  return line ? line.trim().slice(0, 120) : null;
}

/** Pick the first field that actually carries text, in API order. An empty
 *  string is not content, so it falls through to the next candidate. */
function firstTextOf(row: Record<string, unknown>): unknown {
  for (const key of ["message", "content", "caption"] as const) {
    const v = row[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/** Walk one post object and collect every shallowly returned number, keyed by
 *  the name the API used. Nested objects and arrays are skipped on purpose:
 *  only plain figure fields the API put on the post itself count as returned. */
export function figuresOf(post: unknown): Readonly<Record<string, number>> {
  const figures: Record<string, number> = {};
  if (post === null || typeof post !== "object") return figures;
  for (const [k, v] of Object.entries(post as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && k.length <= 40) figures[k] = v;
  }
  return figures;
}

/** Pure parser for the posts/list response so tests can hold the shape. */
export function parsePostList(body: unknown): readonly PostFigures[] {
  const results = (body as { results?: unknown } | null)?.results;
  const list = Array.isArray(results)
    ? results
    : Array.isArray((results as { posts?: unknown } | null)?.posts)
      ? ((results as { posts: unknown[] }).posts as unknown[])
      : [];
  return list.map((p) => {
    const row = (p ?? {}) as Record<string, unknown>;
    const figures: Record<string, number> = {
      ...figuresOf(p),
    };
    // The post detail endpoint nests figures (stats / statistics); copy any
    // numeric leaves it returned under the API's own names.
    for (const key of ["stats", "statistics"] as const) {
      const nested = row[key];
      if (nested !== null && typeof nested === "object" && !Array.isArray(nested))
        Object.assign(figures, figuresOf(nested));
    }
    delete figures.id;
    return {
      id: typeof row._id === "string" ? row._id : typeof row.id === "string" ? row.id : null,
      firstLine: firstLineOf(firstTextOf(row)),
      platform:
        typeof row.platform === "string"
          ? row.platform
          : typeof (row.channel as { platform?: unknown })?.platform === "string"
            ? String((row.channel as { platform: unknown }).platform)
            : null,
      scheduledAt:
        typeof row.scheduled_at === "string"
          ? row.scheduled_at
          : typeof row.created_at === "string"
            ? row.created_at
            : null,
      figures,
    };
  });
}

export async function listRecentPublishedPosts(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  fetchImpl: typeof globalThis.fetch = fetch,
  now: Date = new Date(),
): Promise<RecentPostsRead> {
  const tokens = await readConnection(store, workspace, config);
  if (!tokens) return { kind: "not_connected" };
  const toDate = now.toISOString();
  const fromDate = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  let response: Response;
  try {
    response = await fetchImpl(
      `${GHL_API}/social-media-posting/${encodeURIComponent(tokens.locationId)}/posts/list`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Version: GHL_VERSION,
        },
        body: JSON.stringify({ type: "published", skip: "0", limit: "10", fromDate, toDate }),
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    return { kind: "vendor_error", status: 0 };
  }
  if (!response.ok) return { kind: "vendor_error", status: response.status };
  const body: unknown = await response.json().catch(() => null);
  return { kind: "ok", posts: parsePostList(body) };
}
