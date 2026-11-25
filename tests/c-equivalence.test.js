/**
 * 轨迹等价：同一组事件序列，解释器与生成的 C **必须**得到同一条 `变` 轨迹。
 *
 * 这是 C 后端唯一可信的验收标准（SPEC.md §14.3）。
 * 找不到 C 编译器时整组跳过并标记为 skip —— 不允许假装通过。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { Machine } from '../src/interp.js';
import { emitC } from '../src/codegen-c.js';
import { findCc, compile, runBinary, parseStates } from '../src/cc.js';

const CC = findCc();
const maybe = CC ? test : test.skip;

const DUNGEON = readFileSync(
  new URL('../examples/gua-jing/gua_jing.yao', import.meta.url),
  'utf8'
);

const TURNSTILE = `
机 闸机 {
  事 投币
  事 通过
  态 闲   = 坤
  态 放行 = 复
  转 闲   投币 -> 放行
  转 放行 通过 -> 闲
  起 闲
}`;

const MATCHED = `
机 分发 {
  事 走(位 n)
  态 甲 = 泰/111111
  转 * 走 -> 合 变数(变) {
    0 => 坤,
    6 => 乾,
    _ => 变(本 ^ (1 << (n - 1)), 1 << (n - 1))
  }
  起 甲
}`;

/**
 * 编译并运行，返回 C 侧的轨迹。
 * @param {string} src 爻源码
 * @param {[string, number][]} script 事件序列
 */
function runInC(src, script) {
  const ir = buildIr(parse(src));
  const code = emitC(ir, { emitMain: true });

  // 关键：编译必须发生在纯 ASCII 路径下，否则 MinGW 的 ld 会找不到 crt2.o
  const dir = mkdtempSync(join(tmpdir(), 'yao-cc-'));
  try {
    const cPath = join(dir, 'm.c');
    const exePath = join(dir, process.platform === 'win32' ? 'm.exe' : 'm');
    writeFileSync(cPath, code, 'utf8');

    const build = compile(CC, cPath, exePath);
    assert.ok(build.ok, `编译失败:\n${build.stderr}`);

    // 事件名 → 序号（C 侧 EV_i = i+1）
    const index = new Map(ir.events.map((e, i) => [e.name, i + 1]));
    const stdin = script.map(([ev, arg]) => `${index.get(ev)} ${arg}`).join('\n') + '\nq\n';

    const run = runBinary(exePath, stdin);
    assert.ok(run.ok, `运行失败:\n${run.stderr}`);
    return { states: parseStates(run.stdout), ir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 解释器侧的轨迹 */
function runInJs(src, script) {
  const ir = buildIr(parse(src));
  const m = new Machine(ir);
  const states = [m.state];
  for (const [ev, arg] of script) {
    const r = m.step(ev, arg ?? 0);
    assert.ok(r.ok, `${ev} 在解释器里无法转移：${r.reason}`);
    states.push(m.state);
  }
  return states;
}

function check(name, src, script) {
  maybe(name, () => {
    const expected = runInJs(src, script);
    const got = runInC(src, script);
    assert.equal(got.states.length, expected.length, '轨迹长度不一致');
    for (let i = 0; i < expected.length; i++) {
      assert.equal(
        got.states[i],
        expected[i],
        `第 ${i} 步：C=${got.states[i].toString(16)} 解释器=${expected[i].toString(16)}`
      );
    }
  });
}

// ---------------------------------------------------------------- 用例

check('C 与解释器一致：闸机（态特化规则）', TURNSTILE, [
  ['投币', 0],
  ['通过', 0],
  ['投币', 0],
]);

check('C 与解释器一致：地牢（通配规则 + 参数）', DUNGEON, [
  ['行', 1],
  ['行', 2],
  ['错卦', 0],
  ['综卦', 0],
  ['互卦', 0],
  ['行', 6],
]);

check('C 与解释器一致：合 分发', MATCHED, [
  ['走', 1],
  ['走', 3],
  ['走', 5],
]);

check('C 与解释器一致：地牢随机长走', DUNGEON, (() => {
  // 用固定序列覆盖全部四类事件各若干次
  const seq = [];
  for (let i = 0; i < 12; i++) {
    seq.push(['行', (i % 6) + 1]);
    if (i % 3 === 0) seq.push(['错卦', 0]);
    if (i % 4 === 0) seq.push(['综卦', 0]);
    if (i % 5 === 0) seq.push(['互卦', 0]);
  }
  return seq;
})());
