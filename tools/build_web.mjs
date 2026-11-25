#!/usr/bin/env node
/**
 * 爻 · 网页构建器
 *
 * 把语言内核（src/*.js）与数据（data/*.json、示例源码）打包成**单个 HTML**，
 * 双击即可运行，不需要服务器、不需要 npm、不需要 WASM。
 *
 * 之所以能这么做：内核是纯 ESM，唯一的 Node 依赖是两处 JSON 读取，
 * 这里用两次字面替换把它换成内联数据。替换点找不到就直接报错，
 * 不允许静默产出一个只能在 Node 跑的包。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 依赖顺序：被 import 的在前 */
const ORDER = [
  'core.js',
  'evalast.js',
  'lex.js',
  'parse.js',
  'ir.js',
  'interp.js',
  'game.js',
  'divine.js',
];

/** 两处 Node 专有的读取，浏览器版换掉 */
const DATA_PATCHES = [
  ['JSON.parse(readFileSync(DATA_URL, \'utf8\'))', 'globalThis.__YAO_DATA__.hexagrams'],
  ['JSON.parse(readFileSync(CORPUS_URL, \'utf8\'))', 'globalThis.__YAO_DATA__.corpus'],
];

function stripModuleSyntax(src) {
  const aliases = [];

  // `import { a, b as c } from 'x'` —— 别名必须补成声明，否则打包后 c 不存在
  let out = src.replace(
    /^import\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"];?\s*$/gm,
    (_, list) => {
      for (const part of list.split(',')) {
        const m = /^\s*([\w$]+)\s+as\s+([\w$]+)\s*$/.exec(part);
        if (m) aliases.push(`const ${m[2]} = ${m[1]};`);
      }
      return '';
    }
  );

  out = out
    .replace(/^import\s+[^;{]*;\s*$/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(?=(const|let|var|function|class|async))/gm, '');

  return (aliases.length ? aliases.join('\n') + '\n' : '') + out;
}

function patchData(src, file) {
  let out = src;
  for (const [from, to] of DATA_PATCHES) {
    if (!out.includes(from)) continue;
    out = out.split(from).join(to);
  }
  // 这两处必须被替换掉，否则浏览器里会去 require node:fs
  if (file === 'core.js' && out.includes('readFileSync(DATA_URL')) {
    throw new Error('core.js 的数据读取点没匹配上，打包会产出坏包');
  }
  if (file === 'divine.js' && out.includes('readFileSync(CORPUS_URL')) {
    throw new Error('divine.js 的数据读取点没匹配上，打包会产出坏包');
  }
  return out;
}

/** 生成可执行的模块源码（Node 里能直接 import，用来做测试） */
export function buildBundle() {
  const data = {
    hexagrams: JSON.parse(readFileSync(join(ROOT, 'data', 'hexagrams.json'), 'utf8')),
    corpus: JSON.parse(readFileSync(join(ROOT, 'data', 'corpus.json'), 'utf8')),
  };

  const sources = {};
  for (const f of ORDER) {
    const src = readFileSync(join(ROOT, 'src', f), 'utf8');
    sources[f] = stripModuleSyntax(patchData(src, f));
  }

  const yaoZhen = readFileSync(
    join(ROOT, 'examples', 'yao-zhen', 'yao_zhen.yao'),
    'utf8'
  );
  const guaJing = readFileSync(
    join(ROOT, 'examples', 'gua-jing', 'gua_jing.yao'),
    'utf8'
  );

  const parts = [];
  parts.push('// 由 tools/build_web.mjs 生成，请勿手工修改。');
  parts.push(`globalThis.__YAO_DATA__ = ${JSON.stringify(data)};`);
  parts.push(`globalThis.__YAO_SRC__ = ${JSON.stringify({ yaoZhen, guaJing })};`);
  for (const f of ORDER) {
    parts.push(`\n/* ───────── ${f} ───────── */`);
    parts.push(sources[f]);
  }

  parts.push(`
globalThis.__YAO__ = {
  // 位运算与卦表
  BY_ID, BY_NAME, HEXAGRAMS, nameOf, glyphOf, ben, dong, zhi, bian, cuo, zong, hu,
  bianShu, dangWei, yaoOf, fromDigits, toDigits, renderLines, xu, meta,
  POS_NAMES, SI_XIANG, ALIASES,
  // 编译器
  lex, parse, buildIr, Machine, trace, evalAst,
  // 游戏与占
  LEVELS, makeStepper, par, flippedLines,
  cast, judge, loadCorpus, coverage, yaoTitle,
};
`);

  return parts.join('\n');
}

/** 生成单文件 HTML */
export function buildHtml() {
  const bundle = buildBundle();
  const tpl = readFileSync(join(ROOT, 'web', 'src', 'template.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'web', 'src', 'style.css'), 'utf8');
  const app = readFileSync(join(ROOT, 'web', 'src', 'app.js'), 'utf8');

  const script = `${bundle}\n;(function () {\n${app}\n})();\n`;

  return tpl
    .replace('/*__CSS__*/', () => css)
    .replace('/*__SCRIPT__*/', () => script);
}

function main() {
  const outDir = join(ROOT, 'docs');
  mkdirSync(outDir, { recursive: true });

  const html = buildHtml();
  const outFile = join(outDir, 'index.html');
  writeFileSync(outFile, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`✓ docs/index.html  ${kb} KB（单文件，可直接双击）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
