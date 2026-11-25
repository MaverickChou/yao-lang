import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evalExpr } from '../src/eval.js';

const suite = JSON.parse(
  readFileSync(new URL('../conformance/core.json', import.meta.url), 'utf8')
);

for (const c of suite.cases) {
  test(`conformance: ${c.name}`, () => {
    const val = evalExpr(c.expr);
    assert.equal(val.v, c.expect, `${c.expr} 应为 ${c.expect}`);
    if (c.type) assert.equal(val.t, c.type);
  });
}
