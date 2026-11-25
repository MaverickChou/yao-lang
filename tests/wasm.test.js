import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { Machine } from '../src/interp.js';
import { emitWasm, WasmCodegenError } from '../src/codegen-wasm.js';

const TRAFFIC = readFileSync(
  new URL('../examples/traffic/traffic.yao', import.meta.url),
  'utf8'
);
const DUNGEON = readFileSync(
  new URL('../examples/gua-jing/gua_jing.yao', import.meta.url),
  'utf8'
);

function instantiate(ir) {
  const { bytes, meta } = emitWasm(ir);
  const mod = new WebAssembly.Module(bytes);
  const inst = new WebAssembly.Instance(mod, {});
  return { ...inst.exports, bytes, meta };
}

/**
 * 同一组 (事件, 参数)，WASM 与解释器必须给出同一条轨迹。
 * @returns {number} 不一致的步数
 */
function compare(ir, script) {
  const { init, step } = instantiate(ir);
  let wasmState = init();

  const m = new Machine(ir);
  let jsState = m.state;
  let bad = 0;

  for (const [name, arg] of script) {
    const evIndex = ir.events.findIndex((e) => e.name === name) + 1;
    assert.ok(evIndex > 0, `未知事件 ${name}`);

    const r = m.step(name, arg ?? 0);
    const w = step(wasmState, evIndex, arg ?? 0);
    const expected = r.ok ? r.to : -1;

    if (w !== expected) {
      bad++;
      console.log(`不一致 ${name}(${arg}) js=${expected} wasm=${w}`);
    }
    if (r.ok) jsState = r.to;
    if (w !== -1) wasmState = w;
  }

  assert.equal(wasmState, jsState, '最终状态不一致');
  return bad;
}

test('WASM：产物是合法的 Wasm 模块', () => {
  const ir = buildIr(parse(TRAFFIC));
  const { bytes, meta } = emitWasm(ir);

  assert.ok(WebAssembly.validate(bytes), 'WASM 校验失败');
  assert.equal(bytes[0], 0x00);
  assert.equal(bytes[1], 0x61); // 'a'
  assert.equal(bytes[2], 0x73); // 's'
  assert.equal(bytes[3], 0x6d); // 'm'
  assert.equal(meta.states, 4096);
  assert.equal(meta.cols, 2);
});

test('WASM：交通灯 24 步与解释器逐位一致', () => {
  const ir = buildIr(parse(TRAFFIC));
  const script = [];
  for (let i = 1; i <= 24; i++) {
    script.push(['秒', 0]);
    if (i === 2) script.push(['行人', 0]);
  }
  assert.equal(compare(ir, script), 0);
});

test('WASM：带参数的地牢（9 列）也与解释器一致', () => {
  const ir = buildIr(parse(DUNGEON));
  const script = [];
  for (let i = 0; i < 60; i++) {
    const ev = ir.events[i % ir.events.length];
    script.push([ev.name, ev.param ? (i % 6) + 1 : 0]);
  }
  assert.equal(compare(ir, script), 0);
});

test('WASM：未定义转移返回 -1，且不改状态', () => {
  const src = `
机 空 {
  事 走
  态 甲 = 坤
  态 乙 = 泰
  转 甲 走 -> 乙
  起 甲
}`;
  const ir = buildIr(parse(src));
  const { init, step } = instantiate(ir);
  const s0 = init();
  assert.equal(step(s0, 1, 0), 7, '甲 → 乙');
  assert.equal(step(7, 1, 0), -1, '乙 没有出边');
});

test('WASM：起始态来自 YAO_START', () => {
  const ir = buildIr(parse(TRAFFIC));
  const { init } = instantiate(ir);
  assert.equal(init(), ir.start.value);
});

test('WASM：组机器明确报错，不静默降级', () => {
  const src = `
机 双 {
  事 a
  组 前 { 关 = 坤 开 = 复 }
  转 前.关 a -> 前.开
  起 前.关
}`;
  assert.throws(() => emitWasm(buildIr(parse(src))), WasmCodegenError);
});
