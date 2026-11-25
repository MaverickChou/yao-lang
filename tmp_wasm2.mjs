import { readFileSync } from 'node:fs';
import { parse } from './src/parse.js';
import { buildIr } from './src/ir.js';
import { emitWasm } from './src/codegen-wasm.js';
import { Machine } from './src/interp.js';

const ir = buildIr(parse(readFileSync('examples/gua-jing/gua_jing.yao', 'utf8')));
const { bytes, meta } = emitWasm(ir);
console.log('wasm', bytes.length, 'bytes', meta);

const { init, step } = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
let s = init();
const m = new Machine(ir);
let st = m.state;
let bad = 0;
const seq = [];
for (let i = 0; i < 40; i++) {
  const ev = ir.events[i % 4];
  const arg = ev.param ? (i % 6) + 1 : 0;
  seq.push([ev.name, arg]);
}
for (const [name, arg] of seq) {
  const idx = ir.events.findIndex(e => e.name === name) + 1;
  const r = m.step(name, arg);
  const w = step(st, idx, arg);
  const expect = r.ok ? r.to : -1;
  if (w !== expect) { bad++; console.log('MISMATCH', name, arg, 'js=', expect, 'wasm=', w); }
  if (r.ok) st = r.to;
}
console.log('40 步比对，不一致', bad, ' 最终', st);
