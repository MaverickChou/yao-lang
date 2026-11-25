/**
 * 爻 · C 工具链探测与调用
 *
 * 生成物必须被真正的编译器编译过、真正的执行过，才算数。
 * 找不到编译器时调用方必须**跳过并标记**，不能假装通过。
 *
 * 注意（Windows）：本仓库路径含中文，而 MinGW 的 ld 用 ANSI API 解析路径，
 * 会在非 ASCII 目录下报 `cannot find crt2.o`。所以调用方**必须**把源文件
 * 复制到一个纯 ASCII 的工作目录（如 os.tmpdir()）再编译。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const WIN = process.platform === 'win32';

function candidates() {
  return [
    process.env.YAO_CC,
    ...(WIN
      ? [
          'F:\\yao-tools\\mingw64\\bin\\gcc.exe',
          'C:\\yao-tools\\mingw64\\bin\\gcc.exe',
        ]
      : []),
    'gcc',
    'clang',
    'cc',
  ].filter(Boolean);
}

/** @returns {string|null} 可用的 C 编译器路径 */
export function findCc() {
  for (const c of candidates()) {
    if (c.includes('/') || c.includes('\\')) {
      if (!existsSync(c)) continue;
    }
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0) return c;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

/**
 * 编译。默认 -std=c99 -Wall -Wextra -Werror —— 生成物必须零警告。
 * @returns {{ok: boolean, stderr: string}}
 */
export function compile(cc, srcPath, outPath, extra = []) {
  const args = ['-std=c99', '-Wall', '-Wextra', '-Werror', srcPath, '-o', outPath, ...extra];
  const r = spawnSync(cc, args, { encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, stderr: (r.stderr || '') + (r.stdout || '') };
}

/** 运行并喂入标准输入 */
export function runBinary(binPath, stdinText) {
  const r = spawnSync(binPath, [], { input: stdinText, encoding: 'utf8', timeout: 20000 });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** 从 `state=0101` 形式里抽出 12 位值 */
export function parseStates(stdout) {
  const out = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /state=([0-9A-Fa-f]{1,4})/.exec(line);
    if (m) out.push(parseInt(m[1], 16));
  }
  return out;
}

export { WIN };
