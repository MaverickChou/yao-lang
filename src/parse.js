/**
 * 爻 · 语法分析（M2）
 *
 * 文法（M2 子集）：
 *   程序   := '机' 名 '{' 项* '起' 名 '}'
 *   项     := '事' 名 [ '(' '位' 名 ')' ]
 *           | '态' 名 '=' 表达式
 *           | '转' (名 | '*') 事件 '->' 表达式
 *
 * 名字位置（态名、转的源、起）允许直接写卦名，如 `态 未济 = 未济`。
 * 卦名在其它位置仍是字面量。
 */

import { lex } from './lex.js';
import { BY_NAME, nameOf, dong as dongOf } from './core.js';

export class ParseError extends Error {
  constructor(msg, tok, code = 'Y0010') {
    const where = tok ? `（第 ${tok.line} 行第 ${tok.col} 列）` : '';
    super(msg + where);
    this.name = 'ParseError';
    this.code = code;
  }
}

const BIN_LEVELS = [
  ['|'],
  ['^'],
  ['&'],
  ['<<', '>>'],
  ['+', '-'],
  ['*'],
];

class Parser {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
  }

  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  at(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }
  eat(type, value) {
    if (this.at(type, value)) return this.next();
    return null;
  }
  expect(type, value, what) {
    const t = this.peek();
    if (t.type === type && (value === undefined || t.value === value)) return this.next();
    throw new ParseError(`期望 ${what ?? value ?? type}，得到 "${t.text || t.type}"`, t);
  }

  /** 名字位置：ident 或卦名字面量 */
  parseName(what) {
    const t = this.peek();
    if (t.type === 'ident') { this.i++; return t.value; }
    if (t.type === 'bian') {
      if (dongOf(t.value) !== 0) {
        throw new ParseError(`${what}不能用带爻变的卦，只能写静卦`, t);
      }
      this.i++;
      return nameOf(t.value);
    }
    throw new ParseError(`期望${what}，得到 "${t.text || t.type}"`, t);
  }

  // -------------------------------------------------------------- 程序

  parseProgram() {
    this.expect('kw', '机', '`机`');
    const machineName = this.parseName('机器名');
    this.expect('punct', '{');

    const events = [];
    const states = [];
    const rules = [];
    let start = null;

    while (!this.at('kw', '起')) {
      if (this.at('eof')) throw new ParseError('机器定义没有闭合：缺少 `起`', this.peek());
      if (this.at('kw', '事')) { events.push(this.parseEvent()); continue; }
      if (this.at('kw', '态')) { states.push(this.parseState()); continue; }
      if (this.at('kw', '转')) { rules.push(this.parseRule()); continue; }
      const t = this.peek();
      if (t.type === 'punct' && t.value === '}') {
        throw new ParseError('机器定义缺少 `起`', t);
      }
      throw new ParseError(`机器内不能出现 "${t.text || t.type}"`, t);
    }

    this.expect('kw', '起');
    start = this.parseName('起始态');
    this.expect('punct', '}');
    this.expect('eof', undefined, '文件结束');

    return { type: 'machine', name: machineName, events, states, rules, start };
  }

  parseEvent() {
    const tok = this.expect('kw', '事');
    const name = this.parseName('事件名');
    let param = null;
    if (this.eat('punct', '(')) {
      this.expect('kw', '位', '参数类型 `位`');
      param = this.parseName('参数名');
      this.expect('punct', ')');
    }
    return { name, param, tok };
  }

  parseState() {
    const tok = this.expect('kw', '态');
    const name = this.parseName('态名');
    this.expect('punct', '=');
    const value = this.parseExpr();
    return { name, value, tok };
  }

  parseRule() {
    const tok = this.expect('kw', '转');
    let from = null;
    if (this.eat('punct', '*')) {
      from = null;
    } else {
      from = this.parseName('源态');
    }
    const event = this.parseName('事件名');
    this.expect('punct', '->');
    const target = this.parseExpr();
    return { from, event, target, tok };
  }

  // -------------------------------------------------------------- 表达式

  parseExpr() { return this.parseLevel(0); }

  parseLevel(level) {
    if (level >= BIN_LEVELS.length) return this.parseUnary();
    let left = this.parseLevel(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.type !== 'punct' || !BIN_LEVELS[level].includes(t.value)) break;
      this.i++;
      const right = this.parseLevel(level + 1);
      left = { t: 'bin', op: t.value, l: left, r: right, tok: t };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'punct' && t.value === '~') {
      this.i++;
      return { t: 'un', op: '~', x: this.parseUnary(), tok: t };
    }
    if (t.type === 'punct' && t.value === '-') {
      this.i++;
      return { t: 'un', op: '负', x: this.parseUnary(), tok: t };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.peek();

    if (t.type === 'bian') { this.i++; return { t: 'lit', kind: 'bian', v: t.value, tok: t }; }
    if (t.type === 'num') { this.i++; return { t: 'lit', kind: 'num', v: t.value, tok: t }; }

    if (t.type === 'punct' && t.value === '(') {
      this.i++;
      const e = this.parseExpr();
      this.expect('punct', ')');
      return e;
    }

    // 裸 `本` = 当前状态的卦体；裸 `变` = 当前状态的整个 12 位变
    if (t.type === 'kw' && t.value === '本' && !(this.peek(1).type === 'punct' && this.peek(1).value === '(')) {
      this.i++;
      return { t: 'ben', tok: t };
    }
    if (t.type === 'kw' && t.value === '变' && !(this.peek(1).type === 'punct' && this.peek(1).value === '(')) {
      this.i++;
      return { t: 'state', tok: t };
    }

    // 合：按值分发
    if (t.type === 'kw' && t.value === '合') {
      this.i++;
      const subject = this.parseExpr();
      this.expect('punct', '{');
      const arms = [];
      while (!this.at('punct', '}')) {
        let pattern;
        const p = this.peek();
        if (p.type === 'num') {
          this.i++;
          pattern = p.value;
        } else if (p.type === 'ident' && p.value === '_') {
          this.i++;
          pattern = null;
        } else {
          throw new ParseError(`合 的分支必须以数字或 _ 开头，得到 "${p.text || p.type}"`, p);
        }
        this.expect('punct', '=>');
        const body = this.parseExpr();
        arms.push({ pattern, body, tok: p });
        if (this.eat('punct', ',') || this.eat('punct', ';')) continue;
        if (this.at('punct', '}')) break;
        throw new ParseError('合 的分支之间需要逗号或分号', this.peek());
      }
      this.expect('punct', '}');
      if (!arms.length) throw new ParseError('合 至少要有一个分支', t);
      return { t: 'match', subject, arms, tok: t };
    }

    const callable =
      (t.type === 'kw' || t.type === 'ident') &&
      this.peek(1).type === 'punct' && this.peek(1).value === '(';

    if (callable) {
      this.i++;
      this.expect('punct', '(');
      const args = [];
      if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
        for (;;) {
          args.push(this.parseExpr());
          if (this.eat('punct', ',')) continue;
          break;
        }
      }
      this.expect('punct', ')');
      return { t: 'call', name: t.value, args, tok: t };
    }

    if (t.type === 'ident') { this.i++; return { t: 'var', name: t.value, tok: t }; }

    throw new ParseError(`无法解析表达式：得到 "${t.text || t.type}"`, t);
  }
}

/** @param {string} src */
export function parse(src) {
  const toks = lex(src);
  return new Parser(toks).parseProgram();
}
