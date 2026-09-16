import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { canonicalize, emptyBrain, validateBrain } from './domain.ts';

test('canonical FounderBrain bytes are stable and accepted only after section requirements hold', () => {
  const brain = emptyBrain();
  const a = canonicalize(brain);
  const b = canonicalize(JSON.parse(JSON.stringify(brain)));
  assert.equal(a, b);
  assert.equal(createHash('sha256').update(a).digest('hex').length, 64);
  assert.throws(() => validateBrain({ ...brain, identity: { ...brain.identity, approved: true } }), { code: 'incomplete_section' });
});
