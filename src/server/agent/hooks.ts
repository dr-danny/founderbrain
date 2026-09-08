/**
 * hooks.ts
 *
 * WHAT: The three SDK hooks this app registers. PostToolUse turns a write into
 *       a live file frame. PreCompact records that the next turn needs re
 *       anchoring. PreToolUse fences every file tool call to this founder's
 *       own folder.
 *
 * WHY IT EXISTS: PostToolUse is the moment the product feels real. A founder
 *       watches their Founder Brain appear in the file panel while they are
 *       still talking. It costs nothing and it is the difference between "is
 *       this doing anything" and "there it is".
 *
 *       PreCompact exists because compaction summarises, and "you are on step 3
 *       of 5" is exactly what a summary loses. Without the flag the model
 *       restarts a group of questions the founder has already answered, twenty
 *       minutes into an interview.
 *
 *       PreToolUse exists because bypassPermissions plus an absolute path plus
 *       every founder's folder on one disk is a cross tenant read, not a
 *       hypothetical one. The tool surface is Read, Write, Edit, Glob, Grep,
 *       cwd is set to this founder's own scratch folder, but cwd does not stop
 *       a tool being handed an absolute path, and nothing before this hook
 *       checked one. A founder can paste an uploaded document into the chat,
 *       and an uploaded document is exactly how someone other than the
 *       founder gets a string in front of the model to try it with: a path
 *       into another founder's growth-engine folder, /etc/passwd, whatever
 *       the model can be steered into asking for. This hook is the check that
 *       was missing.
 *
 * CALLED BY: runner.ts, which passes these into Options.hooks.
 * READS:  the tool input, which is untrusted model output. WRITES: nothing
 *         directly. It calls back into the runner, which emits frames, or it
 *         denies the tool call itself.
 *
 * A hook runs inside the turn and blocks it. So these do almost nothing: they
 * hand a fact to a callback and return, or in PreToolUse's case resolve one
 * path and compare it. Anything slow belongs in harvest.
 */

import { resolve, sep } from 'node:path';
import { friendlyFile, isFileWrite } from './labels.js';

/** Structural shape of the SDK's PostToolUse hook input. Kept minimal. */
export interface PostToolUseInput {
  readonly hook_event_name: 'PostToolUse';
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly tool_use_id: string;
}

/** Structural shape of the SDK's PreCompact hook input. */
export interface PreCompactInput {
  readonly hook_event_name: 'PreCompact';
  readonly trigger: 'manual' | 'auto';
}

/** Structural shape of the SDK's PreToolUse hook input. */
export interface PreToolUseInput {
  readonly hook_event_name: 'PreToolUse';
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly tool_use_id: string;
}

/** What a hook returns. `continue: true` means carry on with the turn. */
export interface HookOutput {
  readonly continue: boolean;
  readonly suppressOutput?: boolean;
  /**
   * The SDK's per tool decision, carried alongside `continue`. Only PreToolUse
   * sets this. `continue: true` plus a deny here tells the model no on this
   * one call without ending the founder's turn; `continue: false` would end
   * the whole turn, which is not what a single bad path calls for.
   */
  readonly hookSpecificOutput?: {
    readonly hookEventName: 'PreToolUse';
    readonly permissionDecision?: 'allow' | 'deny' | 'ask';
    readonly permissionDecisionReason?: string;
  };
}

export interface HookDeps {
  /** Emits a `file` frame. The Files panel is listening for it. */
  readonly onFileWritten: (path: string) => void;
  /**
   * Called when founder-brain.md itself was written. The cached track column
   * is refreshed from the file, because the file wins and the column is the
   * bug when they disagree.
   */
  readonly onBrainChanged: () => void;
  /** Sets the re anchor flag for the next turn. */
  readonly onCompactStarting: (trigger: 'manual' | 'auto') => void;
  /**
   * Absolute path of this founder's own scratch folder. Every candidate path
   * out of a file tool's input must resolve inside this or the call is
   * denied. Every founder's folder lives on the same disk, so this is the one
   * thing standing between "no shell" and a cross tenant read.
   */
  readonly founderRoot: string;
}

/** Tool names PreToolUse inspects. Anything else passes through untouched. */
const FILE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);

/** Input keys that can carry a path, for the tools above. */
const PATH_KEYS: readonly string[] = ['file_path', 'path', 'notebook_path', 'pattern'];

/**
 * Pulls every string found under the known path-bearing keys out of an
 * untrusted tool_input, treating a string or an array of strings as a
 * candidate and ignoring anything else. Not every key applies to every tool
 * (pattern is only meaningful for Glob/Grep) but reading a key that happens
 * not to apply costs nothing, and a hard-coded per-tool key list is one more
 * thing to keep in sync with the tool surface above.
 */
function candidatePaths(toolInput: unknown): string[] {
  if (typeof toolInput !== 'object' || toolInput === null) return [];
  const out: string[] = [];
  const record = toolInput as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === 'string') {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') out.push(item);
      }
    }
  }
  return out;
}

/** True when `candidate`, resolved against `founderRoot`, stays inside it. */
function isInsideFounderRoot(founderRoot: string, candidate: string): boolean {
  const abs = resolve(founderRoot, candidate);
  return abs === founderRoot || abs.startsWith(founderRoot + sep);
}

/**
 * Fires before every tool call. Only Read, Write, Edit, Glob and Grep are
 * checked; the ge MCP tools are already founder-scoped by closure over this
 * founder's id and must not be touched here. Every path-shaped string in the
 * input is resolved against this founder's own folder: a relative path
 * resolves inside it by construction and passes, an absolute path elsewhere
 * on the disk, or a `..` that climbs out, does not. One bad candidate denies
 * the whole call; `continue: true` stays so only this call stops, not the
 * founder's turn.
 */
export function preToolUse(deps: HookDeps) {
  return async (input: PreToolUseInput): Promise<HookOutput> => {
    if (!FILE_TOOLS.has(input.tool_name)) return { continue: true };

    const candidates = candidatePaths(input.tool_input);
    if (candidates.length === 0) return { continue: true };

    const outside = candidates.some((c) => !isInsideFounderRoot(deps.founderRoot, c));
    if (!outside) return { continue: true };

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'That path is outside this founder\'s own folder, so the tool call is refused.',
      },
    };
  };
}

/**
 * Fires after every Write and Edit. The path is read out of tool_input, which
 * is model output and therefore untrusted, so it is only used after it has been
 * matched against the known file list. An unrecognised path emits no frame at
 * all rather than putting an arbitrary string on a founder's screen.
 */
export function postToolUse(deps: HookDeps) {
  return async (input: PostToolUseInput): Promise<HookOutput> => {
    if (!isFileWrite(input.tool_name)) return { continue: true };

    const raw =
      typeof input.tool_input === 'object' && input.tool_input !== null
        ? (input.tool_input as { file_path?: unknown }).file_path
        : undefined;
    if (typeof raw !== 'string') return { continue: true };
    if (friendlyFile(raw) === null) return { continue: true };

    const relative = raw.replace(/\\/g, '/').replace(/^.*?growth-engine\//, '');
    deps.onFileWritten(relative);
    if (relative === 'founder-brain.md') deps.onBrainChanged();
    return { continue: true };
  };
}

/**
 * Fires just before the SDK compacts. The checkpoint itself happens on the
 * compact_boundary message in runner.ts, because that message carries the
 * token counts worth logging and this hook does not.
 */
export function preCompact(deps: HookDeps) {
  return async (input: PreCompactInput): Promise<HookOutput> => {
    deps.onCompactStarting(input.trigger);
    return { continue: true };
  };
}
