#!/usr/bin/env node
/**
 * 最小 MQTT 3.1.1 broker —— 只为验证示例，不是通用实现。
 *
 * 支持的报文：CONNECT / PINGREQ / DISCONNECT。
 * `--drop-ms=N` 会在第 N 毫秒主动断开，用来验证客户端的掉线与重连。
 *
 * 用法：node mock-broker.mjs [port] [--drop-ms=3000]
 */

import net from 'node:net';

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 1883);
const dropFlag = args.find((a) => a.startsWith('--drop-ms='));
const dropMs = dropFlag ? Number(dropFlag.split('=')[1]) : 0;

const log = (...a) => console.log('[broker]', ...a);

const server = net.createServer((sock) => {
  log('客户端接入');

  let timer = null;
  if (dropMs > 0) {
    timer = setTimeout(() => {
      log(`主动断开（${dropMs}ms）`);
      sock.destroy();
    }, dropMs);
  }

  sock.on('data', (buf) => {
    let i = 0;
    while (i < buf.length) {
      const type = buf[i] >> 4;
      const len = buf[i + 1] ?? 0;
      const total = 2 + len;

      if (type === 1) {
        log('收到 CONNECT');
        sock.write(Buffer.from([0x20, 0x02, 0x00, 0x00])); // CONNACK
        log('发 CONNACK');
      } else if (type === 12) {
        log('收到 PINGREQ');
        sock.write(Buffer.from([0xd0, 0x00])); // PINGRESP
        log('发 PINGRESP');
      } else if (type === 14) {
        log('收到 DISCONNECT');
        if (timer) clearTimeout(timer);
        sock.end();
      }
      i += total > 1 ? total : 1;
    }
  });

  sock.on('close', () => {
    if (timer) clearTimeout(timer);
    log('连接关闭');
  });
  sock.on('error', () => {});
});

server.listen(port, '127.0.0.1', () => {
  log(`监听 127.0.0.1:${port}` + (dropMs ? `，${dropMs}ms 后主动断开` : ''));
});
