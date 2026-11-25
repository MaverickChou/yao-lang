/**
 * 爻 · C99 后端
 *
 * 生成物是一个纯函数式状态机：一个转移函数 + 一个 step 包装。
 * 没有堆、没有栈、没有全局可写状态 —— 宿主只持有那一个 uint16_t。
 */

import { nameOf, ben as benOf } from './core.js';
import { groupRules } from './ir.js';

export class CodegenError extends Error {
  constructor(msg, code = 'Y0500') {
    super(msg);
    this.name = 'CodegenError';
    this.code = code;
  }
}

const MASK = '0x3Fu';

function hex(v, width) {
  return '0x' + v.toString(16).toUpperCase().padStart(width, '0') + 'u';
}

const CMP = new Set(['==', '!=', '<', '>', '<=', '>=']);

const C_FUNCS = {
  错: 'yao_cuo', 综: 'yao_zong', 互: 'yao_hu',
  当位: 'yao_dangwei',
};

/** 6 位表达式 -> C 代码；wide 表示结果是 12 位的变 */
function emit(e, ctx) {
  switch (e.t) {
    case 'lit':
      if (e.kind === 'num') return { code: hex(e.v & 0x3f, 2), wide: false };
      return e.v > 0x3f
        ? { code: hex(e.v, 4), wide: true }
        : { code: hex(e.v, 2), wide: false };

    case 'ben':
      return { code: 'YAO_BEN(s)', wide: false };

    case 'state':
      return { code: 's', wide: true };

    case 'var': {
      const p = ctx.params.get(e.name);
      if (p) return { code: p, wide: false };
      const c = ctx.consts.get(e.name);
      if (c !== undefined) return { code: hex(c, 4), wide: true };
      throw new CodegenError(`未定义的名字 "${e.name}"`);
    }

    case 'un': {
      const x = six(e.x, ctx);
      return { code: e.op === '~' ? `((~${x}) & ${MASK})` : `((0u - ${x}) & ${MASK})`, wide: false };
    }

    case 'bin': {
      const a = six(e.l, ctx);
      const b = six(e.r, ctx);
      if (CMP.has(e.op)) {
        return { code: `(((${a}) ${e.op} (${b})) ? 1u : 0u)`, wide: false };
      }
      const expr = `(${a} ${e.op} ${b})`;
      return { code: `(${expr} & ${MASK})`, wide: false };
    }

    case 'if': {
      const c = six(e.cond, ctx);
      const t = emit(e.then, ctx);
      const f = emit(e.otherwise, ctx);
      const wide = t.wide || f.wide;
      return { code: `((${c}) != 0u ? ${t.code} : ${f.code})`, wide };
    }

    case 'call': {
      const name = e.name;

      if (name === '变') {
        if (e.args.length !== 2) throw new CodegenError('变 需要 2 个参数');
        const a = six(e.args[0], ctx);
        const b = six(e.args[1], ctx);
        return { code: `(uint16_t)((${a}) | ((${b}) << 6))`, wide: true };
      }

      if (name === '静' || name === '卦' || name === '数') {
        return { code: six(e.args[0], ctx), wide: false };
      }

      if (name === '变数') {
        // 变数 数的是动爻，必须拿到完整的 12 位，不能先投影成卦
        const a = six(e.args[0], ctx, true);
        ctx.used.add(name);
        return { code: `yao_bianshu(${a})`, wide: false };
      }

      if (C_FUNCS[name]) {
        const a = six(e.args[0], ctx);
        ctx.used.add(name);
        return { code: `${C_FUNCS[name]}(${a})`, wide: false };
      }

      if (name === '本' || name === '动' || name === '之') {
        const a = six(e.args[0], ctx, true);
        return { code: `YAO_${name === '本' ? 'BEN' : name === '动' ? 'DONG' : 'ZHI'}(${a})`, wide: false };
      }

      throw new CodegenError(`C 后端暂不支持函数 "${name}"（M3 补齐）`);
    }

    case 'match': {
      const subj = six(e.subject, ctx);
      const cases = e.arms.filter((a) => a.pattern !== null);
      const def = e.arms.find((a) => a.pattern === null);
      if (!def) throw new CodegenError('`合` 必须有 `_` 兜底分支才可编译到 C（Y0201）');

      const arms = cases.map((a) => ({ pattern: a.pattern, ...emit(a.body, ctx) }));
      const fallback = emit(def.body, ctx);
      // 卦 可以隐式提升为 变（动 = 0），而提升在数值上是恒等，所以混合位宽合法：
      // 只要有一支是 变，整个 合 就是 变。
      const wide = fallback.wide || arms.some((a) => a.wide);

      let code = fallback.code;
      for (let k = arms.length - 1; k >= 0; k--) {
        code = `((${subj}) == ${hex(arms[k].pattern, 2)} ? ${arms[k].code} : ${code})`;
      }
      return { code: `(${code})`, wide };
    }

    default:
      throw new CodegenError(`未知表达式节点 "${e.t}"`);
  }
}

/** 取 6 位形式；wide 时套一层投影 */
function six(e, ctx, keepWide = false) {
  const r = emit(e, ctx);
  if (!r.wide) return r.code;
  return keepWide ? r.code : `YAO_BEN(${r.code})`;
}

const FUNC_DEF = {
  错: [
    "static uint16_t yao_cuo(uint16_t x) {",
    "  return (uint16_t)((x & 0x3Fu) ^ 0x3Fu);",
    "}",
  ].join("\n"),
  综: [
    "static uint16_t yao_zong(uint16_t x) {",
    "  uint16_t v = (uint16_t)(x & 0x3Fu), r = 0;",
    "  for (int i = 0; i < 6; i++) if ((v >> i) & 1u) r |= (uint16_t)(1u << (5 - i));",
    "  return r;",
    "}",
  ].join("\n"),
  互: [
    "static uint16_t yao_hu(uint16_t x) {",
    "  uint16_t v = (uint16_t)(x & 0x3Fu);",
    "  return (uint16_t)(((v >> 1) & 7u) | (((v >> 2) & 7u) << 3));",
    "}",
  ].join("\n"),
  变数: [
    "static uint16_t yao_bianshu(uint16_t x) {",
    "  uint16_t v = (uint16_t)((x >> 6) & 0x3Fu), n = 0;",
    "  while (v) { v &= (uint16_t)(v - 1u); n++; }",
    "  return n;",
    "}",
  ].join("\n"),
  当位: [
    "static uint16_t yao_dangwei(uint16_t x) {",
    "  uint16_t v = (uint16_t)(x & 0x3Fu), n = 0;",
    "  for (int p = 1; p <= 6; p++) {",
    "    uint16_t want = (p % 2 == 1) ? 1u : 0u;",
    "    if (((v >> (p - 1)) & 1u) == want) n++;",
    "  }",
    "  return n;",
    "}",
  ].join("\n"),
};

/**
 * 生成配套头文件。
 *
 * 没有它，宿主只能手工声明原型与事件常量 —— 那等于让调用方复述一遍生成物的约定。
 * @param {object} ir
 * @returns {string}
 */
export function emitHeader(ir) {
  const lines = [];
  lines.push('/* 由 yao 生成，请勿手工修改。 */');
  lines.push(`/* machine: ${ir.name} */`);
  lines.push('#ifndef YAO_GENERATED_H');
  lines.push('#define YAO_GENERATED_H');
  lines.push('');
  lines.push('#include <stdint.h>');
  lines.push('');
  lines.push('#define YAO_NONE 0xFFFFu');
  lines.push('#define YAO_BEN(s)  ((uint16_t)((s) & 0x3Fu))');
  lines.push('#define YAO_DONG(s) ((uint16_t)(((s) >> 6) & 0x3Fu))');
  lines.push('#define YAO_ZHI(s)  ((uint16_t)(YAO_BEN(s) ^ YAO_DONG(s)))');
  lines.push('');
  lines.push('/* 起始状态 */');
  lines.push(`#define YAO_START ${hex(ir.start.value, 4)}  /* ${ir.start.name} */`);
  lines.push('');
  lines.push('/* 事件号：按 `事` 的声明顺序，从 1 开始 */');
  ir.events.forEach((ev, i) => {
    lines.push(`#define EV_${i} ${i + 1}u  /* ${ev.name}${ev.param ? '(' + ev.param + ')' : ''} */`);
  });
  lines.push(`#define YAO_EVENT_COUNT ${ir.events.length}u`);
  lines.push('');

  if (ir.rules.some((r) => r.target.t === 'block')) {
    lines.push('/* 输出汇：宿主可赋值；为空指针时什么也不做。它不参与状态计算。 */');
    lines.push('extern void (*yao_sink)(uint16_t);');
    lines.push('');
  }

  lines.push('/* 接口 */');
  lines.push('void     yao_init(uint16_t *s);');
  lines.push('uint16_t yao_state(uint16_t s);');
  lines.push('');
  lines.push('/* 返回 0 = 已转移，1 = 该事件在此态下无定义 */');
  lines.push('int      yao_step(uint16_t *s, uint16_t ev, uint8_t p0);');
  lines.push('');
  lines.push('#endif /* YAO_GENERATED_H */');
  return lines.join('\n') + '\n';
}

/**
 * @param {object} ir buildIr 的结果
 * @param {{emitMain?: boolean, guard?: string}} [opts]
 * @returns {string}
 */
export function emitC(ir, opts = {}) {
  const groups = groupRules(ir);
  const stateList = [...ir.states.values()];
  const lines = [];

  const usedFuncs = new Set();
  const ctxFor = (param) => ({
    params: param ? new Map([[param, 'p0']]) : new Map(),
    consts: new Map(Object.entries(ir.consts ?? {})),
    used: usedFuncs,
  });

  // 先走一遍表达式，收集用到的运行时函数
  const body = [];
  let evIndex = 0;
  let usesSink = false;

  /** 一条规则体：先执行 印 语句，再 return 目标 */
  const emitRule = (rule, ctx) => {
    const t = rule.target;
    if (t.t !== 'block') return `return ${emit(t, ctx).code};`;

    const pre = t.effects
      .map((e) => `      if (yao_sink) yao_sink(${emit(e, ctx).code});`)
      .join('\n');
    usesSink = true;
    return `${pre}\n      return ${emit(t.target, ctx).code};`;
  };

  for (const ev of ir.events) {
    const g = groups.get(ev.name);
    const ctx = ctxFor(ev.param);
    const evName = `EV_${evIndex}`;

    const cases = [];
    for (const [b, rule] of g.specific) {
      cases.push(`    case ${hex(b, 2)}:  /* ${nameOf(b)} */\n${emitRule(rule, ctx)}`);
    }

    const hasWildcard = !!g.wildcard;
    const wildcardCode = hasWildcard ? emitRule(g.wildcard, ctx) : 'return YAO_NONE;';

    if (cases.length === 0) {
      // 没有态特化规则：直接执行通配目标，生成物平铺直叙
      body.push(
        `  case ${evName}: {  /* ${ev.name}${ev.param ? '(' + ev.param + ')' : ''} */\n` +
          (ev.param ? '' : '    (void)p0;\n') +
          `    ${wildcardCode}\n` +
          '  }'
      );
    } else {
      body.push(
        `  case ${evName}: {  /* ${ev.name}${ev.param ? '(' + ev.param + ')' : ''} */\n` +
          (ev.param ? '' : `    (void)p0;\n`) +
          `    switch (YAO_BEN(s)) {\n` +
          cases.join('\n') + '\n' +
          `    default: ${wildcardCode}\n` +
          `    }\n` +
          `  }`
      );
    }
    evIndex++;
  }

  // ---- 头部
  lines.push('/* 由 yao 生成，请勿手工修改。 */');
  lines.push(`/* machine: ${ir.name}   states: ${stateList.length}   events: ${ir.events.length} */`);
  lines.push('#include <stdint.h>');
  lines.push('');
  lines.push('#define YAO_NONE 0xFFFFu');
  lines.push('#define YAO_BEN(s)  ((uint16_t)((s) & 0x3Fu))');
  lines.push('#define YAO_DONG(s) ((uint16_t)(((s) >> 6) & 0x3Fu))');
  lines.push('#define YAO_ZHI(s)  ((uint16_t)(YAO_BEN(s) ^ YAO_DONG(s)))');
  lines.push('');

  // ---- 态与事件常量
  lines.push('/* 态 */');
  stateList.forEach((s, i) => {
    lines.push(`#define ST_${i} ${hex(s.value, 4)}  /* ${s.name} */`);
  });
  lines.push('');
  lines.push('/* 事件 */');
  ir.events.forEach((ev, i) => {
    lines.push(`#define EV_${i} ${i + 1}u  /* ${ev.name}${ev.param ? '(' + ev.param + ')' : ''} */`);
  });
  lines.push('');
  lines.push(`#define YAO_START ${hex(ir.start.value, 4)}  /* ${ir.start.name} */`);
  lines.push('');

  if (usesSink) {
    lines.push('/* 输出汇：宿主可赋值；为空指针时什么也不做。它不参与状态计算。 */');
    lines.push('void (*yao_sink)(uint16_t) = 0;');
    lines.push('');
  }

  if (usedFuncs.size) {
    lines.push('/* 运行时 */');
    for (const k of usedFuncs) lines.push(FUNC_DEF[k]);
    lines.push('');
  }

  lines.push('static uint16_t yao_transition(uint16_t s, uint16_t ev, uint8_t p0) {');
  lines.push('  switch (ev) {');
  lines.push(body.join('\n\n'));
  lines.push('  }');
  lines.push('  return YAO_NONE;');
  lines.push('}');
  lines.push('');
  lines.push('void yao_init(uint16_t *s) { *s = YAO_START; }');
  lines.push('');
  lines.push('uint16_t yao_state(uint16_t s) { return s; }');
  lines.push('');
  lines.push('/* 返回 0 = 已转移，1 = 该事件在此态下无定义 */');
  lines.push('int yao_step(uint16_t *s, uint16_t ev, uint8_t p0) {');
  lines.push('  uint16_t t = yao_transition(*s, ev, p0);');
  lines.push('  if (t == YAO_NONE) return 1;');
  lines.push('  *s = t;');
  lines.push('  return 0;');
  lines.push('}');

  if (opts.emitMain) {
    const sinkDef = usesSink
      ? 'static void yao_main_sink(uint16_t v) { printf("emit %u\\n", (unsigned)v); }'
      : '';
    const sinkInit = usesSink ? 'yao_sink = yao_main_sink;' : '';
    lines.push(
      MAIN.replace(/__GUARD__/g, opts.guard ?? 'yao_main')
        .replace('__SINK_DEF__', sinkDef)
        .replace('__SINK_INIT__', sinkInit)
    );
  }

  return lines.join('\n') + '\n';
}

const MAIN = `
/* ---- 可选：极简命令行宿主（纯 ASCII，不依赖字体） ---- */
#include <stdio.h>
#include <stdlib.h>

__SINK_DEF__

static void print_state(uint16_t s) {
  uint16_t b = YAO_BEN(s);
  char row[7];
  for (int p = 6; p >= 1; p--) row[6 - p] = (char)(((b >> (p - 1)) & 1u) ? '1' : '0');
  row[6] = 0;
  printf("state=%04X  ben=%s  dong=%d  zhi=%02X\\n",
         (unsigned)s, row, (int)YAO_DONG(s), (unsigned)YAO_ZHI(s));
}

int main(void) {
  uint16_t s;
  char line[64];
  __SINK_INIT__
  yao_init(&s);
  print_state(s);
  while (fgets(line, sizeof line, stdin)) {
    int ev = 0, arg = 0;
    if (line[0] == 'q') break;
    if (sscanf(line, "%d %d", &ev, &arg) < 1) continue;
    if (yao_step(&s, (uint16_t)ev, (uint8_t)arg) == 0) print_state(s);
    else printf("no transition\\n");
  }
  return 0;
}
`;
