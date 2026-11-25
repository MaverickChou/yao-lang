/**
 * 文档一致性检查。
 *
 * 起因：README 长期写着「还没有编译器」，而那时已经有三个后端了。
 * 这类腐坏靠人复读抓不住，只能靠断言。
 *
 * 这里做两件事：
 *   1. **链接可达**：所有相对链接指向的文件必须存在（改名/搬目录后最容易断）
 *   2. **陈旧断言**：已知说错过的句子不许回来
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DOCS = ['README.md', 'SPEC.md', 'docs/GUIDE.md', 'docs/DESIGN.md', 'data/corpus.NOTES.md'];

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** 抽出 markdown 里的相对链接（跳过 http、锚点、代码块内的示例） */
function relativeLinks(md) {
  const out = [];
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(md))) {
    const href = m[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    out.push(href.split('#')[0]);
  }
  return out.filter(Boolean);
}

test('文档里的相对链接都指向存在的文件', () => {
  const broken = [];
  for (const doc of DOCS) {
    const dir = dirname(doc);
    for (const href of relativeLinks(read(doc))) {
      const target = resolve(ROOT, dir, href);
      if (!existsSync(target)) broken.push(`${doc} → ${href}`);
    }
  }
  assert.deepEqual(broken, [], `断链：\n  ${broken.join('\n  ')}`);
});

test('README 不再声称「还没有编译器」', () => {
  const md = read('README.md');
  assert.ok(!md.includes('还没有编译器'), 'README 仍在说没有编译器');
  assert.ok(!/当前是 M1/.test(md), 'README 仍停留在 M1 的自我描述');
});

test('文档不再声称 组 / 若 / 印 未实现', () => {
  for (const doc of DOCS) {
    const md = read(doc);
    assert.ok(!/组.{0,6}尚未实现/.test(md), `${doc} 仍说 组 未实现`);
    assert.ok(!/组.*若.*印.*未实现/.test(md), `${doc} 仍把三个特性列为未实现`);
  }
});

test('路线图里没有「计划中」的已完成项', () => {
  const md = read('README.md');
  const rows = md.split('\n').filter((l) => /^\|\s*M\d/.test(l));
  assert.ok(rows.length >= 6, '路线图行数异常');
  for (const r of rows) {
    assert.ok(!/计划中/.test(r), `路线图仍有未完成项：${r.trim()}`);
  }
});

test('SPEC 的已知缺口表不列已实现的功能', () => {
  const md = read('SPEC.md');
  const start = md.indexOf('### 14.2 已知缺口');
  assert.ok(start > 0, '找不到 14.2 节');
  const table = md.slice(start, md.indexOf('### 14.3'));
  for (const done of ['`组`', '`若`', '`印`', 'WASM']) {
    const line = table.split('\n').find((l) => l.includes(done) && l.includes('未实现'));
    assert.ok(!line, `SPEC 仍把 ${done} 列为未实现：${line?.trim()}`);
  }
});
