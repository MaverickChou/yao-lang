/**
 * 爻 · 占（标准库，不是语言特性）
 *
 * 分层（SPEC.md §11）：
 *   筮 —— 唯一的随机源，显式种子，同种子同结果
 *   断 —— 七分支纯函数，按 变数 分发
 *   辞 —— 纯数据，从 data/corpus.json 读，不进编译器
 *
 * 语言本身不出现任何卦辞；它只提供 `变` 和 `变数`。
 */

import { readFileSync } from 'node:fs';
import { BY_NAME, ben, dong, zhi, bianShu, nameOf, bian } from './core.js';

const CORPUS_URL = new URL('../data/corpus.json', import.meta.url);

let CACHE = null;

/** 读辞库（进程内缓存） */
export function loadCorpus() {
  if (!CACHE) {
    CACHE = JSON.parse(readFileSync(CORPUS_URL, 'utf8'));
  }
  return CACHE;
}

// ---------------------------------------------------------------- 筮

/** mulberry32：小、快、可复现 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 起卦。
 *
 * 金钱卦：每爻掷三枚，记背面数 k，爻 = 6 + k。
 *   P(6)=1/8, P(7)=3/8, P(8)=3/8, P(9)=1/8
 *
 * 大衍筮法：按朱熹《筮仪》的标准分布直接抽样。
 *   P(9 老阳)=3/16, P(7 少阳)=5/16, P(8 少阴)=7/16, P(6 老阴)=1/16
 *   注：这里**没有**模拟完整的十八变过程（分二、挂一、揲四、归奇），
 *   只按该过程的理论分布抽样。两法分布不同，禁止合并。
 *
 * @param {{seed?: number, method?: '金钱'|'大衍'}} [opts]
 * @returns {number} 12 位变
 */
export function cast(opts = {}) {
  const { seed = 1, method = '金钱' } = opts;
  if (method !== '金钱' && method !== '大衍') {
    throw new Error(`未知起卦法 "${method}"，只支持 金钱 / 大衍`);
  }

  const rand = rng(seed);
  let b = 0;
  let d = 0;

  for (let p = 1; p <= 6; p++) {
    const v = method === '金钱' ? drawCoins(rand) : drawDayan(rand);
    if (v === 7 || v === 9) b |= 1 << (p - 1);
    if (v === 6 || v === 9) d |= 1 << (p - 1);
  }
  return bian(b, d);
}

/** 金钱卦：三枚，背面数 k，爻 = 6 + k */
function drawCoins(rand) {
  let back = 0;
  for (let coin = 0; coin < 3; coin++) if (rand() < 0.5) back++;
  return 6 + back;
}

/** 大衍：3/16 老阳、5/16 少阳、7/16 少阴、1/16 老阴 */
function drawDayan(rand) {
  const r = Math.floor(rand() * 16);
  if (r < 3) return 9;
  if (r < 8) return 7;
  if (r < 15) return 8;
  return 6;
}

// ---------------------------------------------------------------- 爻题

const POS = [null, '初', '二', '三', '四', '五', '上'];

/** 爻题：初九 / 六二 / 上六 …… */
export function yaoTitle(gua, pos) {
  const yang = (gua >> (pos - 1)) & 1;
  const n = yang ? '九' : '六';
  if (pos === 1) return '初' + n;
  if (pos === 6) return '上' + n;
  return n + POS[pos];
}

// ---------------------------------------------------------------- 断

/** 动爻位置（1..6），升序 */
export function movingPositions(x) {
  const out = [];
  for (let p = 1; p <= 6; p++) if ((dong(x) >> (p - 1)) & 1) out.push(p);
  return out;
}

/**
 * 七分支断法（朱熹《易学启蒙》）。
 * @returns {{
 *   branch: number,
 *   rule: string,
 *   entries: {hex: number, hexName: string, kind: '卦'|'爻'|'用', pos?: number, label: string, text: string}[],
 *   main: number
 * }}
 */
export function judge(x, corpus = loadCorpus()) {
  const n = bianShu(x);
  const b = ben(x);
  const z = zhi(x);
  const moving = movingPositions(x);
  const still = [1, 2, 3, 4, 5, 6].filter((p) => !moving.includes(p));

  const guaText = (g) => corpus.entries[nameOf(g)].c;
  const yaoText = (g, p) => corpus.entries[nameOf(g)].y[p - 1];

  const entry = (g, kind, extra = {}) => ({
    hex: g,
    hexName: nameOf(g),
    kind,
    ...extra,
    text: kind === '卦' ? guaText(g) : kind === '爻' ? yaoText(g, extra.pos) : extra.text,
  });

  switch (n) {
    case 0:
      return {
        branch: 0,
        rule: '六爻皆静，以本卦卦辞断',
        entries: [entry(b, '卦')],
        main: 0,
      };

    case 1:
      return {
        branch: 1,
        rule: '一爻动，以本卦该动爻爻辞断',
        entries: [entry(b, '爻', { pos: moving[0], label: yaoTitle(b, moving[0]) })],
        main: 0,
      };

    case 2:
      return {
        branch: 2,
        rule: '二爻动，以本卦两动爻爻辞断，以上爻为主',
        entries: moving.map((p) => entry(b, '爻', { pos: p, label: yaoTitle(b, p) })),
        main: 1,
      };

    case 3:
      return {
        branch: 3,
        rule: '三爻动，以本卦与之卦卦辞断，本卦为主',
        entries: [entry(b, '卦'), entry(z, '卦')],
        main: 0,
      };

    case 4:
      return {
        branch: 4,
        rule: '四爻动，以之卦中两不变爻爻辞断，以下爻为主',
        entries: still.map((p) => entry(z, '爻', { pos: p, label: yaoTitle(z, p) })),
        main: 0,
      };

    case 5:
      return {
        branch: 5,
        rule: '五爻动，以之卦中不变爻的爻辞断',
        entries: [entry(z, '爻', { pos: still[0], label: yaoTitle(z, still[0]) })],
        main: 0,
      };

    default: {
      // 六爻全动
      if (b === BY_NAME.get('乾').id) {
        const e = corpus.entries['乾'];
        return {
          branch: 6,
          rule: '六爻皆动，乾卦用九',
          entries: [{ hex: b, hexName: '乾', kind: '用', label: '用九', text: e.u }],
          main: 0,
        };
      }
      if (b === BY_NAME.get('坤').id) {
        const e = corpus.entries['坤'];
        return {
          branch: 6,
          rule: '六爻皆动，坤卦用六',
          entries: [{ hex: b, hexName: '坤', kind: '用', label: '用六', text: e.u }],
          main: 0,
        };
      }
      return {
        branch: 6,
        rule: '六爻皆动，以之卦卦辞断',
        entries: [entry(z, '卦')],
        main: 0,
      };
    }
  }
}

// ---------------------------------------------------------------- 覆盖

/**
 * 辞库覆盖检查：64 卦辞 + 384 爻辞 + 乾坤用九用六 = 450 条。
 */
export function coverage(corpus = loadCorpus()) {
  const missing = [];
  const unverified = [];
  const ok = new Set(corpus.verified ?? []);
  let filled = 0;

  for (const [name, e] of Object.entries(corpus.entries)) {
    if (!e.c) missing.push(`${name}·卦辞`);
    else { filled++; if (!ok.has(`${name}.c`)) unverified.push(`${name}.c`); }

    if (!Array.isArray(e.y) || e.y.length !== 6) {
      missing.push(`${name}·爻辞（应为 6 条）`);
    } else {
      e.y.forEach((t, i) => {
        if (!t) missing.push(`${name}·${yaoTitle(BY_NAME.get(name).id, i + 1)}`);
        else {
          filled++;
          if (!ok.has(`${name}.${i + 1}`)) unverified.push(`${name}.${i + 1}`);
        }
      });
    }

    if (name === '乾' || name === '坤') {
      if (!e.u) missing.push(`${name}·用`);
      else { filled++; if (!ok.has(`${name}.u`)) unverified.push(`${name}.u`); }
    }
  }

  return {
    total: 450,
    filled,
    missing,
    unverified,
    verifiedCount: (corpus.verified ?? []).length,
  };
}
