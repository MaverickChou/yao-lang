import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { Machine, trace } from '../src/interp.js';
import { emitC, emitHeader } from '../src/codegen-c.js';
import { BY_NAME, ben, dong, zhi } from '../src/core.js';

const id = (n) => BY_NAME.get(n).id;
const machine = (src) => new Machine(buildIr(parse(src)));

const TURNSTILE = `
机 闸机 {
  事 投币
  事 通过
  态 闲   = 坤
  态 放行 = 复
  转 闲   投币 -> 放行
  转 放行 通过 -> 闲
  起 闲
}
`;

const TRAFFIC_SRC = readFileSync(
  new URL('../examples/traffic/traffic.yao', import.meta.url),
  'utf8'
);

const DUNGEON = readFileSync(
  new URL('../examples/gua-jing/gua_jing.yao', import.meta.url),
  'utf8'
);

// ---------------------------------------------------------------- 基本语义

test('态名在转移目标里可以当常量', () => {
  const m = machine(TURNSTILE);
  assert.equal(m.state, id('坤'));
  assert.equal(m.step('投币').ok, true);
  assert.equal(m.state, id('复'));
  assert.equal(m.step('通过').ok, true);
  assert.equal(m.state, id('坤'));
});

test('未定义转移不改变状态', () => {
  const m = machine(TURNSTILE);
  const r = m.step('通过');
  assert.equal(r.ok, false);
  assert.equal(m.state, id('坤'));
  assert.match(r.reason, /此路不通/);
});

test('未声明的事件被拒绝', () => {
  const m = machine(TURNSTILE);
  assert.equal(m.step('飞行').ok, false);
});

test('具体态规则优先于 `*` 兜底', () => {
  const src = `
机 优先 {
  事 走
  态 甲 = 乾
  态 乙 = 坤
  转 *  走 -> 乙
  转 甲 走 -> 乙
  起 甲
}`;
  const m = machine(src);
  assert.equal(m.step('走').to, id('坤'));
});

// ---------------------------------------------------------------- 静态检查

test('两个态本卦相同时报 Y0101', () => {
  const src = `
机 撞 {
  事 走
  态 甲 = 泰
  态 乙 = 泰/111111
  转 * 走 -> 乙
  起 甲
}`;
  assert.throws(() => buildIr(parse(src)), (e) => e.code === 'Y0101');
});

test('同一态同一事件两条规则报 Y0202', () => {
  const src = `
机 非确定 {
  事 走
  态 甲 = 乾
  态 乙 = 坤
  转 甲 走 -> 乙
  转 甲 走 -> 甲
  起 甲
}`;
  assert.throws(() => buildIr(parse(src)), (e) => e.code === 'Y0202');
});

test('未声明的事件/态报 Y0014', () => {
  assert.throws(
    () => buildIr(parse('机 a { 事 走 态 甲 = 乾 转 甲 飞 -> 甲 起 甲 }')),
    (e) => e.code === 'Y0014'
  );
  assert.throws(
    () => buildIr(parse('机 a { 事 走 态 甲 = 乾 转 乙 走 -> 甲 起 甲 }')),
    (e) => e.code === 'Y0014'
  );
});

test('缺少 `起` 或起态未声明', () => {
  assert.throws(() => parse('机 a { 事 走 态 甲 = 乾 }'), /缺少|`起`/);
  assert.throws(
    () => buildIr(parse('机 a { 事 走 态 甲 = 乾 转 * 走 -> 甲 起 乙 }')),
    (e) => e.code === 'Y0205'
  );
});

test('表达式里用了未声明的参数名', () => {
  const src = `
机 a {
  事 走
  态 甲 = 乾
  转 * 走 -> 变(本, k)
  起 甲
}`;
  assert.throws(() => buildIr(parse(src)), (e) => e.code === 'Y0014');
});

// ---------------------------------------------------------------- 地牢

test('地牢：64 态，起于未济', () => {
  const ir = buildIr(parse(DUNGEON));
  assert.equal(ir.states.size, 64);
  assert.equal(ir.start.name, '未济');
  assert.equal(ir.start.value, id('未济'));
});

test('地牢：变一爻 = 翻一位，并且记下来路', () => {
  const m = machine(DUNGEON);
  const before = m.state;
  m.step('行', 1);
  assert.equal(ben(m.state), ben(before) ^ 0b000001);
  assert.equal(dong(m.state), 0b000001, '动爻记录这一步');
  assert.equal(zhi(m.state), ben(before), '之 = 来处');
});

test('地牢：错卦六爻全变，之 正好指回来处', () => {
  const m = machine(DUNGEON);
  const before = ben(m.state);
  m.step('错卦');
  assert.equal(ben(m.state), before ^ 0b111111);
  assert.equal(dong(m.state), 0b111111);
  assert.equal(zhi(m.state), before);
});

test('地牢：综卦与互卦不改变动爻', () => {
  const m = machine(DUNGEON);
  m.step('综卦');
  assert.equal(dong(m.state), 0);
  m.step('互卦');
  assert.equal(dong(m.state), 0);
});

test('地牢：一步即可走到既济（错卦）', () => {
  const ir = buildIr(parse(DUNGEON));
  const rows = trace(ir, ['错卦']);
  assert.equal(ben(rows[1].state), id('既济'));
  assert.equal(dong(rows[1].state), 0b111111);
});

test('地牢：六步全变也到达既济', () => {
  const ir = buildIr(parse(DUNGEON));
  const rows = trace(ir, [[ '行', 1 ], [ '行', 2 ], [ '行', 3 ], [ '行', 4 ], [ '行', 5 ], [ '行', 6 ]]);
  assert.equal(ben(rows.at(-1).state), id('既济'));
});

test('地牢：事件参数越界被拦下', () => {
  const m = machine(DUNGEON);
  const before = m.state;
  assert.equal(m.step('行', 0).ok, false);
  assert.equal(m.step('行', 7).ok, false);
  assert.equal(m.state, before);
});

// ---------------------------------------------------------------- C 后端

test('C 后端：具体态规则生成 switch 分支', () => {
  const c = emitC(buildIr(parse(TURNSTILE)));
  assert.match(c, /case EV_0:/);
  assert.match(c, /case 0x00u:.*\n.*return 0x0001u;/, '闲 收到投币 应转到 放行');
  assert.match(c, /int yao_step\(uint16_t \*s, uint16_t ev, uint8_t p0\)/);
  assert.match(c, /#define YAO_START 0x0000u/);
});

test('C 后端：地牢生成物结构完整', () => {
  const c = emitC(buildIr(parse(DUNGEON)), { emitMain: true });

  // 括号配平
  let depth = 0;
  for (const ch of c) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, '花括号提前闭合');
  }
  assert.equal(depth, 0, '花括号未配平');

  assert.match(c, /#define ST_0 0x003Fu {2}\/\* 乾 \*\//);
  assert.match(c, /#define EV_0 1u {2}\/\* 行\(n\) \*\//);
  assert.match(c, /#define YAO_START 0x002Au {2}\/\* 未济 \*\//);
  assert.match(c, /static uint16_t yao_cuo/);
  assert.match(c, /static uint16_t yao_zong/);
  assert.match(c, /static uint16_t yao_hu/);
  assert.match(c, /int main\(void\)/);
  assert.ok(!c.includes('RUNTIME'), '不该残留占位符');
});

test('C 后端：只用到的运行时函数才被生成', () => {  const src = `
机 最小 {
  事 走
  态 甲 = 乾
  态 乙 = 坤
  转 * 走 -> 乙
  起 甲
}`;
  const c = emitC(buildIr(parse(src)));
  assert.ok(!c.includes('yao_cuo'), '没用到 错 就不该生成 yao_cuo');
  assert.ok(!c.includes('yao_hu'), '没用到 互 就不该生成 yao_hu');
});

// ---------------------------------------------------------------- 头文件

test('C 后端：--header 产出的头文件与 .c 一致', () => {
  const ir = buildIr(parse(TURNSTILE));
  const c = emitC(ir);
  const h = emitHeader(ir);

  assert.match(h, /#ifndef YAO_GENERATED_H/);
  assert.match(h, /#define YAO_START 0x0000u\s+\/\* 闲 \*\//);
  assert.match(h, /#define EV_0 1u/);
  assert.match(h, /#define EV_1 2u/);
  assert.match(h, /#define YAO_EVENT_COUNT 2u/);
  assert.match(h, /int\s+yao_step\(uint16_t \*s, uint16_t ev, uint8_t p0\);/);

  // 头文件里的起始态必须与 .c 里的相同，否则宿主和机器各说各话
  const startC = /#define YAO_START (0x[0-9A-F]+u)/.exec(c)[1];
  const startH = /#define YAO_START (0x[0-9A-F]+u)/.exec(h)[1];
  assert.equal(startH, startC);

  // 事件号数量必须与 .c 的 dispatch 一致
  const evCount = (c.match(/case EV_\d+:/g) || []).length;
  assert.equal(evCount, ir.events.length);
});

test('C 后端：交通灯头文件含两个事件', () => {
  const h = emitHeader(buildIr(parse(TRAFFIC_SRC)));
  assert.match(h, /#define EV_0 1u\s+\/\* 秒 \*\//);
  assert.match(h, /#define EV_1 2u\s+\/\* 行人 \*\//);
});

// ---------------------------------------------------------------- 若 / 比较

test('比较运算符产出 1 / 0', () => {
  const src = `
机 比较 {
  事 走
  态 甲 = 乾
  转 * 走 -> 若 本 > 60 { 坤 } 否则 { 乾 }
  起 甲
}`;
  const m = machine(src);
  assert.equal(m.step('走').to, id('坤'), '63 > 60 应为真');
});

test('若 走假分支', () => {
  const src = `
机 比较2 {
  事 走
  态 甲 = 坤
  转 * 走 -> 若 本 == 63 { 乾 } 否则 { 泰 }
  起 甲
}`;
  const m = machine(src);
  assert.equal(m.step('走').to, id('泰'), '0 == 63 应为假');
});

test('若 条件非零即真', () => {
  const src = `
机 真值 {
  事 走
  态 甲 = 乾
  转 * 走 -> 若 (本 & 3) { 坤 } 否则 { 泰 }
  起 甲
}`;
  const m = machine(src);
  assert.equal(m.step('走').to, id('坤'), '63 & 3 = 3，非零为真');
});

test('若 与 合 可以嵌套', () => {
  const src = `
机 嵌 {
  事 走(位 n)
  态 甲 = 泰/111111
  转 * 走 -> 若 变数(变) == 6 {
    乾
  } 否则 {
    合 n { 1 => 坤, _ => 变(本 ^ (1 << (n - 1)), 1 << (n - 1)) }
  }
  起 甲
}`;
  const m = machine(src);
  assert.equal(m.step('走', 1).to, id('乾'), '六爻全动 → 乾');
  assert.equal(m.step('走', 1).to, id('坤'), '之后 变数=0，走 else，命中 合 的 n=1 分支');
  assert.equal(m.step('走', 2).to, 2 | (2 << 6), 'n=2 走默认分支：本=2，动=2');
});

test('若 一支为变、一支为卦时，整体按变处理', () => {
  const src = `
机 宽 {
  事 走
  态 甲 = 坤
  转 * 走 -> 若 本 == 0 { 乾 } 否则 { 变(坤, 0b000001) }
  起 甲
}`;
  const m = machine(src);
  assert.equal(m.step('走').to, 63, '真分支返回 卦 63，应作为 变 使用');
});

// ---------------------------------------------------------------- 印

const PRINTING = `
机 印测 {
  事 走(位 n)
  态 甲 = 坤
  转 * 走 -> {
    印 1;
    印 本 + 2;
    变(本 ^ (1 << (n - 1)), 1 << (n - 1))
  }
  起 甲
}`;

test('印：输出进 sink，且不影响状态', () => {
  const ir = buildIr(parse(PRINTING));

  const withSink = [];
  const m1 = new Machine(ir, { sink: (v) => withSink.push(v) });
  m1.step('走', 1);

  const m2 = new Machine(ir); // 没有 sink
  const r2 = m2.step('走', 1);

  assert.deepEqual(withSink, [1, 2], '两条 印 各输出一次');
  assert.equal(m1.state, r2.to, '有没有 sink，状态轨迹必须一致');
  assert.equal(r2.to, 1 | (1 << 6));
});

test('印：同一序列跑两遍，轨迹完全相同', () => {
  const run = () => {
    const out = [];
    const m = new Machine(buildIr(parse(PRINTING)), { sink: (v) => out.push(v) });
    const states = [m.state];
    for (const n of [1, 2, 3]) {
      m.step('走', n);
      states.push(m.state);
    }
    return { states, out };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.states, b.states);
  assert.deepEqual(a.out, b.out);
});

test('印：必须以分号结尾', () => {
  const bad = `
机 坏 {
  事 走
  态 甲 = 坤
  转 * 走 -> { 印 1 变(本, 0) }
  起 甲
}`;
  assert.throws(() => parse(bad), /分号/);
});

test('印：头文件声明输出汇', () => {
  const h = emitHeader(buildIr(parse(PRINTING)));
  assert.match(h, /extern void \(\*yao_sink\)\(uint16_t\);/);
});

test('没有 印 的机器不引入 yao_sink', () => {
  const h = emitHeader(buildIr(parse(TURNSTILE)));
  assert.ok(!h.includes('yao_sink'), '不该无端引入输出汇');
  const c = emitC(buildIr(parse(TURNSTILE)));
  assert.ok(!c.includes('yao_sink'));
});

test('参数缺失时给出可照抄的写法', () => {
  const src = `
机 参 {
  事 走(位 n)
  态 甲 = 坤
  转 甲 走 -> 变(本, 0)
  起 甲
}`;
  const m = machine(src);
  const r = m.step('走', 0);
  assert.equal(r.ok, false);
  assert.match(r.reason, /需要参数/);
  assert.match(r.reason, /写成 "走:1"/);
});

test('参数越界时说明范围', () => {
  const src = `
机 参2 {
  事 走(位 n)
  态 甲 = 坤
  转 甲 走 -> 变(本, 0)
  起 甲
}`;
  const r = machine(src).step('走', 9);
  assert.equal(r.ok, false);
  assert.match(r.reason, /9 越界，应为 1\.\.6/);
});