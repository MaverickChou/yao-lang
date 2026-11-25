import { readFileSync } from 'node:fs';
import { parse } from './src/parse.js';
import { buildIr } from './src/ir.js';
import { emitWasm } from './src/codegen-wasm.js';
import { Machine } from './src/interp.js';

const ir = buildIr(parse(readFileSync('examples/traffic/traffic.yao', 'utf8')));
const { bytes, meta } = emitWasm(ir);
console.log('wasm 字节数', bytes.length, meta);

const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
const { init, step } = inst.exports;

let s = init();
console.log('init', s);

const m = new Machine(ir);
let st = m.state;
for (const ev of ['秒','秒','行人','秒','秒']) {
  const idx = ir.events.findIndex(e => e.name === ev) + 1;
  const r = m.step(ev, 0);
  const w = step(st, idx, 0);
  console.log(ev, 'js=', r.ok ? r.to : null, 'wasm=', w, w === -1 ? '(none)' : '');
  if (r.ok) st = r.to;
}
