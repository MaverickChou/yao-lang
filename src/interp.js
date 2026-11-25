/**
 * 爻 · IR 解释器
 *
 * 与 C 后端共享同一份 IR 与同一套语义：这是 M2 能验证"生成的 C 是对的"的前提
 * —— 同一组事件序列在解释器与 C 里必须得到同一条状态轨迹。
 */

import { ben, bianShu, nameOf } from './core.js';
import { evalAst, EvalAstError } from './evalast.js';
import { buildIr, groupRules } from './ir.js';

export const NO_TRANSITION = 0xffff;

export class Machine {
  constructor(ir, opts = {}) {
    this.ir = ir;
    this.sink = typeof opts.sink === 'function' ? opts.sink : null;
    this.stepCount = 0;

    if (ir.grouped) {
      this.states = ir.startVals.slice();
      this.byEvent = new Map(ir.rules.map((r) => [r.event, r]));
    } else {
      this.groups = groupRules(ir);
      this.state = ir.start.value;
    }
  }

  get ben() { return ben(this.state); }

  /** 组机器：某个组件当前的卦 */
  compBen(i) { return ben(this.states[i]); }

  /**
   * 推进一步。
   * @param {string} event
   * @param {number} [arg]
   */
  step(event, arg = 0) {
    if (this.ir.grouped) return this.stepGrouped(event, arg);

    const from = this.state;
    const g = this.groups.get(event);
    if (!g) return { ok: false, from, to: from, reason: `未声明的事件 "${event}"` };

    const rule = g.specific.get(ben(from)) ?? g.wildcard;
    if (!rule) return { ok: false, from, to: from, reason: '此路不通' };

    if (rule.param && (arg < 1 || arg > 6)) {
      return { ok: false, from, to: from, reason: paramHint(event, rule.param, arg) };
    }

    let to;
    try {
      to = evalAst(rule.target, {
        ben: ben(from),
        state: from,
        params: rule.param ? { [rule.param]: arg } : {},
        consts: this.ir.consts,
        sink: this.sink,
      });
    } catch (err) {
      if (err instanceof EvalAstError) {
        return { ok: false, from, to: from, reason: err.message };
      }
      throw err;
    }

    if (!Number.isInteger(to) || to < 0 || to > 0xfff) {
      return { ok: false, from, to: from, reason: `转移目标越界：${to}` };
    }

    this.state = to;
    this.stepCount++;
    return { ok: true, from, to };
  }

  /**
   * 组机器：事件在编译期已唯一绑定到某个组件，运行期只动那一个。
   */
  stepGrouped(event, arg = 0) {
    const rule = this.byEvent.get(event);
    const snap = this.states.slice();
    if (!rule) {
      return { ok: false, from: snap, to: snap, reason: `未声明的事件 "${event}"` };
    }

    const comp = rule.comp;
    const cur = this.states[comp];
    if (ben(cur) !== rule.fromBen) {
      return { ok: false, from: snap, to: snap, reason: '此路不通' };
    }
    if (rule.param && (arg < 1 || arg > 6)) {
      return { ok: false, from: snap, to: snap, reason: paramHint(event, rule.param, arg) };
    }

    let to;
    try {
      to = evalAst(rule.target, {
        ben: ben(cur),
        state: cur,
        params: rule.param ? { [rule.param]: arg } : {},
        consts: this.ir.consts,
        sink: this.sink,
      });
    } catch (err) {
      if (err instanceof EvalAstError) {
        return { ok: false, from: snap, to: snap, reason: err.message };
      }
      throw err;
    }

    if (!Number.isInteger(to) || to < 0 || to > 0x3f) {
      return { ok: false, from: snap, to: snap, reason: `组成员只能取 0..63，得到 ${to}` };
    }

    this.states[comp] = to;
    this.stepCount++;
    const after = this.states.slice();
    return { ok: true, from: snap, to: after, comp };
  }

  describe() {
    const b = ben(this.state);
    return {
      value: this.state,
      ben: b,
      name: nameOf(b),
      dong: this.state > 0x3f ? ((this.state >> 6) & 0x3f) : 0,
      bianShu: bianShu(this.state),
    };
  }
}

/** 从源码直接建机 */
export function compileToMachine(ast) {
  return new Machine(buildIr(ast));
}

/**
 * 跑一串事件，返回轨迹。用于测试与 `yao trace`。
 * @param {ReturnType<typeof buildIr>} ir
 * @param {(string|[string, number])[]} script
 */
export function trace(ir, script) {
  const m = new Machine(ir);
  const out = [{ step: 0, event: '—', state: m.state }];
  for (const item of script) {
    const [ev, arg] = Array.isArray(item) ? item : [item, 0];
    const r = m.step(ev, arg ?? 0);
    if (!r.ok) {
      out.push({ step: m.stepCount, event: ev, state: m.state, error: r.reason });
      break;
    }
    out.push({ step: m.stepCount, event: ev, arg, state: m.state });
  }
  return out;
}

export { NO_TRANSITION as _NO_TRANSITION };

/**
 * 参数不对时给出**可照抄的写法**，而不是只报越界。
 * 起因：示例里写 `运算符` 而它需要 `运算符:1`，报错只说「参数 0 越界」，
 * 读者不知道要补冒号。
 */
function paramHint(event, paramName, arg) {
  if (arg === 0) {
    return `事件 "${event}" 需要参数（${paramName}），写成 "${event}:1"`;
  }
  return `事件 "${event}" 的参数 ${arg} 越界，应为 1..6`;
}