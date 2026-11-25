import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HEXAGRAMS, BY_ID, BY_NAME, ALIASES,
  ben, dong, zhi, bian, jing, cuo, zong, hu, bianShu, dangWei, yaoOf,
  fromDigits, toDigits, nameOf, glyphOf, xu, renderLines,
} from '../src/core.js';

const id = (n) => BY_NAME.get(n).id;

// ---------------------------------------------------------------- 定值

test('四卦定位：乾坤既济未济', () => {
  assert.equal(id('乾'), 63);
  assert.equal(id('坤'), 0);
  assert.equal(id('既济'), 21); // 0b010101
  assert.equal(id('未济'), 42); // 0b101010
});

test('八卦字节：下卦低三位，上卦高三位', () => {
  const h = BY_ID[id('既济')];
  assert.equal(h.upper, '坎');
  assert.equal(h.lower, '离');
  // 既济 = 上坎(010) 下离(101) -> 0b010101
  assert.equal(id('既济'), 0b101 | (0b010 << 3));
  assert.equal(id('既济') & 0b111, 0b101);
  assert.equal((id('既济') >> 3) & 0b111, 0b010);
});

test('当位：既济 6/6，未济 0/6，且各自唯一', () => {
  assert.equal(dangWei(id('既济')), 6);
  assert.equal(dangWei(id('未济')), 0);
  assert.deepEqual(HEXAGRAMS.filter((h) => h.dangwei === 6).map((h) => h.name), ['既济']);
  assert.deepEqual(HEXAGRAMS.filter((h) => h.dangwei === 0).map((h) => h.name), ['未济']);
});

// ---------------------------------------------------------------- 代数

test('错、综 皆对合（全 64 卦）', () => {
  for (const h of HEXAGRAMS) {
    assert.equal(cuo(cuo(h.id)), h.id, `错对合 ${h.name}`);
    assert.equal(zong(zong(h.id)), h.id, `综对合 ${h.name}`);
  }
});

test('错综轨道 = 36（自反 8 + 对 28）', () => {
  const seen = new Set();
  let self = 0;
  let pairs = 0;
  for (const h of HEXAGRAMS) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const r = zong(h.id);
    seen.add(r);
    if (r === h.id) self++;
    else pairs++;
  }
  assert.equal(self, 8);
  assert.equal(pairs, 28);
  assert.equal(self + pairs, 36);
});

test('古典恒等式：错综互', () => {
  assert.equal(cuo(id('既济')), id('未济'));
  assert.equal(zong(id('既济')), id('未济'));
  assert.equal(hu(id('既济')), id('未济'));

  assert.equal(cuo(id('泰')), id('否'));
  assert.equal(zong(id('泰')), id('否'));

  assert.equal(zong(id('损')), id('益'));
  assert.equal(zong(id('屯')), id('蒙'));
  assert.equal(zong(id('渐')), id('归妹'));
  assert.equal(cuo(id('随')), id('蛊'));
  assert.equal(zong(id('随')), id('蛊'));

  assert.equal(hu(id('乾')), id('乾'));
  assert.equal(hu(id('坤')), id('坤'));
  assert.equal(hu(id('颐')), id('坤'));
  assert.equal(hu(id('大过')), id('乾'));
  assert.equal(hu(id('坎')), id('颐'));
  assert.equal(hu(id('离')), id('大过'));
});

test('互卦的古籍记载（位运算自动复现，未写任何互卦表）', () => {
  const cases = {
    泰: '归妹', 否: '渐', 师: '复', 谦: '解', 需: '睽', 豫: '蹇',
    蛊: '归妹', 临: '复', 观: '剥', 噬嗑: '蹇', 贲: '解', 剥: '坤',
    复: '坤', 无妄: '渐', 大畜: '归妹', 咸: '姤', 恒: '夬', 遯: '姤',
    大壮: '夬', 晋: '蹇', 明夷: '解', 家人: '未济', 睽: '既济', 蹇: '未济',
    解: '既济', 损: '复', 益: '剥', 夬: '乾', 姤: '乾', 萃: '渐',
    升: '归妹', 困: '家人', 井: '睽', 革: '姤', 鼎: '夬', 震: '蹇',
    艮: '解', 渐: '未济', 归妹: '既济', 丰: '大过', 旅: '大过', 巽: '睽',
    兑: '家人', 涣: '颐', 节: '颐', 中孚: '颐', 小过: '大过', 屯: '剥', 蒙: '复',
    讼: '家人', 比: '剥', 小畜: '睽', 履: '家人', 同人: '姤', 大有: '夬',
  };
  for (const [a, b] of Object.entries(cases)) {
    assert.equal(nameOf(hu(id(a))), b, `${a} 之互卦应为 ${b}`);
  }
});

// ---------------------------------------------------------------- 变

test('变：本 ⊕ 动 ⊕ 之 = 0（全 64 × 64 抽样）', () => {
  for (const h of HEXAGRAMS) {
    for (const d of [0, 1, 0b100000, 0b111111, 0b010101, 0b101010]) {
      const x = bian(h.id, d);
      assert.equal(ben(x) ^ dong(x) ^ zhi(x), 0);
      assert.equal(ben(x), h.id);
      assert.equal(dong(x), d);
    }
  }
});

test('变数 = 动爻数', () => {
  assert.equal(bianShu(bian(0, 0)), 0);
  assert.equal(bianShu(bian(0, 0b111111)), 6);
  assert.equal(bianShu(bian(id('既济'), 0b100001)), 2);
});

test('静：投影丢弃动爻', () => {
  const x = bian(id('既济'), 0b111111);
  assert.equal(jing(x), id('既济'));
  assert.equal(dong(jing(x)), 0);
});

// ---------------------------------------------------------------- 爻串

test('爻串往返：一卦的 64 种动爻组合', () => {
  for (const h of HEXAGRAMS) {
    for (let d = 0; d < 64; d++) {
      const x = bian(h.id, d);
      assert.equal(fromDigits(toDigits(x)), x, `${h.name}/${d}`);
    }
  }
});

test('爻串字面量：既济 = 787878，未济 = 878787', () => {
  assert.equal(fromDigits('787878'), id('既济'));
  assert.equal(fromDigits('878787'), id('未济'));
});

test('四象映射：6/7/8/9', () => {
  const yang = bian(0b111111, 0);
  assert.equal(yaoOf(yang, 1), 7);
  assert.equal(yaoOf(bian(0b111111, 0b100000), 6), 9);
  assert.equal(yaoOf(id('坤'), 1), 8);
  assert.equal(yaoOf(bian(0, 0b000001), 1), 6);
});

// ---------------------------------------------------------------- 序

test('序：先天 = 卦值，文王 = 1..64', () => {
  for (const h of HEXAGRAMS) {
    assert.equal(xu(h.id, '先天'), h.id);
    assert.equal(xu(h.id, '文王'), h.order);
  }
  assert.equal(xu(id('乾'), '文王'), 1);
  assert.equal(xu(id('未济'), '文王'), 64);
});

// ---------------------------------------------------------------- 数据完整性

test('元数据：64 条、名字唯一、卦象字符与文王序对齐', () => {
  assert.equal(HEXAGRAMS.length, 64);
  assert.equal(new Set(HEXAGRAMS.map((h) => h.name)).size, 64);
  assert.equal(new Set(HEXAGRAMS.map((h) => h.id)).size, 64);
  for (const h of HEXAGRAMS) {
    assert.equal(h.glyph, String.fromCodePoint(0x4dc0 + h.order - 1));
    assert.equal(h.id, parseInt(h.binary, 2));
    assert.equal(nameOf(h.id), h.name);
    assert.equal(glyphOf(h.id), h.glyph);
  }
});

test('别名归一：既濟 → 既济', () => {
  assert.equal(ALIASES.get('既濟'), '既济');
  assert.equal(ALIASES.get('遁'), '遯');
});

test('渲染：六行，自上而下', () => {
  const lines = renderLines(id('既济'));
  assert.equal(lines.length, 6);
  assert.ok(lines[0].startsWith('上'));
  assert.ok(lines[5].startsWith('初'));
  assert.ok(lines.every((l) => l.includes('▅')));
});
