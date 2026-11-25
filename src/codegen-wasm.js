/**
 * 爻 · WASM 后端（部分求值）
 *
 * 不做表达式编译。状态空间只有 4096，构建时用解释器把整张转移表算出来，
 * 生成的 .wasm 里只有一个查表函数。
 *
 *   init() -> i32                    起始状态
 *   step(state, ev, arg) -> i32      新状态；-1 表示该事件在此态无定义
 *
 * 表布局：
 *   偏移 0         : 每个事件 2 字节 [colBase, colStride]
 *   偏移 2*E       : 4096 行 × COLS 列 × 2 字节（小端 u16，0xFFFF = 未定义）
 *
 * 带参数的事件占 6 列（arg 1..6）；不带参数的占 1 列。
 */

import { ben } from './core.js';
import { evalAst } from './evalast.js';
import { groupRules } from './ir.js';

const STATE_SPACE = 4096;
const NONE = 0xffff;

// ---------------------------------------------------------------- 二进制编码

const uleb = (n) => {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
};

const sleb = (n) => {
  const out = [];
  let v = n | 0;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) {
      out.push(b);
      break;
    }
    out.push(b | 0x80);
  }
  return out;
};

const vec = (items) => [...uleb(items.length), ...items.flat()];
const section = (id, body) => [id, ...uleb(body.length), ...body];

// ---------------------------------------------------------------- 表

/** 每一列的 [事件, 参数] */
function columns(ir) {
  const cols = [];
  for (const ev of ir.events) {
    if (ev.param) for (let a = 1; a <= 6; a++) cols.push([ev, a]);
    else cols.push([ev, 0]);
  }
  return cols;
}

function buildTable(ir) {
  const groups = groupRules(ir);
  const cols = columns(ir);
  const table = new Uint16Array(STATE_SPACE * cols.length).fill(NONE);

  for (let s = 0; s < STATE_SPACE; s++) {
    for (let c = 0; c < cols.length; c++) {
      const [ev, arg] = cols[c];
      const g = groups.get(ev.name);
      const rule = g.specific.get(ben(s)) ?? g.wildcard;
      if (!rule) continue;
      try {
        const to = evalAst(rule.target, {
          ben: ben(s),
          state: s,
          params: ev.param ? { [ev.param]: arg } : {},
          consts: ir.consts,
        });
        if (Number.isInteger(to) && to >= 0 && to <= 0xfff) {
          table[s * cols.length + c] = to;
        }
      } catch {
        /* 留作 NONE */
      }
    }
  }
  return { cols, table, colsCount: cols.length };
}

/** 每个事件的 [colBase, colStride] */
function eventMeta(ir) {
  const meta = [];
  let base = 0;
  for (const ev of ir.events) {
    if (ev.param) {
      meta.push([base, 1]);
      base += 6;
    } else {
      meta.push([base, 0]);
      base += 1;
    }
  }
  return { meta, cols: base };
}

// ---------------------------------------------------------------- 模块

export class WasmCodegenError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'WasmCodegenError';
    this.code = 'Y0600';
  }
}

/**
 * @param {object} ir
 * @returns {Uint8Array}
 */
export function emitWasm(ir) {
  if (ir.grouped) throw new WasmCodegenError('WASM 后端暂不支持组机器');

  const { meta } = eventMeta(ir);
  const { table, colsCount } = buildTable(ir);

  const metaBytes = meta.flat(); // 每个事件 2 字节
  const tableBase = metaBytes.length;
  const data = new Uint8Array(tableBase + table.length * 2);
  data.set(metaBytes, 0);
  for (let i = 0; i < table.length; i++) {
    data[tableBase + i * 2] = table[i] & 0xff;
    data[tableBase + i * 2 + 1] = (table[i] >> 8) & 0xff;
  }

  const pages = Math.max(1, Math.ceil(data.length / 65536));

  // ---- 类型：(i32) 与 (i32,i32,i32) -> i32
  const typeSec = section(1, vec([
    [0x60, ...uleb(0), ...uleb(1), 0x7f],
    [0x60, ...uleb(3), 0x7f, 0x7f, 0x7f, ...uleb(1), 0x7f],
  ]));

  const funcSec = section(3, vec([[0], [1]]));
  const memSec = section(5, vec([[0x00, ...uleb(pages)]]));

  const name = (s) => [...uleb(s.length), ...[...s].map((c) => c.charCodeAt(0))];
  const exportSec = section(7, vec([
    [...name('init'), 0x00, 0],
    [...name('step'), 0x00, 1],
    [...name('memory'), 0x02, 0],
  ]));

  // ---- init 函数体
  const bodyInit = [...uleb(0), 0x41, ...sleb(ir.start.value), 0x0b];

  // ---- step 函数体
  const COLS = colsCount;
  const body = [
    ...uleb(1), 1, 0x7f, // 一个 i32 局部变量（第 3 号）
    // state * COLS
    0x20, 0, 0x41, ...sleb(COLS), 0x6c,
    // + meta[(ev-1)*2]
    0x20, 1, 0x41, ...sleb(1), 0x6b, 0x41, ...sleb(2), 0x6c,
    0x2d, 0x00, 0x00, // i32.load8_u align0 offset0
    0x6a,
    // + stride * (arg-1)
    0x20, 1, 0x41, ...sleb(1), 0x6b, 0x41, ...sleb(2), 0x6c,
    0x41, ...sleb(1), 0x6a, 0x2d, 0x00, 0x00,
    0x20, 2, 0x41, ...sleb(1), 0x6b, 0x6c,
    0x6a,
    // * 2 + tableBase
    0x41, ...sleb(2), 0x6c,
    0x41, ...sleb(tableBase), 0x6a,
    0x2f, 0x01, 0x00, // i32.load16_u align1 offset0
    0x22, 3, // local.tee 3
    0x41, ...sleb(NONE), 0x46, // == NONE
    0x04, 0x7f, // if (result i32)
    0x41, ...sleb(-1),
    0x05, // else
    0x20, 3,
    0x0b, // end if
    0x0b, // end function
  ];

  const codeSec = section(10, vec([
    [...uleb(bodyInit.length), ...bodyInit],
    [...uleb(body.length), ...body],
  ]));

  const dataSec = section(11, vec([
    [0x00, 0x41, ...sleb(0), 0x0b, ...uleb(data.length), ...data],
  ]));

  const bytes = [
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    ...typeSec, ...funcSec, ...memSec, ...exportSec, ...codeSec, ...dataSec,
  ];

  return { bytes: new Uint8Array(bytes), meta: { cols: COLS, states: STATE_SPACE, tableBytes: data.length } };
}
