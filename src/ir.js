/**
 * 爻 · 机器 IR 构建与静态检查
 *
 * 产出物是一个纯数据对象，解释器与 C 后端都只读它。
 * 本层负责 M2 能查出来的全部错误：重名、重卦、未声明的事件/态、非确定转移。
 */

import { ben } from './core.js';
import { evalAst, EvalAstError } from './evalast.js';

export class IrError extends Error {
  constructor(msg, code = 'Y0200') {
    super(msg);
    this.name = 'IrError';
    this.code = code;
  }
}

/**
 * @param {object} ast parse() 的结果
 */
export function buildIr(ast) {
  if ((ast.groups ?? []).length) return buildGroupedIr(ast);

  // ---- 事件
  const events = new Map();
  for (const e of ast.events) {
    if (events.has(e.name)) throw new IrError(`事件 "${e.name}" 重复声明`, 'Y0012');
    events.set(e.name, { name: e.name, param: e.param });
  }
  if (events.size === 0) throw new IrError('机器至少要声明一个 `事`', 'Y0011');

  // ---- 态
  const states = new Map();
  const byBen = new Map();
  for (const s of ast.states) {
    if (states.has(s.name)) throw new IrError(`态 "${s.name}" 重复声明`, 'Y0012');

    let value;
    try {
      value = evalAst(s.value, {});
    } catch (err) {
      if (err instanceof EvalAstError) {
        throw new IrError(`态 "${s.name}" 的值必须是常量：${err.message}`, 'Y0013');
      }
      throw err;
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xfff) {
      throw new IrError(`态 "${s.name}" 的值超出 12 位范围：${value}`, 'Y0101');
    }

    const b = ben(value);
    if (byBen.has(b)) {
      throw new IrError(
        `态 "${s.name}" 与 "${byBen.get(b)}" 的本卦相同（都是 ${b}）。` +
          `转移按本卦匹配，两者无法区分（Y0101）`,
        'Y0101'
      );
    }
    byBen.set(b, s.name);
    states.set(s.name, { name: s.name, value, ben: b });
  }
  if (states.size === 0) throw new IrError('机器至少要声明一个 `态`', 'Y0011');

  // ---- 起始
  if (ast.starts.length !== 1) {
    throw new IrError(`非 组 机器的 \`起\` 只能给一个态，收到 ${ast.starts.length} 个`, 'Y0205');
  }
  const start = states.get(ast.starts[0]);
  if (!start) throw new IrError(`起始态 "${ast.starts[0]}" 未声明`, 'Y0205');

  /** 态名可以在转移目标里当常量用：`-> 放行` */
  const consts = {};
  for (const [n, s] of states) consts[n] = s.value;

  // ---- 转移
  const rules = [];
  const seen = new Map(); // `${fromBen}:${event}` -> rule
  for (const r of ast.rules) {
    const ev = events.get(r.event);
    if (!ev) throw new IrError(`转移引用了未声明的事件 "${r.event}"`, 'Y0014');

    let fromBen = null;
    if (r.from !== null) {
      const st = states.get(r.from);
      if (!st) throw new IrError(`转移引用了未声明的态 "${r.from}"`, 'Y0014');
      fromBen = st.ben;
    }

    const key = `${fromBen}:${r.event}`;
    if (seen.has(key)) {
      const where = fromBen === null ? '`*`' : `态 "${r.from}"`;
      throw new IrError(`${where} 的事件 "${r.event}" 有两条转移规则（非确定，Y0202）`, 'Y0202');
    }

    checkVars(r.target, new Set([...states.keys(), ...(ev.param ? [ev.param] : [])]), r.event);
    seen.set(key, true);

    rules.push({ from: r.from, fromBen, event: r.event, param: ev.param, target: r.target });
  }

  // ---- 起始态必须出现在已声明的态里，且至少有一条出边
  const startHasOut = rules.some((r) => r.fromBen === null || r.fromBen === start.ben);
  if (!startHasOut) throw new IrError(`起始态 "${start.name}" 没有任何出边（Y0204 死锁）`, 'Y0204');

  return {
    name: ast.name,
    events: [...events.values()],
    states,
    rules,
    start,
    consts,
  };
}

/** 校验表达式里只出现允许的变量 */
function checkVars(ast, allowed, eventName) {
  switch (ast.t) {
    case 'lit':
    case 'ben':
    case 'state':
      return;
    case 'var':
      if (!allowed.has(ast.name)) {
        throw new IrError(
          `表达式引用了未定义的名字 "${ast.name}"；` +
            `事件 "${eventName}" 可用的参数是 ${[...allowed].join(', ') || '（无）'}`,
          'Y0014'
        );
      }
      return;
    case 'un':
      return checkVars(ast.x, allowed, eventName);
    case 'bin':
      checkVars(ast.l, allowed, eventName);
      return checkVars(ast.r, allowed, eventName);
    case 'call':
      for (const a of ast.args) checkVars(a, allowed, eventName);
      return;
    case 'match':
      checkVars(ast.subject, allowed, eventName);
      for (const arm of ast.arms) checkVars(arm.body, allowed, eventName);
      return;
    case 'block':
      for (const e of ast.effects) checkVars(e, allowed, eventName);
      return checkVars(ast.target, allowed, eventName);
    case 'if':
      checkVars(ast.cond, allowed, eventName);
      checkVars(ast.then, allowed, eventName);
      return checkVars(ast.otherwise, allowed, eventName);
    default:
      throw new IrError(`未知表达式节点 "${ast.t}"`);
  }
}

/** 按事件把规则分组，解释器与后端共用 */
export function groupRules(ir) {
  const byEvent = new Map();
  for (const ev of ir.events) byEvent.set(ev.name, { specific: new Map(), wildcard: null });
  for (const r of ir.rules) {
    const g = byEvent.get(r.event);
    if (r.fromBen === null) g.wildcard = r;
    else g.specific.set(r.fromBen, r);
  }
  return byEvent;
}

/**
 * 组机器的 IR。
 *
 * 与单机不同的三件事：
 *   1. 状态是 N 个 6 位值（组件），不是 1 个 12 位变 —— 所以总状态数是 64^N
 *   2. 一个事件**只能属于一个组件**，编译期检查，运行期因此没有歧义
 *   3. 不允许 `*` 源态：通配会让事件无法唯一确定组件
 */
function buildGroupedIr(ast) {
  const events = new Map();
  for (const e of ast.events) {
    if (events.has(e.name)) throw new IrError(`事件 "${e.name}" 重复声明`, 'Y0012');
    events.set(e.name, { name: e.name, param: e.param });
  }
  if (!events.size) throw new IrError('机器至少要声明一个 `事`', 'Y0011');

  if ((ast.states ?? []).length) {
    throw new IrError('`组` 与 `态` 不能混用：组机器的状态由组成员构成', 'Y0010');
  }

  const components = [];
  const compIndex = new Map();
  const states = new Map();
  const consts = {};

  for (const g of ast.groups) {
    if (compIndex.has(g.name)) throw new IrError(`组 "${g.name}" 重复声明`, 'Y0012');

    const members = [];
    const byBen = new Map();

    for (const m of g.members) {
      if (members.some((x) => x.name === m.name)) {
        throw new IrError(`组 "${g.name}" 的成员 "${m.name}" 重复声明`, 'Y0012');
      }

      let value;
      try {
        value = evalAst(m.value, {});
      } catch (err) {
        if (err instanceof EvalAstError) {
          throw new IrError(`成员 "${g.name}.${m.name}" 必须是常量：${err.message}`, 'Y0013');
        }
        throw err;
      }
      if (!Number.isInteger(value) || value < 0 || value > 0x3f) {
        throw new IrError(
          `组成员只能取 0..63（卦），"${g.name}.${m.name}" 得到 ${value}`,
          'Y0101'
        );
      }

      const b = ben(value);
      if (byBen.has(b)) {
        throw new IrError(
          `组 "${g.name}" 里 "${m.name}" 与 "${byBen.get(b)}" 本卦相同，无法按卦匹配（Y0101）`,
          'Y0101'
        );
      }
      byBen.set(b, m.name);
      members.push({ name: m.name, value, ben: b });
    }

    const index = components.length;
    components.push({ name: g.name, index, members, byBen });
    compIndex.set(g.name, index);

    for (const m of members) {
      const full = `${g.name}.${m.name}`;
      states.set(full, { name: full, value: m.value, ben: m.ben, comp: index });
      consts[full] = m.value;
    }
  }

  // ---- 起点：每个组件各一个
  if (ast.starts.length !== components.length) {
    throw new IrError(
      `组机器要给每个组件一个起点：${components.length} 个组件，收到 ${ast.starts.length} 个`,
      'Y0205'
    );
  }
  const startVals = new Array(components.length).fill(null);
  for (const s of ast.starts) {
    const st = states.get(s);
    if (!st) throw new IrError(`起始态 "${s}" 未声明`, 'Y0205');
    if (startVals[st.comp] !== null) {
      throw new IrError(`组件 "${components[st.comp].name}" 给了两个起点`, 'Y0205');
    }
    startVals[st.comp] = st.value;
  }

  // ---- 规则
  const rules = [];
  const eventComp = new Map();
  const seen = new Set();

  for (const r of ast.rules) {
    if (r.from === null) {
      throw new IrError('组 机器不支持 `*` 源态：事件必须能唯一确定组件', 'Y0202');
    }
    const st = states.get(r.from);
    if (!st) throw new IrError(`转移引用了未声明的成员 "${r.from}"`, 'Y0014');

    const ev = events.get(r.event);
    if (!ev) throw new IrError(`转移引用了未声明的事件 "${r.event}"`, 'Y0014');

    if (eventComp.has(r.event) && eventComp.get(r.event) !== st.comp) {
      throw new IrError(
        `事件 "${r.event}" 同时被组件 "${components[eventComp.get(r.event)].name}" ` +
          `与 "${components[st.comp].name}" 使用；组机器里一个事件只能属于一个组件`,
        'Y0202'
      );
    }
    eventComp.set(r.event, st.comp);

    const key = `${st.comp}:${st.ben}:${r.event}`;
    if (seen.has(key)) {
      throw new IrError(`"${st.name}" 对事件 "${r.event}" 有两条规则（非确定，Y0202）`, 'Y0202');
    }
    seen.add(key);

    checkVars(r.target, new Set([...states.keys(), ...(ev.param ? [ev.param] : [])]), r.event);
    rules.push({ from: r.from, comp: st.comp, fromBen: st.ben, event: r.event, param: ev.param, target: r.target });
  }

  if (!rules.length) throw new IrError('组机器至少要有一条转移规则', 'Y0204');

  return {
    name: ast.name,
    grouped: true,
    events: [...events.values()],
    components,
    states,
    consts,
    rules,
    start: { name: ast.starts.join('+'), value: startVals },
    startVals,
  };
}