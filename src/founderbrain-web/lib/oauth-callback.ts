/**
 * Pure classifier for the query string on GET /oauth/callback (GoHighLevel Connect
 * returning to FounderBrain). It never touches the DOM, storage, or the network:
 * callers own reading `location.search`, redacting the address bar, and deciding
 * what to render. Classification is fail-closed. Anything ambiguous - a missing
 * value, a blank value, or the same key repeated - comes back "invalid" so the
 * caller shows the public launch/recovery screen instead of booting auth with a
 * half-formed callback. This does not verify `state` against a stored value; that
 * check stays the API's job inside the existing authenticated flow. It only
 * decides whether the callback carries enough shape to be worth attempting that
 * verification at all.
 */

export type OauthCallbackClassification =
  | { kind: "code"; code: string; state: string }
  | { kind: "error"; error: string; state: string }
  | { kind: "invalid" };

/** True only when `key` appears exactly once. Missing or duplicated both fail. */
function hasSingleParam(params: URLSearchParams, key: string): boolean {
  return params.getAll(key).length === 1;
}

/** The single value for `key`, trimmed, or null if missing/duplicated/blank. */
function singleTrimmedValue(params: URLSearchParams, key: string): string | null {
  if (!hasSingleParam(params, key)) return null;
  const value = (params.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

export function classifyOauthCallback(search: string): OauthCallbackClassification {
  const params = new URLSearchParams(search);

  // `state` is required and unambiguous for every legitimate shape below, error or not.
  const state = singleTrimmedValue(params, "state");
  if (!state) return { kind: "invalid" };

  if (params.has("error")) {
    // `code` and `error` together are ambiguous, whether or not either is duplicated:
    // there is no legitimate GoHighLevel shape that carries both, so do not guess which
    // one to trust. A duplicated error key is separately malformed. A blank error value
    // alone is a known GoHighLevel shape; keep the existing "access_denied" fallback text.
    if (params.has("code")) return { kind: "invalid" };
    if (!hasSingleParam(params, "error")) return { kind: "invalid" };
    const error = (params.get("error") ?? "").trim() || "access_denied";
    return { kind: "error", error, state };
  }

  const code = singleTrimmedValue(params, "code");
  if (!code) return { kind: "invalid" };
  return { kind: "code", code, state };
}
