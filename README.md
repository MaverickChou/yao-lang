# 爻 · Yao

**一门把状态机编译成 C 的 6 位语言。六十四卦，正好是 6 个比特。**

> [!WARNING]
> **辞库是草案。** `data/corpus.txt` 的 450 条卦辞爻辞（通行本）尚未逐字校对纸本，
> 可能有错字或句读出入。结构已机器校验，文本没有。
> 如果你要引用其中的辞文，请先自己核一遍，或参见
> [data/corpus.NOTES.md](data/corpus.NOTES.md)。
> 校对方法是 `yao corpus --unverified` 挑一条，核完在 `data/corpus.verified.txt` 里签字。

---

## English

**Yao (爻) is a 6-bit language that compiles state machines to C99.**

The 64 hexagrams of the *I Ching* are exactly 6 bits. That is not a metaphor — it is the
numeric foundation of the whole language:

| classical | bits |
|---|---|
| hexagram | 6-bit word, 64 values |
| line (爻) | 1 bit; bit 0 = bottom line |
| lower / upper trigram | bits 0–2 / bits 3–5 |
| 错 (invert) | `x ^ 0b111111` |
| 综 (reverse) | bit reversal |
| 互 (nuclear) | `((x>>1)&7) \| (((x>>2)&7)<<3)` |

The core type is `变` — 12 bits: the current hexagram `本` plus a bitmask of moving lines
`动`. The next state is derived, `之 = 本 ^ 动`, so divination and ordinary computation
share one type and one algebra.

```yao
机 闸机 {
  事 投币
  事 通过
  态 闲   = 坤
  态 放行 = 复
  转 闲   投币 -> 放行
  转 放行 通过 -> 闲
  起 闲
}
```

```bash
node bin/yao.js build 闸机.yao --main -o 闸机.c
gcc -std=c99 -Wall -Wextra -Werror 闸机.c -o 闸机
```

No dependencies, no install step: the compiler is plain ESM and runs on Node ≥ 20.

**Good for:** embedded state machines, protocol handshakes, device control, game logic.
**Not for:** strings, heap allocation, general-purpose computing. The host language
handles everything else; Yao only owns the part that is hardest to get right.

Because a single machine has at most 4096 states, the compiler **exhaustively verifies**
it: `yao check` reports reachability, dead states, undefined transitions, strongly
connected components and graph diameter — no abstraction, no bounded model checking.

Status: `v0.1.0`. 132 tests. The C backend is verified by actually compiling the generated
code and comparing its state trace with the interpreter's. Known gap: the 450 classical
text entries are a **draft transcription, not proofread** — see
[`data/corpus.NOTES.md`](data/corpus.NOTES.md).

License: MIT OR Apache-2.0.

---

## 先看一个程序

```yao
机 闸机 {
  事 投币
  事 通过

  态 闲   = 坤
  态 放行 = 复

  转 闲   投币 -> 放行
  转 放行 通过 -> 闲

  起 闲
}
```

```
$ node bin/yao.js build gate.yao --main -o gate.c
$ gcc -std=c99 -Wall -Wextra -Werror gate.c -o gate
$ ./gate
state=0000  ben=000000  dong=0  zhi=00
1
state=0001  ben=000001  dong=0  zhi=01
```

---

## 为什么是 64

六十四卦不是装饰，是这门语言的数值地基。每一卦就是一个 6 位整数，
每一爻就是一位，而《周易》里所有的变换都能写成一行位运算：

| 古典概念 | 位运算 | 例 |
|---|---|---|
| 错（旁通） | `x ^ 0b111111` | 既济 ⇄ 未济 |
| 综（反卦） | `bitrev6(x)` | 泰 ⇄ 否，损 ⇄ 益 |
| 互（互卦） | `((x>>1)&7) \| (((x>>2)&7)<<3)` | 既济 → 未济 |
| 变（动爻） | `本 ^ 动` | 老阳变阴、老阴变阳 |

本仓库的 `tools/gen_hexagrams.py` 会**推导并校验**全部 64 卦，而不是手抄一张表。
它验证的古典恒等式包括：

```
错综轨道 = 36（自反 8 + 对 28）
全当位唯一解 = 既济        全不当位唯一解 = 未济
既济之互卦 = 未济          泰/否 既互错又互综
```

运行：

```
python tools/gen_hexagrams.py --check
```

---

## 核心类型：`变`

一个 `变` 是 12 位：低 6 位是**本卦**，高 6 位是**动爻掩码**，而**之卦**由两者导出：

```
本 ⊕ 动 ⊕ 之 = 0
```

所以「占卜」不需要额外的数据结构——一次起卦的结果就是一个 `变`。
程序在状态之间行走，占卜只是在替你选走哪条边。**两者共用同一套位运算、同一个类型。**

---

## 定位

> 爻不是通用语言。它编译出真实程序里最难写、最容易错的那一部分：**状态机**。
> 其余部分交给宿主语言。

- **是**：嵌入式状态机、协议握手、设备控制、游戏行为、流程引擎
- **不是**：字符串处理、堆分配、GUI、通用计算

单机状态数固定 64；需要更大空间时用组卦（`64^N`），可验证性的边界在
[`SPEC.md` §9.3](SPEC.md) 里写得很清楚，没有含糊。

---

## 快速开始

需要 Node.js ≥ 20。当前是 M1：核心代数 + 词法器 + 表达式求值 + REPL，
**还没有编译器**（M2 才开始生成 C）。

Windows 直接双击 `yao.cmd`，或在终端里：

```bat
yao                  :: 进入 REPL
yao cast             :: 掷金钱卦起一卦
yao test             :: 自检
```

PowerShell：

```powershell
.\yao                  # 进入 REPL（自动调用 yao.cmd）
.\yao.ps1 cast --seed=42
```

已经装了 Node 的话，也可以直接：

```bash
node bin/yao.js              # 进入 REPL
node bin/yao.js cast         # 掷金钱卦起一卦
node bin/yao.js cast --seed=42
node bin/yao.js eval "互(既济)"
node bin/yao.js info 既济/初上
node bin/yao.js table        # 64 卦全表
node --test                  # 70 项测试（古典恒等式 + 一致性用例）
```

REPL 里可以直接写：

```
爻 既济
爻 987789
爻 互(泰)
爻 变数(既济/初上)
爻 序(乾, 文王)
```

输出：

```
  既济 ䷾  0b010101 · 坎/离 · 文王序 63

  上  ▅▅ ▅▅ ×
  五  ▅▅▅▅▅
  四  ▅▅ ▅▅
  三  ▅▅▅▅▅
  二  ▅▅ ▅▅
  初  ▅▅▅▅▅ ○

  本 既济　之 渐　变数 2　动爻 初上
  互 未济　错 未济　综 未济　当位 6/6
  [987876]
```

终端字体缺少卦象字符时加 `--ascii`。

> **启动器说明**：`yao.cmd` / `yao.ps1` 会依次查找仓库内的 `runtime\node.exe`、
> `C:\Program Files\nodejs\node.exe`、`%LOCALAPPDATA%\Programs\nodejs\node.exe`，
> 最后才查 PATH，并自动把控制台切到 UTF-8（否则卦象字符会是乱码）。
> 两个脚本刻意保持纯 ASCII——Windows 会按系统 ANSI 代码页读取它们，
> 写中文会截断引号。
>
> 如果 `node` 命令在系统里找不到但 Node 确实装了，通常是 PATH 被截断。
> 临时修复（只影响当前窗口）：
>
> ```powershell
> $env:PATH += "C:\Program Files\nodejs"
> ```

---

## 网页版

不想装 Node？直接玩：

**https://maverickchou.github.io/yao-lang/**

一个 90 KB 的单文件 HTML，语言内核（`src/*.js`）原样打包在里面——
没有后端、没有 WASM、没有依赖。双击 `docs/index.html` 也能离线运行。

```bash
node tools/build_web.mjs     # 重新生成 docs/index.html
```

页面里有两件事：**爻阵**（六关解谜）和 **卦盘**（输入 `既济` / `987789` / `泰/初上`，
看卦图、错综互、以及按七分支断出的辞）。

打包器不只是字符串拼接：它会把两处 `node:fs` 的读取替换成内联数据，
替换点找不到就**直接报错**，不允许静默产出一个只能在 Node 跑的包。
`tests/web-bundle.test.js` 会把打包产物当模块 import 进来，真的建机器、真的走完六关。

## 仓库结构

```
SPEC.md                 语言规范 v0.1（位布局、词法、类型、诊断、ABI）
data/hexagrams.json     64 卦元数据（由脚本生成，含错综互关系）
data/corpus.txt        卦辞爻辞底本，450 条（手改源头）
data/corpus.json       生成物，由 tools/build_corpus.py 编译
tools/gen_hexagrams.py  生成器 + 校验器
tools/gen_gua_jing.py   地牢状态机生成器
conformance/core.json   一致性用例（第三方实现可据此验证兼容性）
src/core.js             变 / 卦 的位运算与渲染
src/lex.js              词法器（爻串、卦名、简繁别名、动爻后缀）
src/eval.js             表达式求值（M1 子集）
src/parse.js            机器文法：机 / 事 / 态 / 转 / 起
src/ir.js               IR 与静态检查
src/interp.js           IR 解释器
src/codegen-c.js        C99 后端
src/validate.js         验证器：穷举可达图、死态、强连通、直径
src/divine.js           占：筮 / 七分支断 / 爻题 / 覆盖检查
src/game.js             爻阵游戏壳：关卡、BFS 最优步数
src/cc.js               C 编译器探测与调用
bin/yao.js              CLI 与 REPL
tests/                  132 项测试（含 C 编译运行比对）
examples/gua-jing/      六十四卦地牢（状态机 demo）
docs/index.html         网页版（单文件，由 tools/build_web.mjs 生成）
examples/yao-zhen/      爻阵（解谜游戏）
.github/workflows/ci.yml  CI：卦表校验 / 辞库 / 测试 / C 零警告编译
```

## 写一台机器

```yao
机 闸机 {
  事 投币
  事 通过

  态 闲   = 坤
  态 放行 = 复

  转 闲   投币 -> 放行
  转 放行 通过 -> 闲

  起 闲
}
```

```bash
yao check 闸机.yao            # 验证：可达性 / 死态 / 未定义转移 / 强连通
yao run  闸机.yao            # 交互运行
yao trace 闸机.yao 投币 通过   # 打印状态轨迹
yao build 闸机.yao --main -o 闸机.c
```

`yao check` 会把 4096 个可能状态全部走一遍：

```
  卦境 · 验证

  声明态      64
  可达态      512 / 4096
  态可达      64 / 64
  死态        0
  未定义转移  0 / 256（态 × 事件）
  强连通      是（1 个分量，512 个状态）
  图直径      4 步
  最远的态    乾（3 步）

  ✓ 没有发现问题
```

这是 6 位状态空间换来的东西：**没有抽象、没有有界检验，直接穷举完。**

态可以带参数化的事件，转移目标可以是任意表达式：

```yao
事 行(位 n)
转 * 行 -> 变(本 ^ (1 << (n - 1)), 1 << (n - 1))
```

`本` 是当前状态的卦体，`变(体, 动)` 构造新的 `变`。一条规则写完六十四卦的移动。

转移目标里还能按值分发：

```yao
转 * 行 -> 合 变数(变) {
  0 => 本,                    # 静卦：不动
  6 => 变(本, 0),             # 六爻全动：归位
  _ => 变(本 ^ (1 << (n - 1)), 1 << (n - 1))
}
```

## 占

`占` 是标准库，不是语言特性：语言只提供 `变` 与 `变数`，断法在库里，辞在数据里。

```bash
yao divine                    # 掷金钱卦并断
yao divine --seed=42          # 可复现
yao divine 泰/100001          # 指定卦变
yao corpus                    # 辞库覆盖检查
```

```
  本卦 泰 ䷊   之卦 大畜 ䷙   变数 1
  一爻动，以本卦该动爻爻辞断

  上六 爻辞  ䷊
    城复于隍，勿用师。自邑告命，贞吝
```

七分支断法全部落地：静卦取本卦卦辞，一至五爻动各有定法，
六爻全动时乾用九、坤用六、余卦取之卦卦辞。

> **辞文是 draft。** 450 条（64 卦辞 + 384 爻辞 + 用九用六）结构已机器校验，
> 但未逐字校对纸本。详见 [data/corpus.NOTES.md](data/corpus.NOTES.md)。

## 游戏：爻阵

```bash
yao game
```

按第 n 爻，**该爻与相邻的爻一起翻转**（"动一爻而牵动其比"）。六关，每关给一个目标卦，
把它走出来。每关的最优步数由宿主在 64 节点图上现算 BFS，不是写死的。

```
  第 1 / 6 关 · 通  天地交而万物通。
  目标 泰 ䷊   步数 2 / 6   最优 4
  噬嗑 ䷔  上离 下震
  上 ▅▅▅▅▅
  五 ▅▅ ▅▅
  ...
```

机制成立的原因：移动是 GF(2) 上的线性变换，按两次等于没按，所以 64 卦在六种按法下
构成连通图——**任何目标都可达**，六关必然有解。这一点由测试直接断言，不是假设。

## 旗舰 demo：六十四卦地牢

64 个房间就是 64 个卦，一个不浪费。

| 游戏 | 语言 |
|---|---|
| 64 个房间 | 64 个 `态`，一态一卦 |
| 6 个出口 | 变一爻 → 6 个邻居 |
| 传送门 | `错卦`（对径点，六爻全变） |
| 镜像世界 | `综卦`（坐标反序） |
| 密道 | `互卦`（走进内部结构） |
| 来路 | `动` 字段记住你从哪条爻进来 |
| 起点 / 终点 | 未济 → 既济 |

整个地牢只有 **4 条转移规则**，却铺满了 64 个状态：

```yao
转 * 行   -> 变(本 ^ (1 << (n - 1)), 1 << (n - 1))
转 * 错卦 -> 变(错(本), 0b111111)
转 * 综卦 -> 变(综(本), 0)
转 * 互卦 -> 变(互(本), 0)
```

```bash
yao run examples/gua-jing/gua_jing.yao
```

一条隐藏的性质：`错卦` 一步就能从 未济 走到 既济——因为 未济 与 既济 互为错卦。
验证器跑完 4096 个可能状态后给出的实数：可达 512 个，64 个房间全通，未济 → 既济 只要 **1 步**（错卦），离起点最远的 乾 / 坤 是 **3 步**，全图直径 **4 步**。

## 路线图

| 阶段 | 交付 | 状态 |
|---|---|---|
| M0 | 规范 + 64 卦元数据 + 校验脚本 | ✅ 完成 |
| M1 | 词法 / 表达式求值 / REPL / 一致性用例 | ✅ 完成 |
| M2 | 机器文法 / IR / 解释器 / C99 后端 / **地牢 demo** | ✅ 完成 |
| M3 | 验证器：穷举可达图 / 死态 / 强连通 / 直径 | ✅ 完成 |
| M4 | `合` + `占` 标准库 + 辞库 450 条 | ✅ 完成（辞文待校对） |
| M5 | **C 后端真编译验证 + 轨迹等价 + CI + 爻阵游戏** | ✅ 完成 |
| M6 | 网页 playground（单文件 HTML，无需后端） | ✅ 完成 |
| M7 | WASM 后端（编译到 .wasm） | 计划中 |

> **C 后端已通过真编译。** 生成的 C 由 `gcc -std=c99 -Wall -Wextra -Werror` 零警告编译，
> 并与解释器逐事件比对轨迹（`tests/c-equivalence.test.js`，4 组用例）。
> 这是 SPEC §14.3 约定的验收标准，现在由 CI 强制执行。

---

## 参与

- 规范讨论：开 issue，标题加 `[spec]`
- **最需要的帮助：校对辞库。** 450 条已就位但 0 条校对：

  ```bash
  yao corpus --unverified     # 列出未校对条目
  ```

  校对一条就在 `data/corpus.verified.txt` 里加一行（如 `乾.1`），
  再跑 `python tools/build_corpus.py`。详见 [data/corpus.NOTES.md](data/corpus.NOTES.md)。
- 其次：`若` / `印` / `组` 三个语法构件、`大衍` 起卦法、WASM playground
- 提交前请确保这三条都过：

```bash
python tools/gen_hexagrams.py --check
python tools/build_corpus.py --check
node --test
```

## 许可证

双许可，任选其一：

- [MIT](LICENSE-MIT)
- [Apache-2.0](LICENSE-APACHE)

《周易》原文属公有领域；`data/corpus.txt` 的简体化与标点按上述许可发布。
