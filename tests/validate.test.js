import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { analyze } from '../src/validate.js';
import { BY_NAME } from '../src/core.js';

const id = (n) => BY_NAME.get(n).id;
const DUNGEON = readFileSync(
  new URL('../examples/gua-jing/gua_jing.yao', import.meta.url),
  'utf8'
);
const an = (src) => analyze(buildIr(parse(src)));

// ---------------------------------------------------------------- 地牢

test('地牢：64 个房间全部可达', () => {
  const a = an(DUNGEON);
  assert.equal(a.declaredCount, 64);
  assert.equal(a.reachableDeclared, 64);
  assert.deepEqual(a.unreachableStates, []);
});

test('地牢：可达态恰好 512 = 64 房间 × 8 种动爻', () => {
  const a = an(DUNGEON);
  assert.equal(a.reachableCount, 512);
});

test('地牢：没有死态，也没有未定义转移', () => {
  const a = an(DUNGEON);
  assert.deepEqual(a.deadStates, []);
  assert.equal(a.undefined.count, 0);
});

test('地牢：整图强连通，直径 4', () => {
  const a = an(DUNGEON);
  assert.equal(a.scc.count, 1);
  assert.equal(a.stronglyConnected, true);
  assert.equal(a.diameter, 4);
});

test('地牢：未济 一步到 既济，三步到 乾', () => {
  const a = an(DUNGEON);
  assert.equal(a.distances.get(id('既济')), 1);
  assert.equal(a.distances.get(id('乾')), 3);
  // 未济 →行2→ 晋 →行4→ 剥 →行6→ 坤
  assert.equal(a.distances.get(id('坤')), 3);
  assert.equal(a.distances.get(id('未济')), 0);
});

test('地牢：每个房间都有距离，且不超过 3', () => {
  const ir = buildIr(parse(DUNGEON));
  const a = analyze(ir);
  for (const s of ir.states.values()) {
    const d = a.distances.get(s.ben);
    assert.ok(d !== undefined, `${s.name} 不可达`);
    assert.ok(d <= 3, `${s.name} 距离 ${d} 超过 3`);
  }
});

// ---------------------------------------------------------------- 缺陷检出

const DEAD = `
机 死 {
  事 走
  态 甲 = 乾
  态 乙 = 坤
  转 甲 走 -> 乙
  起 甲
}`;

test('检出死态 Y0204', () => {
  const a = an(DEAD);
  assert.equal(a.deadStates.length, 1);
  assert.equal(a.deadStates[0], id('坤'));
});

test('检出未定义转移', () => {
  const a = an(DEAD);
  assert.equal(a.undefined.count, 1);
  assert.equal(a.undefined.sample[0].name, '坤');
  assert.equal(a.undefined.sample[0].event, '走');
});

test('检出不可达态 Y0203', () => {
  const a = an(`
机 孤 {
  事 走
  态 甲 = 乾
  态 乙 = 坤
  态 丙 = 泰
  转 甲 走 -> 乙
  转 乙 走 -> 甲
  起 甲
}`);
  assert.deepEqual(a.unreachableStates.map((s) => s.name), ['丙']);
  assert.equal(a.reachableDeclared, 2);
});

test('检出多分量（非强连通）', () => {
  const a = an(DEAD);
  assert.equal(a.stronglyConnected, false);
  assert.equal(a.scc.count, 2);
});

test('全部态都有出边时没有死态', () => {
  const a = an(`
机 全 {
  事 走
  态 甲 = 乾
  态 乙 = 坤
  转 * 走 -> 变(错(本), 0)
  起 甲
}`);
  assert.deepEqual(a.deadStates, []);
  assert.equal(a.undefined.count, 0);
  assert.equal(a.diameter, 1);
});

test('参数化事件按 1..6 全部枚举', () => {
  const a = an(`
机 参 {
  事 行(位 n)
  态 甲 = 乾
  转 * 行 -> 变(本 ^ (1 << (n - 1)), 0)
  起 甲
}`);
  // 从 111111 可以到达任何一个只差一爻的状态，再扩散即覆盖全部 64 卦
  assert.equal(a.reachableDeclared, 1);
  assert.equal(a.undefined.count, 0);
  assert.equal(a.reachableCount, 64);
});
