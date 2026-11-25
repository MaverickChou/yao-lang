/**
 * 爻 · 词法器
 *
 * 见 SPEC.md §3。要点：
 *   - 爻串（6 个 6/7/8/9）无前缀即字面量，因为本语言 数 只有 0..63
 *   - 卦名与卦象字符（U+4DC0..U+4DFF）等价
 *   - 动爻后缀 `/` 必须紧跟卦字面量，中间不能有空白
 *   - 卦名占 64 个保留字；`否` 因此让位，else 关键字取 `否则`
 */

import {
  NAME_TOKENS,
  BY_NAME,
  ALIASES,
  GLYPH_TO_ID,
  fromDigits,
  bian,
  POS_NAMES,
} from './core.js';

/** 关键字。注意：`否则` 而非 `否`，因为 `否` 是第 12 卦。 */
export const KEYWORDS = new Set([
  // 类型
  '变', '卦', '爻', '数', '位',
  // 声明与结构
  '机', '态', '转', '事', '起', '组', '印',
  // 控制
  '若', '则', '否则', '合',
  // 运算与内建
  '本', '动', '之', '静', '错', '综', '互', '变数', '当位', '序',
  '先天', '文王', '止',
]);

const PUNCT = [
  '<<', '>>', '->', '=>',
  '(', ')', '{', '}', ',', ';', ':', '=', '+', '-', '*', '/', '&', '|', '^', '~',
];

const ID_START = /[A-Za-z_\u4e00-\u9fff]/;
const ID_CONT = /[A-Za-z0-9_\u4e00-\u9fff]/;

export class LexError extends Error {
  constructor(msg, pos, line, col, code = 'Y0001') {
    super(`${msg}（第 ${line} 行第 ${col} 列）`);
    this.name = 'LexError';
    this.code = code;
    this.pos = pos;
    this.line = line;
    this.col = col;
  }
}

/**
 * @param {string} src
 * @returns {{type:string, value:any, text:string, pos:number, line:number, col:number}[]}
 */
export function lex(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const col = () => i - lineStart + 1;
  const push = (type, value, start, text) =>
    toks.push({ type, value, text, pos: start, line, col: start - lineStart + 1 });

  while (i < src.length) {
    const ch = src[i];

    // --- 空白（含全角空格）
    if (ch === '\n') { i++; line++; lineStart = i; continue; }
    if (/\s/.test(ch) || ch === '\u3000') { i++; continue; }

    // --- 注释
    if (ch === '#') {
      if (src.startsWith('#[', i)) {
        // 块注释，可嵌套
        const startLine = line;
        const startCol = col();
        let depth = 0;
        while (i < src.length) {
          if (src.startsWith('#[', i)) { depth++; i += 2; continue; }
          if (src.startsWith(']#', i)) {
            depth--; i += 2;
            if (depth === 0) break;
            continue;
          }
          if (src[i] === '\n') { line++; i++; lineStart = i; continue; }
          i++;
        }
        if (depth !== 0) {
          throw new LexError('块注释未闭合', i, startLine, startCol);
        }
        continue;
      }
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    const start = i;

    // --- 宿主效应 @名
    if (ch === '@') {
      i++;
      const rest = src.slice(i);
      const name = matchName(rest) ?? matchIdent(rest) ?? matchGlyph(rest);
      if (!name) throw new LexError('`@` 之后必须是卦名、卦象字符或标识符', start, line, col());
      i += name.text.length;
      push('effect', name.text, start, '@' + name.text);
      continue;
    }

    // --- 数字串 / 数
    if (ch >= '0' && ch <= '9') {
      if (src.startsWith('0b', i) || src.startsWith('0B', i)) {
        i += 2;
        const bs = i;
        while (i < src.length && (src[i] === '0' || src[i] === '1')) i++;
        if (i === bs) throw new LexError('`0b` 之后缺少二进制位', start, line, col());
        const text = src.slice(start, i);
        push('num', parseInt(src.slice(bs, i), 2), start, text);
        continue;
      }
      while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
      const text = src.slice(start, i);
      // 爻串：恰好 6 位且全在 6..9（本语言 数 最大 63，故无歧义）
      if (/^[6-9]{6}$/.test(text)) {
        push('bian', fromDigits(text), start, text);
      } else {
        const v = Number(text);
        if (v > 63) {
          throw new LexError(`数 字面量越界（${text} > 63）`, start, line, col(), 'Y0003');
        }
        push('num', v, start, text);
      }
      continue;
    }

    // --- 卦象字符
    {
      const g = matchGlyph(src.slice(i));
      if (g) {
        i += g.text.length;
        const id = GLYPH_TO_ID.get(g.text);
        if (id === undefined) {
          throw new LexError(`未知卦象字符 ${g.text}`, start, line, col(), 'Y0002');
        }
        const suffix = readSuffix(src, i);
        if (suffix) i = suffix.end;
        push('bian', bian(id, suffix ? suffix.mask : 0), start, src.slice(start, i));
        continue;
      }
    }

    // --- 卦名（最长匹配，且其后不能紧跟标识符字符）
    {
      const n = matchName(src.slice(i));
      if (n) {
        const after = src[i + n.text.length] ?? '';
        if (!(after && ID_CONT.test(after))) {
          i += n.text.length;
          const canon = BY_NAME.has(n.text) ? n.text : ALIASES.get(n.text);
          const id = BY_NAME.get(canon).id;
          const suffix = readSuffix(src, i);
          if (suffix) i = suffix.end;
          push('bian', bian(id, suffix ? suffix.mask : 0), start, src.slice(start, i));
          continue;
        }
      }
    }

    // --- 标识符与关键字
    if (ID_START.test(ch)) {
      const id = matchIdent(src.slice(i));
      i += id.length;
      if (KEYWORDS.has(id)) push('kw', id, start, id);
      else push('ident', id, start, id);
      continue;
    }

    // --- 符号
    {
      const p = PUNCT.find((s) => src.startsWith(s, i));
      if (p) {
        i += p.length;
        push('punct', p, start, p);
        continue;
      }
    }

    throw new LexError(`无法识别的字符 ${JSON.stringify(ch)}`, start, line, col());
  }

  toks.push({ type: 'eof', value: null, text: '', pos: i, line, col: col() });
  return toks;
}

// ---------------------------------------------------------------- 辅助

function matchGlyph(s) {
  const c = s[0];
  if (!c) return null;
  const cp = c.codePointAt(0);
  if (cp >= 0x4dc0 && cp <= 0x4dff) return { text: c };
  return null;
}

function matchName(s) {
  for (const n of NAME_TOKENS) {
    if (s.startsWith(n)) return { text: n };
  }
  return null;
}

function matchIdent(s) {
  if (!s || !ID_START.test(s[0])) return null;
  let i = 1;
  while (i < s.length && ID_CONT.test(s[i])) i++;
  return s.slice(0, i);
}

/**
 * 读动爻后缀：`/` 紧跟（无空白）之后，接 6 位 0/1，或爻名串（初/二/三/四/五/上）。
 * @returns {{mask:number, end:number}|null}
 */
function readSuffix(src, i) {
  if (src[i] !== '/') return null;
  let j = i + 1;
  const rest = src.slice(j);

  const bits = /^[01]{6}/.exec(rest);
  if (bits) {
    return { mask: parseInt(bits[0], 2), end: j + 6 };
  }

  let mask = 0;
  let n = 0;
  for (;;) {
    const c = src[j];
    if (!c) break;
    const p = POS_NAMES.indexOf(c); // 1..6
    if (p <= 0) break;
    mask |= 1 << (p - 1);
    j++;
    n++;
    if (n > 6) break;
  }
  if (n === 0) return null;
  return { mask, end: j };
}
