/**
 * 爻 · 验证器
 *
 * 这门语言的卖点在这里：状态空间只有 4096（12 位），所以可以**完全穷举**。
 * 不需要抽象解释、不需要有界检验，直接把可达图跑完。
 *
 * 能回答的问题：
 *   - 声明的态里有没有到不了的（Y0203）
 *   - 有没有走不出去的死态（Y0204）
 *   - 哪些 (态, 事件) 组合没有定义
 *   - 图是否强连通、直径多少
 *   - 从起点到每个态的最短步数
 */

import { ben, nameOf } from './core.js';
import { evalAst } from './evalast.js';
import { groupRules } from './ir.js';

export const STATE_SPACE = 4096;

/**
 * @param {object} ir
 * @param {{maxSccForDiameter?: number}} [opts]
 */
export function analyze(ir, opts = {}) {
  if (ir.grouped) return analyzeGrouped(ir);

  const maxSccForDiameter = opts.maxSccForDiameter ?? 1024;
  const groups = groupRules(ir);
  const events = ir.events;
  const argsFor = (ev) => (ev.param ? [1, 2, 3, 4, 5, 6] : [0]);

  const visited = new Set([ir.start.value]);
  const adj = new Map();
  const undefinedPairs = new Map(); // `${ben}:${event}` -> 次数
  const queue = [ir.start.value];

  while (queue.length) {
    const s = queue.shift();
    const outs = new Map();

    for (const ev of events) {
      const g = groups.get(ev.name);
      const rule = g.specific.get(ben(s)) ?? g.wildcard;

      if (!rule) {
        bump(undefinedPairs, `${ben(s)}:${ev.name}`);
        continue;
      }

      for (const arg of argsFor(ev)) {
        let to;
        try {
          to = evalAst(rule.target, {
            ben: ben(s),
            state: s,
            params: ev.param ? { [ev.param]: arg } : {},
            consts: ir.consts,
          });
        } catch {
          bump(undefinedPairs, `${ben(s)}:${ev.name}`);
          continue;
        }
        if (!Number.isInteger(to) || to < 0 || to > 0xfff) {
          bump(undefinedPairs, `${ben(s)}:${ev.name}`);
          continue;
        }

        if (!outs.has(to)) outs.set(to, []);
        outs.get(to).push(ev.param ? `${ev.name}(${arg})` : ev.name);

        if (!visited.has(to)) {
          visited.add(to);
          queue.push(to);
        }
      }
    }

    adj.set(s, outs);
  }

  const reachable = [...visited];
  const reachableBens = new Set(reachable.map(ben));

  // ---- 声明的态
  const unreachableStates = [...ir.states.values()].filter((s) => !reachableBens.has(s.ben));
  const deadStates = reachable.filter((s) => (adj.get(s)?.size ?? 0) === 0);

  // ---- 距离（供诊断排序）
  const distances = new Map(); // ben -> 最短步数
  distances.set(ir.start.ben, 0);
  {
    const q = [ir.start.value];
    const seen = new Set(q);
    while (q.length) {
      const s = q.shift();
      const d = distances.get(ben(s)) ?? 0;
      for (const to of adj.get(s)?.keys() ?? []) {
        const b = ben(to);
        if (!distances.has(b)) distances.set(b, d + 1);
        if (!seen.has(to)) { seen.add(to); q.push(to); }
      }
    }
  }

  // ---- 强连通分量
  const { comps, compOf } = tarjan(adj, reachable);
  const largest = comps.reduce((a, b) => (b.length > a.length ? b : a), []);
  const stronglyConnected = comps.length === 1;

  // ---- 直径（仅对最大的强连通分量，且在规模允许时）
  let diameter = null;
  let diameterPair = null;
  if (largest.length <= maxSccForDiameter && largest.length > 0) {
    const member = new Set(largest);
    let best = 0;
    for (const src of largest) {
      const dist = bfsDist(adj, src, member);
      for (const [dst, d] of dist) {
        if (d > best) { best = d; diameterPair = [src, dst]; }
      }
    }
    diameter = best;
  }

  return {
    stateSpace: STATE_SPACE,
    reachableCount: reachable.length,
    reachable,
    declaredCount: ir.states.size,
    reachableDeclared: ir.states.size - unreachableStates.length,
    unreachableStates,
    deadStates,
    undefined: {
      count: undefinedPairs.size,
      sample: [...undefinedPairs.keys()]
        .sort()
        .slice(0, 12)
        .map((k) => {
          const [b, ev] = k.split(':');
          return { ben: Number(b), name: nameOf(Number(b)), event: ev };
        }),
    },
    scc: { count: comps.length, largest: largest.length },
    stronglyConnected,
    diameter,
    diameterPair,
    distances,
    compOf,
    comps,
  };
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** 迭代版 Tarjan，避免 4096 深递归 */
function tarjan(adj, nodes) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comps = [];
  const compOf = new Map();
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    const work = [{ node: root, iter: (adj.get(root) ?? new Map()).keys(), child: null }];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1];

      if (frame.child !== null) {
        const c = frame.child;
        frame.child = null;
        low.set(frame.node, Math.min(low.get(frame.node), low.get(c)));
      }

      const step = frame.iter.next();
      if (!step.done) {
        const next = step.value;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter++;
          stack.push(next);
          onStack.add(next);
          frame.child = next;
          work.push({ node: next, iter: (adj.get(next) ?? new Map()).keys(), child: null });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(next)));
        }
        continue;
      }

      // 收尾
      if (low.get(frame.node) === index.get(frame.node)) {
        const comp = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          comp.push(w);
          if (w === frame.node) break;
        }
        for (const w of comp) compOf.set(w, comps.length);
        comps.push(comp);
      }
      work.pop();
    }
  }

  return { comps, compOf };
}

function bfsDist(adj, src, allowed) {
  const dist = new Map([[src, 0]]);
  const q = [src];
  while (q.length) {
    const s = q.shift();
    const d = dist.get(s);
    for (const to of adj.get(s)?.keys() ?? []) {
      if (!allowed.has(to) || dist.has(to)) continue;
      dist.set(to, d + 1);
      q.push(to);
    }
  }
  return dist;
}

/**
 * 组机器的穷举。
 *
 * 状态空间是 64^N（成员是卦，6 位）。N=2 是 4096，N=3 是 262144，都还在可穷举范围；
 * N≥4 时按 §9.3 的边界只做有界检验（这里直接拒绝，不假装能算）。
 */
function analyzeGrouped(ir) {
  const N = ir.components.length;
  if (N >= 4) {
    throw new Error(`组机器有 ${N} 个组件（64^${N} 个状态），超出穷举边界；请拆成更小的机器`);
  }

  const pow = (i) => 64 ** i;
  const enc = (a) => a.reduce((acc, v, i) => acc + v * pow(i), 0);
  const dec = (k) => Array.from({ length: N }, (_, i) => Math.floor(k / pow(i)) % 64);
  const byEvent = new Map(ir.rules.map((r) => [r.event, r]));

  const startKey = enc(ir.startVals);
  const visited = new Set([startKey]);
  const queue = [startKey];
  const adj = new Map();
  const undef = new Set();

  while (queue.length) {
    const k = queue.shift();
    const st = dec(k);
    const outs = new Set();

    for (const ev of ir.events) {
      const rule = byEvent.get(ev.name);
      const args = ev.param ? [1, 2, 3, 4, 5, 6] : [0];

      let fired = false;
      if (rule && ben(st[rule.comp]) === rule.fromBen) {
        for (const arg of args) {
          let to;
          try {
            to = evalAst(rule.target, {
              ben: ben(st[rule.comp]),
              state: st[rule.comp],
              params: ev.param ? { [ev.param]: arg } : {},
              consts: ir.consts,
            });
          } catch {
            undef.add(`${k}:${ev.name}`);
            continue;
          }
          if (!Number.isInteger(to) || to < 0 || to > 0x3f) {
            undef.add(`${k}:${ev.name}`);
            continue;
          }
          fired = true;
          const next = st.slice();
          next[rule.comp] = to;
          const nk = enc(next);
          outs.add(nk);
          if (!visited.has(nk)) { visited.add(nk); queue.push(nk); }
        }
      }
      if (!fired) undef.add(`${k}:${ev.name}`);
    }
    adj.set(k, outs);
  }

  const reachable = [...visited];
  const seenMember = new Set();
  for (const k of reachable) {
    const st = dec(k);
    st.forEach((v, i) => seenMember.add(`${ir.components[i].name}.${v}`));
  }

  const unreachableStates = [...ir.states.values()].filter(
    (s) => !seenMember.has(`${ir.components[s.comp].name}.${s.value}`)
  );
  const deadStates = reachable.filter((k) => (adj.get(k)?.size ?? 0) === 0);

  // 距离（从起点）
  const distances = new Map();
  distances.set(ir.start.ben ?? 0, 0);
  {
    const seen = new Set([startKey]);
    const q = [[startKey, 0]];
    while (q.length) {
      const [k, d] = q.shift();
      for (const nk of adj.get(k) ?? []) {
        if (seen.has(nk)) continue;
        seen.add(nk);
        q.push([nk, d + 1]);
      }
    }
  }

  return {
    grouped: true,
    stateSpace: 64 ** N,
    reachableCount: reachable.length,
    reachable,
    declaredCount: ir.states.size,
    reachableDeclared: ir.states.size - unreachableStates.length,
    unreachableStates,
    deadStates,
    undefined: { count: undef.size, sample: [] },
    scc: { count: 0, largest: reachable.length },
    stronglyConnected: false,
    diameter: null,
    diameterPair: null,
    distances: new Map(),
    compOf: new Map(),
    comps: [],
  };
}