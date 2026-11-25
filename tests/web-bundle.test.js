/**
 * 网页包的可执行性验证。
 *
 * 浏览器页面没法在这里跑，但**打包出来的那份代码本身**可以在 Node 里跑：
 * 如果它在 Node 里能建立的机器、能走通六关，那网页里的逻辑就是同一份。
 * DOM 部分（点击、渲染）不在此测试范围内。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildBundle, buildHtml } from '../tools/build_web.mjs';

let Y = null;

async function loadBundle() {
  if (Y) return Y;
  const dir = mkdtempSync(join(tmpdir(), 'yao-web-'));
  const file = join(dir, 'bundle.mjs');
  try {
    writeFileSync(file, buildBundle(), 'utf8');
    await import(pathToFileURL(file).href);
    Y = globalThis.__YAO__;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return Y;
}

test('打包产物不含 Node 专有依赖', async () => {
  const src = buildBundle();
  assert.ok(!src.includes("from 'node:fs'"), '不应残留 node:fs 的 import');
  assert.ok(!src.includes('readFileSync(DATA_URL'), 'core.js 的数据读取没被替换');
  assert.ok(!src.includes('readFileSync(CORPUS_URL'), 'divine.js 的数据读取没被替换');
  assert.ok(src.includes('globalThis.__YAO_DATA__'), '应内联数据');
  assert.ok(src.includes('globalThis.__YAO__'), '应暴露 API');
});

test('打包产物能在干净环境里加载', async () => {
  const api = await loadBundle();
  assert.ok(api, '__YAO__ 未定义');
  assert.equal(api.BY_NAME.get('乾').id, 63);
  assert.equal(api.BY_NAME.get('既济').id, 21);
  assert.equal(api.nameOf(42), '未济');
});

test('网页包里的辞库完整', async () => {
  const api = await loadBundle();
  const corpus = api.loadCorpus();
  assert.equal(Object.keys(corpus.entries).length, 64);
  assert.ok(corpus.entries['泰'].c.length > 0);
  const cov = api.coverage(corpus);
  assert.equal(cov.filled, 450);
});

test('网页包能建立爻阵机器并走通六关', async () => {
  const api = await loadBundle();
  const src = globalThis.__YAO_SRC__.yaoZhen;

  const ir = api.buildIr(api.parse(src));
  assert.equal(ir.states.size, 64);

  const m = new api.Machine(ir);
  const step = api.makeStepper(ir);

  let cur = api.ben(m.state);
  assert.equal(cur, api.BY_NAME.get('未济').id);

  for (const lv of api.LEVELS) {
    const goal = api.BY_NAME.get(lv.target).id;
    const d = api.par(step, cur, goal);
    assert.ok(d !== null, `${lv.target} 不可达`);

    // 沿最短路真实走一遍，全程必须只用机器自己的转移
    let at = cur;
    let left = d;
    while (left > 0) {
      let moved = false;
      for (let n = 1; n <= 6; n++) {
        const nx = step(at, n);
        if (nx !== null && api.par(step, nx, goal) === left - 1) {
          at = nx;
          left--;
          moved = true;
          break;
        }
      }
      assert.ok(moved, `从 ${api.nameOf(at)} 找不到下一步`);
    }
    assert.equal(at, goal, `没能走到 ${lv.target}`);
    cur = goal;
  }
});

test('网页包的字面量解析覆盖三种写法', async () => {
  const api = await loadBundle();
  const one = (text) => {
    const toks = api.lex(text).filter((t) => t.type !== 'eof');
    assert.equal(toks.length, 1, `${text} 应只产生一个记号`);
    assert.equal(toks[0].type, 'bian');
    return toks[0].value;
  };

  assert.equal(one('既济'), 21);
  assert.equal(one('䷾'), 21);
  assert.equal(one('878787'), 42);
  assert.equal(api.dong(one('既济/初上')), 0b100001);
  assert.equal(one('既濟'), 21, '繁体别名应可用');
});

test('HTML 是自包含的单文件', () => {
  const html = buildHtml();
  assert.ok(html.startsWith('<!doctype html>'), '缺少 doctype');
  assert.ok(html.includes('<script type="module">'), '缺少模块脚本');
  assert.ok(!/<script[^>]+src=/i.test(html), '不应引用外部脚本');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), '不应引用外部样式');
  assert.ok(html.includes('爻阵'), '缺少游戏界面');
  assert.ok(html.includes('var(--accent)') || html.includes('--accent'), '缺少样式');
  assert.ok(html.length > 60_000, '产物过小，可能没打包进去');
});
