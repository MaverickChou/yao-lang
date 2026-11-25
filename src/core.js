/**
 * 爻 · 核心值类型与位运算
 *
 * 位布局（SPEC.md §2，全语言的宪法）：
 *   bit0 = 初爻（最下） … bit5 = 上爻（最上）
 *   卦 = 6 位；下卦 = bits0..2，上卦 = bits3..5
 *   变 = 12 位：低 6 位 本，高 6 位 动；之 = 本 ^ 动
 *
 * 本模块零依赖（除读取 data/hexagrams.json），可单独移植到任何语言。
 */

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- 常量

export const GUA_MASK = 0x3f;   // 6 位
export const BIAN_MASK = 0xfff; // 12 位

/** 爻名，索引 1..6（下标 0 占位） */
export const POS_NAMES = [null, '初', '二', '三', '四', '五', '上'];

/** 四象：6 老阴 / 7 少阳 / 8 少阴 / 9 老阳 */
export const SI_XIANG = {
  6: { name: '老阴', yang: false, moving: true, mark: '×' },
  7: { name: '少阳', yang: true, moving: false, mark: '' },
  8: { name: '少阴', yang: false, moving: false, mark: '' },
  9: { name: '老阳', yang: true, moving: true, mark: '○' },
};

// ---------------------------------------------------------------- 位运算

/** 本卦：变的低 6 位 */
export const ben = (x) => x & GUA_MASK;

/** 动爻掩码：变的高 6 位 */
export const dong = (x) => (x >> 6) & GUA_MASK;

/** 之卦 = 本 ^ 动。恒等式：本 ^ 动 ^ 之 = 0 */
export const zhi = (x) => ben(x) ^ dong(x);

/** 由 (本, 动) 构造变，强制不变式 */
export const bian = (b, d) => ((d & GUA_MASK) << 6) | (b & GUA_MASK);

/** 静：丢弃动爻，把变投影为卦（可能触发 Y0102 警告） */
export const jing = (x) => ben(x);

/** 错：六爻全变 */
export const cuo = (x) => (x & GUA_MASK) ^ GUA_MASK;

/** 综：爻序倒转（bit0 <-> bit5） */
export function zong(x) {
  const v = x & GUA_MASK;
  return (
    ((v & 0b000001) << 5) |
    ((v & 0b000010) << 3) |
    ((v & 0b000100) << 1) |
    ((v & 0b001000) >> 1) |
    ((v & 0b010000) >> 3) |
    ((v & 0b100000) >> 5)
  );
}

/** 互：下互取 2/3/4 爻，上互取 3/4/5 爻 */
export const hu = (x) => {
  const v = x & GUA_MASK;
  return ((v >> 1) & 0b111) | (((v >> 2) & 0b111) << 3);
};

/** popcount，用于 变数 */
export function popcount(v) {
  let n = 0;
  let x = v & GUA_MASK;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/** 变数：动爻个数 0..6 */
export const bianShu = (x) => popcount(dong(x));

/** 当位爻数：奇数位宜阳，偶数位宜阴 */
export function dangWei(x) {
  let n = 0;
  const v = x & GUA_MASK;
  for (let p = 1; p <= 6; p++) {
    const want = p % 2 === 1 ? 1 : 0;
    if (((v >> (p - 1)) & 1) === want) n++;
  }
  return n;
}

/**
 * 取第 pos 爻的四象记数（1..6，自初爻起）。
 * @returns {6|7|8|9}
 */
export function yaoOf(x, pos) {
  if (!Number.isInteger(pos) || pos < 1 || pos > 6) {
    throw new RangeError(`爻位必须在 1..6，收到 ${pos}`);
  }
  const yang = (ben(x) >> (pos - 1)) & 1;
  const moving = (dong(x) >> (pos - 1)) & 1;
  if (yang) return moving ? 9 : 7;
  return moving ? 6 : 8;
}

// ---------------------------------------------------------------- 爻串

/**
 * 由爻串构造变。规范形式：6 个字符，自初爻至上爻，取值 6/7/8/9。
 * @param {string} s
 * @returns {number} 12 位变
 */
export function fromDigits(s) {
  if (typeof s !== 'string' || !/^[6-9]{6}$/.test(s)) {
    throw new SyntaxError(`非法爻串 "${s}"：必须是 6 个 6/7/8/9 字符（Y0001）`);
  }
  let b = 0;
  let d = 0;
  for (let i = 0; i < 6; i++) {
    const yang = s[i] === '7' || s[i] === '9';
    const moving = s[i] === '6' || s[i] === '9';
    if (yang) b |= 1 << i;
    if (moving) d |= 1 << i;
  }
  return bian(b, d);
}

/** 变 -> 爻串（规范形式，可 round-trip） */
export function toDigits(x) {
  let s = '';
  for (let p = 1; p <= 6; p++) s += String(yaoOf(x, p));
  return s;
}

// ---------------------------------------------------------------- 卦表

const DATA_URL = new URL('../data/hexagrams.json', import.meta.url);

let DATA;
try {
  DATA = JSON.parse(readFileSync(DATA_URL, 'utf8'));
} catch (err) {
  throw new Error(
    `无法读取 ${DATA_URL.pathname}。请先运行 python tools/gen_hexagrams.py 生成卦表。\n${err.message}`
  );
}

/** 64 条元数据，按文王序 */
export const HEXAGRAMS = DATA.hexagrams;

/** id (0..63) -> 元数据 */
export const BY_ID = new Array(64);
/** 规范名 -> 元数据 */
export const BY_NAME = new Map();

for (const h of HEXAGRAMS) {
  BY_ID[h.id] = h;
  BY_NAME.set(h.name, h);
}

/** 别名 -> 规范名 */
export const ALIASES = new Map();
for (const h of HEXAGRAMS) {
  for (const a of h.alias || []) ALIASES.set(a, h.name);
}

/** 词法器用的最长匹配表：所有可接受的卦名写法，按长度降序 */
export const NAME_TOKENS = [
  ...new Set([...BY_NAME.keys(), ...ALIASES.keys()]),
].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

/** 卦象字符 (U+4DC0..U+4DFF) -> id */
export const GLYPH_TO_ID = new Map();
for (const h of HEXAGRAMS) GLYPH_TO_ID.set(h.glyph, h.id);

/** 取规范名 */
export function nameOf(x) {
  return BY_ID[ben(x)].name;
}

/** 取卦象字符 */
export function glyphOf(x) {
  return BY_ID[ben(x)].glyph;
}

/** 取元数据 */
export function meta(x) {
  return BY_ID[ben(x)];
}

/**
 * 序：先天返回 0..63（即卦值本身），文王返回 1..64。
 * @param {number} x 变或卦
 * @param {'先天'|'文王'} method
 */
export function xu(x, method = '先天') {
  if (method === '先天') return ben(x);
  if (method === '文王') return BY_ID[ben(x)].order;
  throw new RangeError(`未知序法 "${method}"，只支持 先天 / 文王`);
}

// ---------------------------------------------------------------- 渲染

const ART = {
  unicode: { yang: '▅▅▅▅▅', yin: '▅▅ ▅▅' },
  ascii: { yang: '=====', yin: '== ==' },
};

/**
 * 渲染六爻图，自上（上爻）而下（初爻）。
 * @param {number} x 变
 * @param {{ascii?: boolean, labels?: boolean}} [opts]
 * @returns {string[]}
 */
export function renderLines(x, opts = {}) {
  const { ascii = false, labels = true } = opts;
  const art = ascii ? ART.ascii : ART.unicode;
  const out = [];
  for (let p = 6; p >= 1; p--) {
    const y = yaoOf(x, p);
    const sx = SI_XIANG[y];
    const bar = sx.yang ? art.yang : art.yin;
    const mark = sx.moving ? ' ' + sx.mark : '';
    out.push(labels ? `${POS_NAMES[p]} ${bar}${mark}` : `${bar}${mark}`);
  }
  return out;
}

/** 一行摘要：名 卦象 变数 本/动/之 */
export function summary(x, opts = {}) {
  const a = nameOf(x);
  const b = nameOf(zhi(x));
  const n = bianShu(x);
  const rel = n === 0 ? `静卦` : `${n} 爻动`;
  return `${a} → ${b}　${rel}　[${toDigits(x)}]`;
}
