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
    this.groups = groupRules(ir);
    this.state = ir.start.value;
    this.stepCount = 0;
  }

  get ben() { return ben(this.state); }

  /**
   * 推进一步。
   * @param {string} event
   * @param {number} [arg]
   * @returns {{ok:boolean, from:number, to:number, reason?:string}}
   */
  step(event, arg = 0) {
    const from = this.state;
    const g = this.groups.get(event);
    if (!g) return { ok: false, from, to: from, reason: `未声明的事件 "${event}"` };

    const rule = g.specific.get(ben(from)) ?? g.wildcard;
    if (!rule) return { ok: false, from, to: from, reason: '此路不通' };

    if (rule.param && (arg < 1 || arg > 6)) {
      return { ok: false, from, to: from, reason: `参数 ${arg} 越界（应为 1..6）` };
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
