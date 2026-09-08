/**
 * hooks.test.ts
 *
 * WHAT: Tests that PreToolUse fences every file tool call to one founder's own
 *       folder, and that the other two hooks still do what they always did.
 *
 * WHY IT EXISTS: Every founder's folder lives on the same disk, under
 *       /tmp/ge/<ulid>/, and the tool surface (Read, Write, Edit, Glob, Grep)
 *       runs with permissionMode: 'bypassPermissions' and no shell. cwd is set
 *       to one founder's folder but does not stop an absolute path reaching a
 *       tool, and an uploaded document is how a path other than the founder's
 *       own gets in front of the model. This is the test that says a path
 *       outside the founder's folder is refused, not merely that it looks
 *       refused.
 *
 * RUN: node --import tsx --test src/server/agent/hooks.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preToolUse, type HookDeps, type PreToolUseInput } from './hooks.js';

const founderRoot = '/tmp/ge/01ARZ3NDEKTSV4RRFFQ69G5FAV';

function deps(): HookDeps {
  return {
    onFileWritten: () => {},
    onBrainChanged: () => {},
    onCompactStarting: () => {},
    founderRoot,
  };
}

function input(toolName: string, toolInput: unknown): PreToolUseInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'toolu_test',
  };
}

function assertAllowed(output: { continue: boolean; hookSpecificOutput?: unknown }): void {
  assert.equal(output.continue, true);
  assert.equal(output.hookSpecificOutput, undefined);
}

function assertDenied(output: {
  continue: boolean;
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
}): void {
  assert.equal(output.continue, true, 'a denial must not end the whole turn');
  assert.equal(output.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(
    typeof output.hookSpecificOutput?.permissionDecisionReason === 'string' &&
      output.hookSpecificOutput.permissionDecisionReason.length > 0,
  );
}

test('Read with a relative path inside is allowed', async () => {
  const hook = preToolUse(deps());
  const out = await hook(input('Read', { file_path: 'growth-engine/founder-brain.md' }));
  assertAllowed(out);
});

test('Read with an absolute path inside founderRoot is allowed', async () => {
  const hook = preToolUse(deps());
  const out = await hook(
    input('Read', { file_path: `${founderRoot}/growth-engine/founder-brain.md` }),
  );
  assertAllowed(out);
});

test('Read with an absolute path in another founder folder is denied', async () => {
  const hook = preToolUse(deps());
  const other = '/tmp/ge/01BRZ3NDEKTSV4RRFFQ69G5FAV/growth-engine/founder-brain.md';
  const out = await hook(input('Read', { file_path: other }));
  assertDenied(out);
});

test('Read of /etc/passwd is denied', async () => {
  const hook = preToolUse(deps());
  const out = await hook(input('Read', { file_path: '/etc/passwd' }));
  assertDenied(out);
});

test('Read of /proc/self/environ is denied', async () => {
  const hook = preToolUse(deps());
  const out = await hook(input('Read', { file_path: '/proc/self/environ' }));
  assertDenied(out);
});

test('a .. traversal escaping the root is denied', async () => {
  const hook = preToolUse(deps());
  const out = await hook(input('Read', { file_path: '../../../etc/passwd' }));
  assertDenied(out);
});

test('Glob with an absolute cross founder pattern is denied', async () => {
  const hook = preToolUse(deps());
  const out = await hook(
    input('Glob', { pattern: '/tmp/ge/*/growth-engine/people/*.md' }),
  );
  assertDenied(out);
});

test('Grep with a path array where one entry is outside is denied', async () => {
  const hook = preToolUse(deps());
  const out = await hook(
    input('Grep', {
      pattern: 'sam@example.com',
      path: [`${founderRoot}/growth-engine/people`, '/tmp/ge/01OTHERFOUNDER/growth-engine'],
    }),
  );
  assertDenied(out);
});

test('a sibling directory sharing a name prefix is denied', async () => {
  const hook = preToolUse(deps());
  const out = await hook(input('Read', { file_path: `${founderRoot}-other/founder-brain.md` }));
  assertDenied(out);
});

test('a non file tool with an outside looking path is allowed, untouched', async () => {
  const hook = preToolUse(deps());
  const out = await hook(
    input('mcp__ge__remember', { path: '/tmp/ge/01OTHERFOUNDER/growth-engine/founder-brain.md' }),
  );
  assertAllowed(out);
});

test('a tool_input with no candidate path at all is allowed', async () => {
  const hook = preToolUse(deps());
  const out = await hook(input('Grep', { multiline: true }));
  assertAllowed(out);
});

test('a non object tool_input is allowed', async () => {
  const hook = preToolUse(deps());
  const out = await hook(input('Read', 'not an object'));
  assertAllowed(out);
});
