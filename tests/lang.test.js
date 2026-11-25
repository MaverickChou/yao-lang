import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lex, LexError, KEYWORDS } from '../src/lex.js';
import { evalExpr, EvalError } from '../src/eval.js';
import { BY_NAME, bian, fromDigits } from '../src/core.js';

const id = (n) => BY_NAME.get(n).id;
const toks = (s) => lex(s).filter((t) => t.type !== 'eof');

// ---------------------------------------------------------------- 字面量

test('爻串字面量', () => {
  const t = toks('987789');
  assert.equal(t.length, 1);
  assert.equal(t[0].type, 'bian');
  assert.equal(t[0].value, fromDigits('987789'));
});

test('卦名与卦象字符等价', () => {
  assert.deepEqual(toks('既济').map((t) => [t.type, t.value]), [['bian', id('既济')]]);
  assert.deepEqual(toks('䷾').map((t) => [t.type, t.value]), [['bian', id('既济')]]);
  assert.deepEqual(toks('未济').map((t) => [t.type, t.value]), [['bian', id('未济')]]);
});

test('动爻后缀：二进制掩码与爻名', () => {
  const a = toks('既济/100001')[0];
  assert.equal(a.value, bian(id('既济'), 0b100001));
  const b = toks('既济/初上')[0];
  assert.equal(b.value, bian(id('既济'), 0b100001));
  const c = toks('䷾/初二')[0];
  assert.equal(c.value, bian(id('既济'), 0b000011));
});

test('简繁别名归一', () => {
  assert.equal(toks('既濟')[0].value, id('既济'));
  assert.equal(toks('無妄')[0].value, id('无妄'));
  assert.equal(toks('遯')[0].value, toks('遁')[0].value);
  assert.equal(toks('歸妹')[0].value, id('归妹'));
});

test('`否` 是卦名，`否则` 是关键字', () => {
  assert.equal(toks('否')[0].type, 'bian');
  assert.equal(toks('否')[0].value, id('否'));
  assert.equal(toks('否则')[0].type, 'kw');
  assert.equal(toks('否则')[0].value, '否则');
  assert.ok(KEYWORDS.has('否则'));
  assert.ok(!KEYWORDS.has('否'), '`否` 不能同时是关键字');
});

test('卦名不可被更长标识符吞掉', () => {
  const t = toks('家人甲');
  assert.equal(t[0].type, 'ident');
  assert.equal(t[0].value, '家人甲');
});

test('宿主效应用 @ 前缀', () => {
  const t = toks('@颐(0)');
  assert.equal(t[0].type, 'effect');
  assert.equal(t[0].value, '颐');
  assert.equal(t[1].type, 'punct');
  assert.equal(t[1].value, '(');
});

test('注释：行注释与可嵌套块注释', () => {
  assert.equal(toks('# 全部注释\n既济').length, 1);
  assert.equal(toks('#[ 外层 #[ 内层 ]# 仍在注释 ]# 坤').length, 1);
  assert.throws(() => lex('#[ 未闭合'), LexError);
});

test('数越界报 Y0003', () => {
  assert.throws(() => lex('64'), (e) => e.code === 'Y0003');
  assert.throws(() => lex('123456'), (e) => e.code === 'Y0003');
  assert.equal(toks('63')[0].value, 63);
  assert.equal(toks('0b111111')[0].value, 63);
});

// ---------------------------------------------------------------- 求值

test('内建：本 动 之', () => {
  const x = '既济/初上';
  assert.equal(evalExpr(`本(${x})`).v, id('既济'));
  assert.equal(evalExpr(`动(${x})`).v, 0b100001);
  assert.equal(evalExpr(`之(${x})`).v, id('既济') ^ 0b100001);
});

test('内建：错综互', () => {
  assert.equal(evalExpr('错(既济)').v, id('未济'));
  assert.equal(evalExpr('综(泰)').v, id('否'));
  assert.equal(evalExpr('互(既济)').v, id('未济'));
  assert.equal(evalExpr('互(泰)').v, id('归妹'));
});

test('内建：变数 与 断卦分支值', () => {
  assert.equal(evalExpr('变数(既济)').v, 0);
  assert.equal(evalExpr('变数(既济/初上)').v, 2);
  assert.equal(evalExpr('变数(987789)').v, 2);
});

test('内建：序 需要 先天/文王', () => {
  assert.equal(evalExpr('序(乾, 先天)').v, 63);
  assert.equal(evalExpr('序(乾, 文王)').v, 1);
  assert.equal(evalExpr('序(未济, 文王)').v, 64);
  assert.throws(() => evalExpr('序(乾, 42)'), EvalError);
});

test('内建：变 构造与 爻', () => {
  assert.equal(evalExpr('变(既济, 0b100001)').v, bian(id('既济'), 0b100001));
  assert.equal(evalExpr('变(既济, 33)').v, bian(id('既济'), 33));
  assert.equal(evalExpr('爻(既济, 1)').v, 7);
  assert.equal(evalExpr('爻(否, 1)').v, 8);
});

test('卦 与 数 不隐式互转', () => {
  assert.throws(() => evalExpr('既济 + 1'), EvalError);
  assert.equal(evalExpr('数(既济)').v, 21);
});

test('嵌套调用与括号', () => {
  assert.equal(evalExpr('互(错(既济))').v, id('既济'));
  assert.equal(evalExpr('(互(既济))').v, id('未济'));
});

test('未定义标识符与非法语法', () => {
  assert.throws(() => evalExpr('甲'), EvalError);
  assert.throws(() => evalExpr('互('), EvalError);
  assert.throws(() => evalExpr('互(既济) 既济'), EvalError);
  assert.throws(() => evalExpr('互(既济, 既济)'), EvalError);
});
