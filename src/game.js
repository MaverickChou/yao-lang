/**
 * 爻 · 爻阵（游戏壳）
 *
 * 机器只负责移动，这一层负责：关卡、最优步数、胜负判定、叙述。
 * 这不是语言的一部分，是第一个"真的能玩"的程序。
 */

import { BY_NAME, ben, nameOf } from './core.js';
import { Machine } from './interp.js';

/** 关卡：目标卦 + 一句引子 */
export const LEVELS = [
  { target: '泰', title: '通', hint: '天地交而万物通。' },
  { target: '谦', title: '抑', hint: '谦谦君子，用涉大川。' },
  { target: '复', title: '返', hint: '七日来复。' },
  { target: '咸', title: '感', hint: '憧憧往来，朋从尔思。' },
  { target: '大有', title: '有', hint: '自天祐之，吉无不利。' },
  { target: '既济', title: '成', hint: '六十四卦里唯一全当位的那一间。' },
];

/**
 * 用真实的机器语义构造步进函数：不在这里重写规则。
 * @param {object} ir
 * @returns {(b: number, n: number) => number|null}
 */
export function makeStepper(ir) {
  const m = new Machine(ir);
  return (b, n) => {
    m.state = b;
    const r = m.step('行', n);
    return r.ok ? ben(m.state) : null;
  };
}

/**
 * 两卦之间的最短步数（BFS 全 64 节点）。
 * @returns {number|null} 不可达返回 null
 */
export function par(step, from, to) {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length) {
    d++;
    const next = [];
    for (const b of frontier) {
      for (let n = 1; n <= 6; n++) {
        const t = step(b, n);
        if (t === null || seen.has(t)) continue;
        if (t === to) return d;
        seen.add(t);
        next.push(t);
      }
    }
    frontier = next;
  }
  return null;
}

/** 一步会翻转哪些爻（用于教学提示） */
export function flippedLines(n) {
  if (n === 1) return [1, 2];
  if (n === 6) return [5, 6];
  return [n - 1, n, n + 1];
}

export { BY_NAME, ben, nameOf };
