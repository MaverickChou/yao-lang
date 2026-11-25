/**
 * 爻 · 表达式求值（M1 子集）
 *
 * 只实现副作用为零的纯表达式：字面量、内建函数、括号。
 * 状态机、合、@效应留给 M2。
 */

import {
  ben, dong, zhi, bian, jing, cuo, zong, hu, bianShu, dangWei, yaoOf, xu,
  GUA_MASK,
} from './core.js';
import { lex, KEYWORDS } from './lex.js';

export class EvalError extends Error {
  constructor(msg, code = 'Y0900') {
    super(msg);
    this.name = 'EvalError';
    this.code = code;
  }
}

// ---------------------------------------------------------------- 值

const V = {
  bian: (v) => ({ t: '变', v }),
  gua: (v) => ({ t: '卦', v }),
  shu: (v) => ({ t: '数', v }),
  yao: (v) => ({ t: '爻', v }),
  fa: (v) => ({ t: '法', v }),
};

const YAO_NAMES = { 6: '老阴', 7: '少阳', 8: '少阴', 9: '老阳' };

export function showValue(val) {
  if (val.t === '法') return val.v;
  if (val.t === '爻') return `${val.v}（${YAO_NAMES[val.v]}）`;
  return String(val.v);
}

/** 取 6 位卦值（变 会静投影） */
function guaOf(val) {
  if (val.t === '卦' || val.t === '变') return ben(val.v);
  if (val.t === '数') {
    if (val.v < 0 || val.v > GUA_MASK) throw new EvalError(`数 ${val.v} 超出 6 位范围`);
    return val.v;
  }
  throw new EvalError(`需要 卦 或 变，得到 ${val.t}（Y0103）`);
}

function nuOf(val) {
  if (val.t === '数') return val.v;
  if (val.t === '位') return val.v;
  if (val.t === '爻') return val.v;
  throw new EvalError(`需要 数，得到 ${val.t}（Y0103）`);
}

function posOf(val) {
  const n = nuOf(val);
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    throw new EvalError(`爻位必须是 1..6，得到 ${n}`);
  }
  return n;
}

// ---------------------------------------------------------------- 内建

/** 名 -> [元数, 实现] */
const BUILTINS = new Map([
  ['本', [1, ([x]) => V.gua(ben(x.v))]],
  ['动', [1, ([x]) => V.gua(dong(x.v))]],
  ['之', [1, ([x]) => V.gua(zhi(x.v))]],
  ['静', [1, ([x]) => V.gua(jing(x.v))]],
  ['变', [2, ([b, d]) => V.bian(bian(guaOf(b), guaOf(d)))]],
  ['错', [1, ([x]) => V.gua(cuo(guaOf(x)))]],
  ['综', [1, ([x]) => V.gua(zong(guaOf(x)))]],
  ['互', [1, ([x]) => V.gua(hu(guaOf(x)))]],
  ['变数', [1, ([x]) => V.shu(bianShu(x.v))]],
  ['当位', [1, ([x]) => V.shu(dangWei(guaOf(x)))]],
  ['序', [2, ([x, m]) => {
    if (m.t !== '法') throw new EvalError('序 的第二个参数必须是 先天 或 文王');
    return V.shu(xu(guaOf(x), m.v));
  }]],
  ['卦', [1, ([n]) => V.gua(nuOf(n) & GUA_MASK)]],
  ['数', [1, ([x]) => V.shu(guaOf(x))]],
  ['爻', [2, ([x, p]) => V.yao(yaoOf(x.v, posOf(p)))]],
]);

// ---------------------------------------------------------------- 解析

class Parser {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
  }

  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }

  expect(type, value) {
    const t = this.next();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new EvalError(
        `期望 ${value ?? type}，得到 ${t.text || t.type}（第 ${t.line} 行第 ${t.col} 列）`
      );
    }
    return t;
  }

  parseTop() {
    const val = this.parseExpr();
    if (this.peek().type !== 'eof') {
      const t = this.peek();
      throw new EvalError(`表达式之后出现多余记号 "${t.text}"（第 ${t.line} 行）`);
    }
    return val;
  }

  parseExpr() {
    const t = this.peek();

    if (t.type === 'bian') { this.i++; return V.bian(t.value); }
    if (t.type === 'num') { this.i++; return V.shu(t.value); }

    if (t.type === 'kw' && (t.value === '先天' || t.value === '文王')) {
      this.i++;
      return V.fa(t.value);
    }

    if (t.type === 'punct' && t.value === '(') {
      this.i++;
      const val = this.parseExpr();
      this.expect('punct', ')');
      return val;
    }

    const isCallable =
      (t.type === 'kw' && BUILTINS.has(t.value)) ||
      (t.type === 'ident' && BUILTINS.has(t.value));

    if (isCallable) {
      this.i++;
      this.expect('punct', '(');
      const args = [];
      if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
        for (;;) {
          args.push(this.parseExpr());
          if (this.peek().type === 'punct' && this.peek().value === ',') { this.i++; continue; }
          break;
        }
      }
      this.expect('punct', ')');

      const [arity, fn] = BUILTINS.get(t.value);
      if (args.length !== arity) {
        throw new EvalError(`${t.value} 需要 ${arity} 个参数，收到 ${args.length} 个`);
      }
      return fn(args);
    }

    if (t.type === 'ident') {
      throw new EvalError(`未定义的标识符 "${t.text}"（M1 尚无变量）`);
    }
    if (t.type === 'kw' && KEYWORDS.has(t.value)) {
      throw new EvalError(`关键字 "${t.value}" 不能单独作为表达式`);
    }
    throw new EvalError(`无法解析 "${t.text}"（第 ${t.line} 行第 ${t.col} 列）`);
  }
}

/**
 * 求值一个表达式源码。
 * @param {string} src
 * @returns {{t:string, v:number|string}}
 */
export function evalExpr(src) {
  const toks = lex(src);
  return new Parser(toks).parseTop();
}
