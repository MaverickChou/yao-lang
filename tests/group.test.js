import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { Machine } from '../src/interp.js';
import { analyze } from '../src/validate.js';
import { emitC, emitHeader } from '../src/codegen-c.js';

const DUO = `
机 双门 {
  事 前投币
  事 后投币
  事 通过

  组 前 {
    关 = 坤
    开 = 复
  }
  组 后 {
    关 = 泰
    开 = 否
  }

  转 前.关 前投币 -> 前.开
  转 前.开 通过   -> 前.关
  转 后.关 后投币 -> 后.开
  起 前.关, 后.关
}`;

const ir = () => buildIr(parse(DUO));

// ---------------------------------------------------------------- 结构

test('组：两个组件，状态空间 64^2', () => {
  const g = ir();
  assert.equal(g.grouped, true);
  assert.equal(g.components.length, 2);
  assert.deepEqual(g.startVals, [0, 7]); // 坤、泰
  assert.equal(g.states.size, 4);
});

test('组：事件在编译期绑定到组件', () => {
  const g = ir();
  const byEvent = new Map(g.rules.map((r) => [r.event, r.comp]));
  assert.equal(byEvent.get('前投币'), 0);
  assert.equal(byEvent.get('后投币'), 1);
  assert.equal(byEvent.get('通过'), 0);
});

test('组：同一事件出现在两个组件里要报错', () => {
  const bad = DUO.replace('转 后.关 后投币 -> 后.开', '转 后.关 通过 -> 后.开');
  assert.throws(() => buildIr(parse(bad)), (e) => e.code === 'Y0202');
});

test('组：不支持 * 源态', () => {
  const bad = DUO.replace('转 前.关 前投币 -> 前.开', '转 * 前投币 -> 前.开');
  assert.throws(() => buildIr(parse(bad)), (e) => e.code === 'Y0202');
});

test('组：与 态 不能混用', () => {
  const bad = DUO.replace('组 后 {', '态 多余 = 泰\n  组 后 {');
  assert.throws(() => buildIr(parse(bad)), (e) => e.code === 'Y0010');
});

test('组：成员必须是 0..63 的卦', () => {
  const bad = DUO.replace('关 = 泰', '关 = 变(泰, 1)');
  assert.throws(() => buildIr(parse(bad)), (e) => e.code === 'Y0101');
});

test('组：同一组件内两个成员本卦相同要报错', () => {
  const bad = DUO.replace('开 = 复', '开 = 坤');
  assert.throws(() => buildIr(parse(bad)), (e) => e.code === 'Y0101');
});

test('组：起点必须每个组件一个', () => {
  const bad = DUO.replace('起 前.关, 后.关', '起 前.关');
  assert.throws(() => buildIr(parse(bad)), (e) => e.code === 'Y0205');
});

// ---------------------------------------------------------------- 运行

test('组：转移只动所属组件', () => {
  const m = new Machine(ir());
  assert.deepEqual(m.states, [0, 7]);

  assert.equal(m.step('前投币').ok, true);
  assert.deepEqual(m.states, [1, 7], '只动组件 0');

  assert.equal(m.step('后投币').ok, true);
  assert.deepEqual(m.states, [1, 56], '只动组件 1');

  assert.equal(m.step('通过').ok, true);
  assert.deepEqual(m.states, [0, 56]);

  const r = m.step('通过');
  assert.equal(r.ok, false, '前.关 没有 通过 规则');
  assert.deepEqual(m.states, [0, 56], '失败不改状态');
});

test('组：验证器在 64^N 上穷举', () => {
  const a = analyze(ir());
  assert.equal(a.grouped, true);
  assert.equal(a.stateSpace, 4096);
  assert.equal(a.reachableCount, 4);
  assert.equal(a.reachableDeclared, 4);
  assert.deepEqual(a.deadStates, []);
  // 前.关 收到 通过、后.关 收到 通过 等都无定义
  assert.ok(a.undefined.count > 0);
});

// ---------------------------------------------------------------- C 后端

test('组：C 后端每个组件一个字', () => {
  const c = emitC(ir());
  assert.match(c, /#define YAO_COMPONENTS 2u/);
  assert.match(c, /void yao_init\(uint16_t \*s\) \{\n  s\[0\] = 0x00u;\n  s\[1\] = 0x07u;\n\}/);
  assert.match(c, /switch \(YAO_BEN\(s\[0\]\)\)/);
  assert.match(c, /switch \(YAO_BEN\(s\[1\]\)\)/);
  assert.match(c, /int yao_step\(uint16_t \*s, uint16_t ev, uint8_t p0\)/);

  let depth = 0;
  for (const ch of c) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, '花括号提前闭合');
  }
  assert.equal(depth, 0);
});

test('组：头文件给出组件数与各组件起点', () => {
  const h = emitHeader(ir());
  assert.match(h, /#define YAO_COMPONENTS 2u/);
  assert.match(h, /#define YAO_START_0 0x00u\s+\/\* 前 \*\//);
  assert.match(h, /#define YAO_START_1 0x07u\s+\/\* 后 \*\//);
});
