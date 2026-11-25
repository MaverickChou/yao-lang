/**
 * MQTT 示例的端到端测试。
 *
 * 真的起一个 TCP broker，真的编译 C 宿主，真的连上去跑，
 * 断言客户端能建立连接、发心跳、并在链路被掐断后自动重连。
 *
 * 没有 C 编译器时整组跳过（不假装通过）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parse.js';
import { buildIr } from '../src/ir.js';
import { emitC, emitHeader } from '../src/codegen-c.js';
import { findCc, compile } from '../src/cc.js';

const CC = findCc();
const maybe = CC ? test : test.skip;

const EXAMPLE = fileURLToPath(new URL('../examples/mqtt/', import.meta.url));
const BROKER = join(EXAMPLE, 'mock-broker.mjs');
const HOST_C = join(EXAMPLE, 'host.c');

const PORT = 20000 + Math.floor(Math.random() * 8000);

function buildClient(dir) {
  const ir = buildIr(parse(readFileSync(join(EXAMPLE, 'mqtt.yao'), 'utf8')));
  writeFileSync(join(dir, 'mqtt.c'), emitC(ir), 'utf8');
  writeFileSync(join(dir, 'mqtt.h'), emitHeader(ir), 'utf8');
  copyFileSync(HOST_C, join(dir, 'host.c'));

  const exe = join(dir, process.platform === 'win32' ? 'mqtt.exe' : 'mqtt');
  const extra = process.platform === 'win32' ? ['-lws2_32'] : [];
  const r = compile(CC, join(dir, 'mqtt.c'), exe, [join(dir, 'host.c'), ...extra]);
  assert.ok(r.ok, `编译失败:\n${r.stderr}`);
  return exe;
}

maybe('MQTT：连上 broker、发心跳、被掐断后自动重连', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yao-mqtt-'));
  let broker = null;
  try {
    const exe = buildClient(dir);

    broker = spawn(process.execPath, [BROKER, String(PORT), '--drop-ms=2500'], {
      stdio: 'ignore',
    });
    // 等 broker 起监听；CI 机器慢，给足时间（客户端本身也会重试）
    await new Promise((r) => setTimeout(r, 1500));

    const run = spawnSync(exe, ['127.0.0.1', String(PORT), '7'], {
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(run.status, 0, `客户端异常退出：${run.stderr}`);

    const out = run.stdout;
    const connacks = (out.match(/收到 CONNACK/g) || []).length;
    const pings = (out.match(/发 PINGREQ/g) || []).length;
    const closes = (out.match(/关连接/g) || []).length;

    assert.ok(connacks >= 2, `应在断线后重连（收到 ${connacks} 次 CONNACK）`);
    assert.ok(pings >= 2, `应发出心跳（${pings} 次 PINGREQ）`);
    assert.ok(closes >= 1, '断线后应关闭连接');
    // 首次连接若撞上 broker 还没起监听，允许失败——但必须自己重试成功
    assert.ok(connacks >= 2, '重试后应连上');
  } finally {
    if (broker) broker.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

maybe('MQTT：主动断开会发 DISCONNECT 并回到空闲', async () => {
  // 这条只验证状态机的行为（不需要 broker）：断开 → 关闭中 → 网络断 → 空闲
  const ir = buildIr(parse(readFileSync(join(EXAMPLE, 'mqtt.yao'), 'utf8')));
  const { Machine } = await import('../src/interp.js');

  const actions = [];
  const m = new Machine(ir, { sink: (v) => actions.push(v) });

  m.step('连接', 0);
  m.step('收到CONNACK', 0);
  assert.equal(m.state & 7, 2, '应在已连接');

  m.step('断开', 0);
  assert.deepEqual(actions, [1, 3], '应先发 CONNECT，再发 DISCONNECT');
  assert.equal(m.state & 7, 3, '应在关闭中');

  m.step('网络断', 0);
  assert.equal(m.state & 7, 0, '应回到空闲');
});

maybe('MQTT：心跳未回则判定链路已死', async () => {
  const ir = buildIr(parse(readFileSync(join(EXAMPLE, 'mqtt.yao'), 'utf8')));
  const { Machine } = await import('../src/interp.js');

  const m = new Machine(ir);
  m.step('连接', 0);
  m.step('收到CONNACK', 0);
  assert.equal(m.state & 7, 2);

  m.step('心跳', 0);
  assert.equal(m.state, 2 | (1 << 3), '应标记 PING 未决');

  m.step('心跳', 0);
  assert.equal(m.state & 7, 4, '第二次心跳仍未回 → 重连等待');
});
