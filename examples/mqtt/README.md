# MQTT 3.1.1 客户端

**这不是为演示语言而编的状态机，是协议规定的状态机。** 连接生命周期 + keepalive
心跳 + 断线重连，全部写在 12 条转移规则里。

```bash
yao build mqtt.yao --header -o mqtt.c
gcc -std=c99 -Wall -Wextra -Werror mqtt.c host.c -o mqtt -lws2_32   # Windows
gcc -std=c99 -Wall -Wextra -Werror mqtt.c host.c -o mqtt            # POSIX

node mock-broker.mjs 1883 --drop-ms=3500 &
./mqtt 127.0.0.1 1883 9
```

```
  t  状态        动作
  ------------------------------
   0  连接中  发 CONNECT
   0  已连接  收到 CONNACK
   1  已连接  发 PINGREQ
   1  已连接  收到 PINGRESP
   3  连接中  关连接
   3  连接中  发 CONNECT
   3  已连接  收到 CONNACK
   4  已连接  发 PINGREQ
```

第 3 秒 broker 主动掐断，客户端关连接、退避一秒、重连、拿到新的 CONNACK。

## 6 位怎么装下一个心跳状态机

```
bit0-2  相位：0 空闲 / 1 连接中 / 2 已连接 / 3 关闭中 / 4 重连等待
bit3    有未决的 PINGREQ（发了还没收到 PINGRESP）
```

于是「心跳发了没回」不需要额外一个 `bool ping_outstanding`——它就是状态的第 4 位。
`已连接` 是 `0b0010`，「已连接且等 PINGRESP」是 `0b1010`，两个不同的态，
各自有自己的规则。

```yao
转 已连接     心跳       -> { 印 2; 已连接待答 }
转 已连接待答 心跳       -> { 印 4; 重连等待 }
转 已连接待答 收到PINGRESP -> 已连接
```

`印` 输出的是**动作码**，不是字符串：1 发 CONNECT、2 发 PINGREQ、3 发 DISCONNECT、
4 关连接。机器不碰 socket，只说自己想干什么。

## 和手写 switch 比，好在哪

典型的 C 实现通常长这样：

```c
enum state { IDLE, CONNECTING, CONNECTED, CLOSING };
static enum state st;
static bool ping_outstanding;
static time_t last_ping, last_tick;

void on_tick(void) {
  if (st == CONNECTED && !ping_outstanding) { send_ping(); ping_outstanding = true; }
  else if (st == CONNECTED && ping_outstanding) { /* 超时 */ close_and_reconnect(); }
  ...
}
void on_disconnect(void) {
  switch (st) {
    case CONNECTED: ...
    case CONNECTING: ...
    ...
  }
}
```

问题不在语法，在**可达性**：`st` 和 `ping_outstanding` 是两个独立变量，
`(CLOSING, true)` 这种组合是否合法，只有读代码的人知道；漏掉一个分支
只会在生产环境的某次竞态里出现。

爻把它们合并成一个字，于是：

- **每个组合都必须显式声明或明确不声明**，未定义转移会被 `yao check` 数出来
- 12 条规则覆盖 6 个状态 × 6 个事件中的 12 个，剩下 24 个是**有意不定义**的
- `yao check` 还能说：图强连通、直径 4

```
  MQTT客户端 · 验证

  声明态      6
  可达态      6 / 4096
  死态        0
  未定义转移  24 / 36（态 × 事件）
  强连通      是（1 个分量，6 个状态）
  图直径      4 步
```

## 这个例子证明不了什么

- 只覆盖**连接生命周期**：没有 QoS、没有 TLS、没有用户名密码、没有遗嘱消息
- 宿主 200 行 C，其中大部分是 socket 与报文编解码——那部分不是语言的功劳
- broker 是 80 行的 mock，只认 CONNECT / PINGREQ / DISCONNECT

它能证明的只有一件事：**一个真实的协议状态机可以用 12 条规则写完，并且能被穷举检查。**
至于这比 switch 更可靠多少，取决于你信不信"未定义转移可以被数出来"这件事。

## 文件

| 文件 | 说明 |
|---|---|
| `mqtt.yao` | 状态机，6 态 12 规则 |
| `host.c` | socket + MQTT 编解码 + 定时器，Win/POSIX 通用 |
| `mock-broker.mjs` | 最小 broker，`--drop-ms` 用来验证重连 |
| `tests/mqtt.test.js` | 真起 broker、真编译、真连接，断言重连成功 |
