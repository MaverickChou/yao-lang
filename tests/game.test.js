import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { makeStepper, par, flippedLines, LEVELS } from '../src/game.js';
import { BY_NAME, ben } from '../src/core.js';

const id = (n) => BY_NAME.get(n).id;
const IR = buildIr(
  parse(readFileSync(new URL('../examples/yao-zhen/yao_zhen.yao', import.meta.url), 'utf8'))
);
const step = makeStepper(IR);

// ---------------------------------------------------------------- 规则

test('爻阵：中间四爻各牵动三爻，首末各牵动两爻', () => {
  assert.deepEqual(flippedLines(1), [1, 2]);
  assert.deepEqual(flippedLines(2), [1, 2, 3]);
  assert.deepEqual(flippedLines(3), [2, 3, 4]);
  assert.deepEqual(flippedLines(4), [3, 4, 5]);
  assert.deepEqual(flippedLines(5), [4, 5, 6]);
  assert.deepEqual(flippedLines(6), [5, 6]);
});

test('爻阵：按 n 确实翻转了 n-1, n, n+1', () => {
  for (const start of [id('未济'), id('乾'), id('泰')]) {
    for (let n = 1; n <= 6; n++) {
      const to = step(start, n);
      const diff = start ^ to;
      const want = flippedLines(n).reduce((m, p) => m | (1 << (p - 1)), 0);
      assert.equal(diff, want, `从 ${start} 按 ${n} 的翻转掩码不对`);
    }
  }
});

test('爻阵：同一爻按两次回到原处', () => {
  for (let n = 1; n <= 6; n++) {
    assert.equal(step(step(id('屯'), n), n), id('屯'));
  }
});

test('爻阵：从任一卦出发，64 卦全部可达', () => {
  for (const start of [id('未济'), id('乾'), id('剥')]) {
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const b = q.shift();
      for (let n = 1; n <= 6; n++) {
        const t = step(b, n);
        if (!seen.has(t)) { seen.add(t); q.push(t); }
      }
    }
    assert.equal(seen.size, 64);
  }
});

// ---------------------------------------------------------------- 步数

test('par：原地为 0', () => {
  for (const n of ['乾', '泰', '既济']) assert.equal(par(step, id(n), id(n)), 0);
});

test('par 与 BFS 一致（抽样）', () => {
  for (const [a, b] of [['未济', '泰'], ['乾', '坤'], ['屯', '既济'], ['谦', '大有']]) {
    const d = par(step, id(a), id(b));
    assert.ok(d !== null && d > 0, `${a}→${b} 应可达`);
    assert.ok(d <= 8, `${a}→${b} 的步数 ${d} 不合理`);
  }
});

test('par：未济到泰为 4 步', () => {
  assert.equal(par(step, id('未济'), id('泰')), 4);
});

test('每一关的目标都从起点可解', () => {
  let cur = ben(IR.start.value);
  for (const lv of LEVELS) {
    const d = par(step, cur, id(lv.target));
    assert.ok(d !== null, `目标 ${lv.target} 不可达`);
    cur = id(lv.target);
  }
});

test('关卡列表：六个目标互不相同，末关是既济', () => {
  const names = LEVELS.map((l) => l.target);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.at(-1), '既济');
});
