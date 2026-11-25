import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cast, judge, coverage, loadCorpus, yaoTitle, movingPositions,
} from '../src/divine.js';
import { BY_NAME, bian, ben, zhi, bianShu } from '../src/core.js';

const id = (n) => BY_NAME.get(n).id;
const corpus = loadCorpus();

// ---------------------------------------------------------------- 筮

test('筮：同种子同结果', () => {
  for (const seed of [1, 42, 12345]) {
    assert.equal(cast({ seed }), cast({ seed }));
  }
  assert.notEqual(cast({ seed: 1 }), cast({ seed: 2 }));
});

test('筮：金钱卦分布约为 1/8, 3/8, 3/8, 1/8', () => {
  const N = 24000;
  const cnt = { 6: 0, 7: 0, 8: 0, 9: 0 };
  for (let s = 0; s < N; s++) {
    const x = cast({ seed: s * 2654435761 });
    for (let p = 1; p <= 6; p++) {
      const yang = (ben(x) >> (p - 1)) & 1;
      const mov = (x >> 6) >> (p - 1) & 1;
      const v = yang ? (mov ? 9 : 7) : (mov ? 6 : 8);
      cnt[v]++;
    }
  }
  const total = N * 6;
  const want = { 6: 1 / 8, 7: 3 / 8, 8: 3 / 8, 9: 1 / 8 };
  for (const k of [6, 7, 8, 9]) {
    const p = cnt[k] / total;
    assert.ok(Math.abs(p - want[k]) < 0.02, `${k} 频率 ${p.toFixed(3)} 偏离 ${want[k]}`);
  }
});

// ---------------------------------------------------------------- 爻题

test('爻题：既济六爻', () => {
  const g = id('既济'); // 010101
  assert.equal(yaoTitle(g, 1), '初九');
  assert.equal(yaoTitle(g, 2), '六二');
  assert.equal(yaoTitle(g, 3), '九三');
  assert.equal(yaoTitle(g, 4), '六四');
  assert.equal(yaoTitle(g, 5), '九五');
  assert.equal(yaoTitle(g, 6), '上六');
});

test('爻题：坤全阴、乾全阳', () => {
  assert.deepEqual([1, 2, 6].map((p) => yaoTitle(id('坤'), p)), ['初六', '六二', '上六']);
  assert.deepEqual([1, 2, 6].map((p) => yaoTitle(id('乾'), p)), ['初九', '九二', '上九']);
});

// ---------------------------------------------------------------- 七分支

test('断卦 0：六爻皆静，取本卦卦辞', () => {
  const j = judge(id('泰'), corpus);
  assert.equal(j.branch, 0);
  assert.equal(j.entries.length, 1);
  assert.equal(j.entries[0].kind, '卦');
  assert.equal(j.entries[0].text, corpus.entries['泰'].c);
});

test('断卦 1：一爻动，取该动爻爻辞', () => {
  const j = judge(bian(id('泰'), 0b100000), corpus);
  assert.equal(j.branch, 1);
  assert.equal(j.entries[0].label, '上六');
  assert.equal(j.entries[0].text, corpus.entries['泰'].y[5]);
});

test('断卦 2：二爻动，以上爻为主', () => {
  const j = judge(bian(id('泰'), 0b100001), corpus);
  assert.equal(j.branch, 2);
  assert.deepEqual(j.entries.map((e) => e.label), ['初九', '上六']);
  assert.equal(j.main, 1);
});

test('断卦 3：三爻动，本卦为主', () => {
  const j = judge(bian(id('泰'), 0b101010), corpus);
  assert.equal(j.branch, 3);
  assert.deepEqual(j.entries.map((e) => e.hexName), ['泰', '离']);
  assert.equal(j.main, 0);
});

test('断卦 4：四爻动，取之卦两不变爻，以下爻为主', () => {
  const x = bian(id('泰'), 0b001111); // 不动：五、上
  const j = judge(x, corpus);
  assert.equal(j.branch, 4);
  assert.equal(bianShu(x), 4);
  assert.deepEqual(j.entries.map((e) => e.label), ['六五', '上六']);
  assert.equal(j.entries[0].hexName, '豫');
  assert.equal(j.main, 0);
});

test('断卦 5：五爻动，取之卦不变爻', () => {
  const j = judge(bian(id('泰'), 0b011111), corpus); // 唯一不动：上
  assert.equal(j.branch, 5);
  assert.equal(j.entries.length, 1);
  assert.equal(j.entries[0].label, '上六');
  assert.equal(j.entries[0].hexName, '萃');
});

test('断卦 6：乾用九、坤用六、余卦取之卦卦辞', () => {
  const qian = judge(bian(id('乾'), 0b111111), corpus);
  assert.equal(qian.entries[0].label, '用九');
  assert.equal(qian.entries[0].text, corpus.entries['乾'].u);

  const kun = judge(bian(id('坤'), 0b111111), corpus);
  assert.equal(kun.entries[0].label, '用六');
  assert.equal(kun.entries[0].text, corpus.entries['坤'].u);

  const tai = judge(bian(id('泰'), 0b111111), corpus);
  assert.equal(tai.entries[0].kind, '卦');
  assert.equal(tai.entries[0].hexName, '否');
  assert.equal(tai.entries[0].text, corpus.entries['否'].c);
});

test('断卦：七个分支都被覆盖', () => {
  const masks = [0, 1, 0b11, 0b111, 0b1111, 0b11111, 0b111111];
  const got = masks.map((m) => judge(bian(id('泰'), m), corpus).branch);
  assert.deepEqual(got, [0, 1, 2, 3, 4, 5, 6]);
});

test('动爻位置', () => {
  assert.deepEqual(movingPositions(bian(0, 0b100001)), [1, 6]);
  assert.deepEqual(movingPositions(bian(0, 0)), []);
});

// ---------------------------------------------------------------- 辞库

test('辞库：450 条全部就位', () => {
  const cov = coverage(corpus);
  assert.equal(cov.total, 450);
  assert.equal(cov.filled, 450);
  assert.deepEqual(cov.missing, []);
});

test('辞库：64 卦齐全，每卦六爻', () => {
  assert.equal(Object.keys(corpus.entries).length, 64);
  for (const [name, e] of Object.entries(corpus.entries)) {
    assert.ok(e.c && e.c.length > 0, `${name} 缺卦辞`);
    assert.equal(e.y.length, 6, `${name} 爻辞不足 6 条`);
    assert.ok(e.y.every((t) => t && t.length > 0), `${name} 有空爻辞`);
  }
});

test('辞库：乾坤有第七爻', () => {
  assert.equal(corpus.entries['乾'].u, '见群龙无首，吉');
  assert.equal(corpus.entries['坤'].u, '利永贞');
  assert.equal(corpus.entries['乾'].ul, '用九');
  assert.equal(corpus.entries['坤'].ul, '用六');
});

test('辞库：标注为 draft，不冒充已校对', () => {
  assert.ok(corpus.status === 'draft' || corpus.status === 'verified');
  assert.ok(Array.isArray(corpus.verified), 'verified 应为已校对键的列表');

  const cov = coverage(corpus);
  assert.equal(cov.verifiedCount, corpus.verified.length);
  // 已校对 + 未校对 = 总数，不允许有第三种状态
  assert.equal(cov.verifiedCount + cov.unverified.length, cov.total);
});

// ---------------------------------------------------------------- 一致性

test('占卜与位运算一致：本/动/之', () => {
  const x = cast({ seed: 7 });
  assert.equal(zhi(x), ben(x) ^ (x >> 6 & 0x3f));
});
