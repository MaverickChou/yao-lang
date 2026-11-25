#!/usr/bin/env node
/**
 * 爻 · 命令行与 REPL（M1 + M2）
 */

import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
  BY_NAME, BY_ID, HEXAGRAMS, POS_NAMES, SI_XIANG,
  ben, dong, zhi, bian, cuo, zong, hu, bianShu, dangWei, yaoOf,
  fromDigits, toDigits, nameOf, glyphOf, meta, xu,
  renderLines, GUA_MASK,
} from '../src/core.js';
import { evalExpr, showValue, EvalError } from '../src/eval.js';
import { lex, LexError } from '../src/lex.js';
import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { Machine, trace } from '../src/interp.js';
import { emitC, emitHeader } from '../src/codegen-c.js';
import { emitWasm } from '../src/codegen-wasm.js';
import { analyze } from '../src/validate.js';
import { cast, judge, loadCorpus, coverage, yaoTitle } from '../src/divine.js';
import { LEVELS, makeStepper, par, flippedLines } from '../src/game.js';

// 参数解析：`--flag` 与 `-x` 同等对待，支持 `--flag=value` 与需要取值的 `-o <路径>`
const rawArgs = process.argv.slice(2);
const flags = new Map();
const args = [];
const VALUE_FLAGS = new Set(['seed', 'o', 'machine', '法', 'target']);

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (!a.startsWith('-') || a === '-') { args.push(a); continue; }
  const body = a.replace(/^--?/, '');
  const eq = body.indexOf('=');
  if (eq > 0) {
    flags.set(body.slice(0, eq), body.slice(eq + 1));
    continue;
  }
  const name = body;
  const next = rawArgs[i + 1];
  if (VALUE_FLAGS.has(name) && next !== undefined && !next.startsWith('-')) {
    flags.set(name, next);
    i++;
  } else {
    flags.set(name, true);
  }
}

const ASCII = flags.has('ascii');
const NO_COLOR = flags.has('no-color') || process.env.NO_COLOR != null;

// ---------------------------------------------------------------- 输出

const c = {
  dim: (s) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`),
  cyan: (s) => (NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`),
  yellow: (s) => (NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`),
};

/** 渲染一个变（或卦）的完整卦象 */
export function render(x) {
  const lines = [];
  const m = meta(x);
  const n = bianShu(x);

  lines.push(
    `  ${c.bold(m.name)} ${m.glyph}  ${c.dim(
      `${format2(ben(x))} · ${m.upper}/${m.lower} · 文王序 ${m.order}`
    )}`
  );
  lines.push('');
  const art = renderLines(x, { ascii: ASCII, labels: false });
  for (let k = 0; k < 6; k++) {
    const p = 6 - k;
    lines.push(`  ${c.dim(POS_NAMES[p] + ' ')} ${art[k]}`);
  }
  lines.push('');

  if (n === 0) {
    lines.push(`  ${c.dim('静卦')}　本 ${nameOf(x)}`);
  } else {
    lines.push(
      `  ${c.dim('本')} ${c.bold(nameOf(ben(x)))}　` +
        `${c.dim('之')} ${c.bold(nameOf(zhi(x)))}　` +
        `${c.dim('变数')} ${n}　${c.dim('动爻')} ${dongPositions(x).join('')}`
    );
  }
  lines.push(
    `  ${c.dim('互')} ${nameOf(hu(ben(x)))}　${c.dim('错')} ${nameOf(cuo(ben(x)))}　` +
      `${c.dim('综')} ${nameOf(zong(ben(x)))}　${c.dim('当位')} ${dangWei(ben(x))}/6`
  );
  lines.push(`  ${c.dim(`[${toDigits(x)}]`)}`);
  return lines.join('\n');
}

function format2(v) {
  return '0b' + v.toString(2).padStart(6, '0');
}

function dongPositions(x) {
  const out = [];
  for (let p = 1; p <= 6; p++) {
    if ((dong(x) >> (p - 1)) & 1) out.push(POS_NAMES[p]);
  }
  return out;
}

/** 解析用户输入的一个字面量或表达式 */
function parseInput(src) {
  const val = evalExpr(src);
  if (val.t === '变' || val.t === '卦') {
    const x = val.t === '卦' ? bian(val.v, 0) : val.v;
    return render(x) + '\n' + c.dim(`  = ${showValue(val)}（${val.t}）`);
  }
  return `${c.bold(showValue(val))}  ${c.dim(`(${val.t})`)}`;
}

// ---------------------------------------------------------------- 起卦

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
 * 金钱卦：每爻掷三枚，记背面数 k，爻 = 6 + k。
 * 分布 P(6)=1/8, P(7)=3/8, P(8)=3/8, P(9)=1/8 —— 与 SPEC.md §11 一致。
 */
function castCoins(seed) {
  const rand = rng(seed);
  let digits = '';
  for (let p = 0; p < 6; p++) {
    let k = 0;
    for (let coin = 0; coin < 3; coin++) if (rand() < 0.5) k++;
    digits += String(6 + k);
  }
  return fromDigits(digits);
}

// ---------------------------------------------------------------- 命令

function cmdCast() {
  const seed = flags.has('seed')
    ? Number(flags.get('seed')) >>> 0
    : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

  const src = args.slice(1).join(' ');
  const x = src ? normalize(evalExpr(src)) : castCoins(seed);

  console.log(render(x));
  console.log(c.dim(`  种子 ${seed}（用 --seed=${seed} 可复现）`));
}

/** 把求值结果统一成 12 位变 */
function normalize(val) {
  if (val.t === '变') return val.v;
  if (val.t === '卦') return bian(val.v, 0);
  throw new EvalError(`需要 变 或 卦 字面量，得到 ${val.t}`);
}

function cmdInfo() {
  const src = args.filter((a) => a !== 'info').join(' ');
  if (!src) return usage();

  const val = evalExpr(src);
  const x = normalize(val);
  const m = meta(x);

  console.log(render(x));
  console.log('');
  console.log(`  文王序  ${m.order} / 64`);
  console.log(`  先天序  ${xu(x, '先天')}`);
  console.log(`  二进制  ${format2(ben(x))}   上卦 ${m.upper}  下卦 ${m.lower}`);
  console.log(`  拼音    ${m.pinyin}`);
  if (m.alias?.length) console.log(`  别名    ${m.alias.join(' ')}`);
  if (x !== ben(x)) {
    for (let p = 1; p <= 6; p++) {
      if ((dong(x) >> (p - 1)) & 1) {
        const y = yaoOf(x, p);
        console.log(
          `  ${POS_NAMES[p]}爻  ${y} ${SI_XIANG[y].name}（${SI_XIANG[y].mark}）→ 变后 ${
            (zhi(x) >> (p - 1)) & 1 ? '阳' : '阴'
          }`
        );
      }
    }
  }
}

function cmdTable() {
  console.log('  序  卦象  名      二进制  上/下   错/综/互');
  for (const h of HEXAGRAMS) {
    console.log(
      `  ${String(h.order).padStart(2)}  ${h.glyph}  ${padName(h.name)}  ${h.binary}  ` +
        `${h.upper}/${h.lower}   ${h.cuo}/${h.zong}/${h.hu}`
    );
  }
}

function padName(n) {
  const w = [...n].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return n + ' '.repeat(Math.max(0, 8 - w));
}

function usage() {
  console.log(`爻 · Yao v0.1  —  六十四卦，正好是 6 个比特

用法
  yao                      进入 REPL
  yao cast [字面量]         起卦（不给字面量则掷金钱卦）
  yao cast 既济/初上        指定卦变
  yao eval "<表达式>"       求值单个表达式
  yao info <字面量>         查看一卦详情
  yao table                打印 64 卦全表
  yao test                 运行古典恒等式自检

机器（M2/M3）
  yao check <文件.yao>      验证：可达性 / 死态 / 未定义转移 / 强连通 / 直径
      --json               机器可读输出
      --strict             有问题时退出码为 1
  yao run <文件.yao>        运行状态机（交互）
  yao trace <文件.yao> 事件…  打印状态轨迹，如： yao trace m.yao 行:1 错卦
  yao build <文件.yao>      生成 C99
      --main               附带一个极简命令行宿主
      --header             同时生成配套 .h
      -o <输出.c>           输出路径

占（M4）
  yao divine [字面量]       起卦并断；不给字面量则掷金钱卦
      --seed=N             固定种子，可复现
      --法=金钱|大衍        起卦法（两法分布不同）
  yao corpus               辞库覆盖检查（450 条）

游戏
  yao game                 爻阵：按一爻，牵动相邻之爻（六关）

选项
  --ascii                  用 ASCII 渲染（终端字体缺少卦象字符时）
  --no-color               关闭颜色
  --seed=N                 固定起卦种子，可复现

字面量
  987789                   爻串：自初爻至上爻，6 老阴 7 少阳 8 少阴 9 老阳
  既济 / ䷾                 单卦（动爻为 0）
  既济/100001  既济/初上     卦变（斜杠后为动爻，须紧邻）
`);
}

// ---------------------------------------------------------------- 自检

function cmdTest() {
  const fail = [];
  const ok = (cond, msg) => { if (!cond) fail.push(msg); };

  ok(BY_NAME.get('乾').id === 63, '乾 = 63');
  ok(BY_NAME.get('坤').id === 0, '坤 = 0');
  ok(BY_NAME.get('既济').id === 21, '既济 = 21');
  ok(BY_NAME.get('未济').id === 42, '未济 = 42');

  for (const h of HEXAGRAMS) {
    ok(cuo(cuo(h.id)) === h.id, `错 对合：${h.name}`);
    ok(zong(zong(h.id)) === h.id, `综 对合：${h.name}`);
    const b = bian(h.id, 0b101000);
    ok(zhi(b) === (h.id ^ 0b101000), `本^动=之：${h.name}`);
  }

  ok(BY_NAME.get('既济').hu === '未济', '既济之互卦为未济');
  ok(BY_NAME.get('泰').hu === '归妹', '泰之互卦为归妹');
  ok(BY_NAME.get('否').hu === '渐', '否之互卦为渐');
  ok(BY_NAME.get('师').hu === '复', '师之互卦为复');
  ok(BY_NAME.get('谦').hu === '解', '谦之互卦为解');

  ok(dangWei(BY_NAME.get('既济').id) === 6, '既济全当位');
  ok(dangWei(BY_NAME.get('未济').id) === 0, '未济全不当位');

  for (const h of HEXAGRAMS) {
    const x = fromDigits(toDigits(bian(h.id, 0b111111)));
    ok(x === bian(h.id, 0b111111), `爻串 round-trip：${h.name}`);
  }

  if (fail.length) {
    console.error(`✗ ${fail.length} 项失败`);
    for (const f of fail.slice(0, 20)) console.error('  - ' + f);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ 全部通过（${HEXAGRAMS.length} 卦 × 恒等式）`);
}

// ---------------------------------------------------------------- M2: 机器

function loadMachine(file) {
  return new Machine(buildIr(parse(readFileSync(file, 'utf8'))));
}

const EV_ALIAS = { c: '错卦', z: '综卦', h: '互卦' };

/** 渲染一个房间 */
function renderRoom(m) {
  const d = m.describe();
  const md = BY_ID[d.ben];
  const out = [];
  const back = d.dong ? nameOf(d.ben ^ d.dong) : null;

  out.push('');
  out.push(
    `  ${c.bold(md.name)} ${md.glyph}  ` +
      c.dim(`上${md.upper} 下${md.lower} · 文王序 ${md.order} · 当位 ${dangWei(d.ben)}/6`)
  );
  out.push('');
  for (const line of renderLines(d.ben, { ascii: ASCII })) out.push('  ' + line);
  out.push('');
  out.push(
    `  ${c.dim('来路')} ${back ?? '—'}   ` +
      `${c.dim('动爻')} ${d.bianShu === 0 ? '静' : d.bianShu}   ` +
      `${c.dim('互')} ${nameOf(hu(d.ben))}   ${c.dim('错')} ${nameOf(cuo(d.ben))}   ` +
      `${c.dim('综')} ${nameOf(zong(d.ben))}`
  );
  return out.join('\n');
}

function cmdRun() {
  const file = args[1];
  if (!file) return usage();

  const m = loadMachine(file);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '行 ' });

  const intro =
    `\n  ${c.bold('卦境')} · ${c.dim('你在六十四卦之间行走。目标：走到 既济。')}\n` +
    `  ${c.dim('1-6 变第 n 爻　c 错卦　z 综卦　h 互卦　q 退出')}`;
  console.log(intro + renderRoom(m));

  rl.on('line', (line) => {
    const s = line.trim();
    if (s === 'q' || s === 'quit' || s === ':q') return rl.close();
    if (s === '') return rl.prompt();

    let ok = false;
    let res = null;

    if (/^[1-6]$/.test(s)) {
      res = m.step('行', Number(s));
      ok = true;
    } else if (EV_ALIAS[s]) {
      res = m.step(EV_ALIAS[s], 0);
      ok = true;
    } else if (m.ir.events.some((e) => e.name === s)) {
      res = m.step(s, 0);
      ok = true;
    }

    if (!ok) {
      console.log(c.yellow(`  看不懂 "${s}"。用 1-6 / c / z / h / q`));
      return rl.prompt();
    }

    if (!res.ok) {
      console.log(c.yellow(`  ${res.reason}`));
    } else {
      console.log(renderRoom(m));
      if (m.describe().ben === BY_NAME.get('既济').id) {
        console.log(`\n  ${c.bold('既济。')}你已经走到六十四卦里唯一全当位的那一间。\n`);
      }
    }
    console.log('');
    rl.prompt();
  });

  rl.on('close', () => console.log(''));
}

function cmdBuild() {
  const file = args[1];
  if (!file) return usage();

  const ir = buildIr(parse(readFileSync(file, 'utf8')));
  const out =
    flags.get('o') ??
    join(dirname(file), basename(file).replace(/\.yao$/, '') + '.c');
  if (flags.get('target') === 'wasm') {
    const wasmOut =
      flags.get('o') ??
      join(dirname(file), basename(file).replace(/\.yao$/, '') + '.wasm');
    const { bytes, meta } = emitWasm(ir);
    writeFileSync(wasmOut, bytes);
    console.log(`已生成 ${wasmOut}`);
    console.log(
      c.dim(`  ${(bytes.length / 1024).toFixed(1)} KB，转移表 ${meta.states} × ${meta.cols} 列`)
    );
    return;
  }

  const code = emitC(ir, { emitMain: flags.has('main') });
  const hdr = flags.has('header') ? emitHeader(ir) : null;

  writeFileSync(out, code, 'utf8');
  if (hdr) writeFileSync(out.replace(/\.c$/, '.h'), hdr, 'utf8');
  console.log(`已生成 ${out}`);
  console.log(c.dim(`  ${ir.states.size} 态 / ${ir.events.length} 事件 / ${ir.rules.length} 规则`));
}

function cmdTrace() {
  const file = args[1];
  if (!file) return usage();

  const ir = buildIr(parse(readFileSync(file, 'utf8')));
  const script = args.slice(2).map((s) => {
    const [ev, a] = s.split(':');
    return [ev, a === undefined ? 0 : Number(a)];
  });

  const rows = trace(ir, script);
  for (const r of rows) {
    const b = ben(r.state);
    const tag = `[${toDigits(r.state)}]`;
    if (r.error) {
      console.log(`${String(r.step).padStart(3)}  ${r.event.padEnd(6)}  ✗ ${r.error}`);
      break;
    }
    console.log(
      `${String(r.step).padStart(3)}  ${String(r.event).padEnd(6)}  ` +
        `${nameOf(b).padEnd(4)} ${BY_ID[b].glyph}  ${tag}`
    );
  }
}

function cmdCheck() {
  const file = args[1];
  if (!file) return usage();

  const ir = buildIr(parse(readFileSync(file, 'utf8')));
  const t0 = Date.now();
  const a = analyze(ir);
  const ms = Date.now() - t0;

  if (flags.has('json')) {
    console.log(JSON.stringify({
      machine: ir.name,
      states: a.declaredCount,
      reachableStates: a.reachableCount,
      stateSpace: a.stateSpace,
      reachableDeclared: a.reachableDeclared,
      unreachable: a.unreachableStates.map((s) => s.name),
      dead: a.deadStates.map((s) => nameOf(ben(s))),
      undefinedTransitions: a.undefined.count,
      undefinedSample: a.undefined.sample,
      scc: a.scc,
      stronglyConnected: a.stronglyConnected,
      diameter: a.diameter,
    }, null, 2));
    return;
  }

  // 最近/最远的声明态
  let maxD = 0;
  let maxName = '—';
  for (const s of ir.states.values()) {
    const d = a.distances.get(s.ben);
    if (d !== undefined && d > maxD) { maxD = d; maxName = s.name; }
  }

  const benToName = new Map();
  for (const st of ir.states.values()) benToName.set(st.ben, st.name);
  const stateName = (v) => benToName.get(ben(v)) ?? nameOf(ben(v));

  const undefinedTotal = a.declaredCount * ir.events.length;
  const ok = a.unreachableStates.length === 0 && a.deadStates.length === 0;

  const L = [];
  L.push('');
  L.push(`  ${c.bold(ir.name)} · 验证`);
  L.push('');
  L.push(row('声明态', `${a.declaredCount}`));
  L.push(row('可达态', `${a.reachableCount} / ${a.stateSpace}`));
  L.push(row('态可达', `${a.reachableDeclared} / ${a.declaredCount}`));
  L.push(row('死态', `${a.deadStates.length}`));
  L.push(row('未定义转移', `${a.undefined.count} / ${undefinedTotal}（态 × 事件）`));
  if (a.grouped) {
    L.push(row('状态空间', `64^${ir.components.length} = ${a.stateSpace}`));
    L.push(row('强连通', '—（组机不计算）'));
    L.push(row('图直径', '—（组机不计算）'));
  } else {
    L.push(row('强连通', a.stronglyConnected
      ? `是（1 个分量，${a.scc.largest} 个状态）`
      : `否（${a.scc.count} 个分量，最大 ${a.scc.largest}）`));
    L.push(row('图直径', !a.stronglyConnected
      ? '—（图非强连通）'
      : (a.diameter === null ? '—（分量过大，已跳过）' : `${a.diameter} 步`)));
    L.push(row('最远的态', `${maxName}（${maxD} 步）`));
  }
  L.push(row('耗时', `${ms} ms`));

  if (a.unreachableStates.length) {
    L.push('');
    L.push(`  ${c.yellow('Y0203')} 到不了的态：` + a.unreachableStates.slice(0, 8).map((s) => s.name).join(' '));
  }
  if (a.deadStates.length) {
    L.push('');
    L.push(`  ${c.yellow('Y0204')} 死态：` + a.deadStates.slice(0, 8).map(stateName).join(' '));
  }
  if (a.undefined.count && a.undefined.sample.length) {
    L.push('');
    L.push(`  ${c.dim('未定义转移样例：')}`);
    for (const u of a.undefined.sample.slice(0, 6)) {
      L.push(`    ${stateName(u.ben)} × ${u.event}`);
    }
  }

  L.push('');
  L.push(ok ? `  ${c.bold('✓ 没有发现问题')}` : `  ${c.yellow('! 有问题，见上')}`);
  L.push('');

  console.log(L.join('\n'));
  if (!ok && flags.has('strict')) process.exitCode = 1;
}

function row(label, value) {
  const w = [...label].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return `  ${label}${' '.repeat(Math.max(0, 12 - w))}${value}`;
}

// ---------------------------------------------------------------- 占

function cmdDivine() {
  const src = args.slice(1).join(' ');
  let x;
  let seed = null;

  if (src) {
    x = normalize(evalExpr(src));
  } else {
    seed = flags.has('seed') ? Number(flags.get('seed')) >>> 0
      : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    x = cast({ seed, method: flags.get('法') ?? '金钱' });
  }

  const corpus = loadCorpus();
  const j = judge(x, corpus);

  const b = ben(x);
  const z = zhi(x);
  const n = bianShu(x);

  const L = [];
  L.push('');
  L.push(
    `  ${c.dim('本卦')} ${c.bold(nameOf(b))} ${BY_ID[b].glyph}` +
      (n ? `   ${c.dim('之卦')} ${c.bold(nameOf(z))} ${BY_ID[z].glyph}` : '') +
      `   ${c.dim(`变数 ${n}`)}`
  );
  L.push(`  ${c.dim(j.rule)}`);
  L.push('');

  j.entries.forEach((e, i) => {
    const kindName = e.kind === '用' ? '' : e.kind === '卦' ? '卦辞' : '爻辞';
    const star = j.entries.length > 1 && i === j.main ? c.yellow('（主）') : '';
    L.push(
      `  ${c.bold(e.label ?? e.hexName)} ${c.dim(kindName)}${star}  ` +
        `${BY_ID[e.hex].glyph}`
    );
    L.push(`    ${e.text}`);
    L.push('');
  });

  console.log(L.join('\n'));
  if (seed !== null) console.log(c.dim(`  种子 ${seed}（用 --seed=${seed} 可复现）`));
  if (corpus.status === 'draft') {
    console.log(c.dim('  辞库状态：draft（通行本，未逐字校对）'));
  }
}

function cmdCorpus() {
  const corpus = loadCorpus();
  const cov = coverage(corpus);

  const L = [];
  L.push('');
  L.push(`  ${c.bold('辞库')}  ${c.dim(corpus.source)}`);
  L.push('');
  L.push(row('总条目', `${cov.filled} / ${cov.total}`));
  L.push(row('已校对', `${cov.verifiedCount} / ${cov.total}`));
  L.push(row('状态', corpus.status === 'draft' ? 'draft（未逐字校对）' : 'verified'));

  if (cov.missing.length) {
    L.push('');
    L.push(`  ${c.yellow('缺失')}：` + cov.missing.slice(0, 10).join(' '));
  }

  if (flags.has('unverified')) {
    L.push('');
    if (!cov.unverified.length) {
      L.push(`  ${c.bold('✓ 全部已校对')}`);
    } else {
      L.push(`  ${c.dim(`未校对（${cov.unverified.length} 条，列前 40）：`)}`);
      for (const k of cov.unverified.slice(0, 40)) L.push(`    ${k}`);
      if (cov.unverified.length > 40) L.push(c.dim(`    …… 还有 ${cov.unverified.length - 40} 条`));
      L.push('');
      L.push(c.dim('  校对后把键写进 data/corpus.verified.txt，再跑 tools/build_corpus.py'));
    }
  } else if (!cov.missing.length) {
    L.push('');
    L.push(`  ${c.bold('✓ 64 卦辞 / 384 爻辞 / 用九用六 全部就位')}`);
    if (cov.verifiedCount < cov.total) {
      L.push(c.dim(`  其中 ${cov.total - cov.verifiedCount} 条尚未校对，用 --unverified 查看`));
    }
  }

  L.push('');
  console.log(L.join('\n'));

  if (flags.has('strict') && cov.verifiedCount < cov.total) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- 游戏

function cmdGame() {
  const file =
    flags.get('machine') ??
    join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'yao-zhen', 'yao_zhen.yao');

  const ir = buildIr(parse(readFileSync(file, 'utf8')));
  const step = makeStepper(ir);
  const m = new Machine(ir);
  const corpus = loadCorpus();

  const budgetOf = (p) => p + 2;

  let level = 0;
  let steps = 0;
  let parNow = 0;
  let startState = m.state;

  const targetBen = (lv) => BY_NAME.get(LEVELS[lv].target).id;

  const header = () => {
    const lv = LEVELS[level];
    const t = targetBen(level);
    const cur = ben(m.state);
    return (
      `\n  ${c.dim(`第 ${level + 1} / ${LEVELS.length} 关`)} · ${c.bold(lv.title)}  ` +
      `${c.dim(lv.hint)}\n` +
      `  ${c.dim('目标')} ${c.bold(lv.target)} ${BY_ID[t].glyph}   ` +
      `${c.dim('步数')} ${steps} / ${budgetOf(parNow)}   ${c.dim(`最优 ${parNow}`)}` +
      (cur === t ? `   ${c.yellow('已到')}` : '')
    );
  };

  const board = () => {
    const cur = ben(m.state);
    const lines = renderLines(cur, { ascii: ASCII });
    const md = BY_ID[cur];
    return (
      `\n  ${c.bold(md.name)} ${md.glyph}  ${c.dim(`上${md.upper} 下${md.lower}`)}\n` +
      lines.map((l) => '  ' + l).join('\n')
    );
  };

  const resetLevel = () => {
    m.state = startState;
    steps = 0;
    parNow = par(step, ben(m.state), targetBen(level)) ?? 99;
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '爻 ' });

  console.log(
    `\n  ${c.bold('爻阵')} · ${c.dim('按第 n 爻，该爻与相邻之爻一起翻转。让卦走到目标。')}\n` +
      `  ${c.dim('1-6 按爻   r 重来本关   q 退出')}`
  );

  resetLevel();
  console.log(header() + board());

  rl.on('line', (line) => {
    const s = line.trim();

    if (s === 'q') return rl.close();
    if (s === 'r') {
      // 回到本关起点，不是"把现在的位置当作起点"
      m.state = startState;
      steps = 0;
      parNow = par(step, ben(m.state), targetBen(level)) ?? 99;
      console.log(c.dim('\n  本关重来。') + header() + board());
      return rl.prompt();
    }

    if (!/^[1-6]$/.test(s)) {
      console.log(c.yellow('  输入 1-6 按爻，r 重来，q 退出'));
      return rl.prompt();
    }

    const r = m.step('行', Number(s));
    if (!r.ok) {
      console.log(c.yellow('  ' + r.reason));
      return rl.prompt();
    }
    steps++;

    const cur = ben(m.state);
    const t = targetBen(level);

    if (cur === t) {
      const text = corpus.entries[LEVELS[level].target].c;
      console.log(header() + board());
      console.log(`\n  ${c.bold('成。')}「${text}」`);
      if (steps === parNow) console.log(c.yellow('  最优解。'));
      level++;
      if (level >= LEVELS.length) {
        console.log(`\n  ${c.bold('六关皆过。')}${c.dim('你走完了这一局。')}\n`);
        return rl.close();
      }
      startState = m.state;
      steps = 0;
      parNow = par(step, ben(m.state), targetBen(level)) ?? 99;
      console.log(header() + board());
      return rl.prompt();
    }

    if (steps > budgetOf(parNow)) {
      console.log(header() + board());
      console.log(`\n  ${c.yellow('卦象散乱。')}${c.dim('步数用尽，本关重来。')}`);
      m.state = startState;
      steps = 0;
      parNow = par(step, ben(m.state), targetBen(level)) ?? 99;
      console.log(header() + board());
      return rl.prompt();
    }

    console.log(header() + board());
    rl.prompt();
  });

  rl.on('close', () => console.log(''));
}

// ---------------------------------------------------------------- REPL

function repl() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '爻 ' });

  console.log(`爻 · Yao v0.1  ${c.dim('(:h 帮助, :q 退出)')}`);
  console.log(c.dim('  试试  既济   987789   互(既济)   变数(既济/初上)'));
  console.log('');

  rl.prompt();
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return rl.prompt();
    if (s === ':q' || s === ':quit' || s === 'exit') return rl.close();
    if (s === ':h' || s === ':help') {
      usage();
      return rl.prompt();
    }
    if (s === ':t' || s === ':table') {
      cmdTable();
      return rl.prompt();
    }
    try {
      console.log(parseInput(s));
    } catch (err) {
      reportError(err);
    }
    console.log('');
    rl.prompt();
  });
  rl.on('close', () => console.log(''));
}

function reportError(err) {
  if (err instanceof LexError || err instanceof EvalError) {
    console.error(c.yellow(`  ${err.code ?? 'err'}: ${err.message}`));
    return;
  }
  console.error(c.yellow(`  内部错误: ${err.message}`));
  if (flags.has('--debug')) console.error(err.stack);
}

// ---------------------------------------------------------------- 入口

/** 批处理：从标准输入逐行求值（用于脚本与 CI） */
function batch() {
  const src = readFileSync(0, 'utf8');
  const out = [];
  for (const raw of src.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    try {
      out.push(parseInput(s));
    } catch (err) {
      reportError(err);
      process.exitCode = 1;
    }
  }
  if (out.length) console.log(out.join('\n'));
}

function main() {
  if (flags.has('help') || flags.has('h')) return usage();
  if (flags.has('version') || flags.has('v')) {
    console.log('爻 · Yao v0.1  (spec 0.1)');
    return;
  }

  const cmd = args[0];

  if (args.length === 0) {
    if (process.stdin.isTTY) return repl();
    return batch();
  }

  try {
    switch (cmd) {
      case 'cast': return cmdCast();
      case 'info': return cmdInfo();
      case 'repl': return repl();
      case 'eval': {
        const src = args.slice(1).join(' ');
        if (!src) return usage();
        console.log(parseInput(src));
        return;
      }
      case 'run': return cmdRun();
      case 'game': return cmdGame();
      case 'divine': return cmdDivine();
      case 'corpus': return cmdCorpus();
      case 'check': return cmdCheck();
      case 'build': return cmdBuild();
      case 'trace': return cmdTrace();
      case 'table': return cmdTable();
      case 'test': return cmdTest();
      case 'help': case '--help': case '-h': return usage();
      default: return usage();
    }
  } catch (err) {
    reportError(err);
    process.exitCode = 1;
  }
}

main();
