#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 examples/gua-jing/gua_jing.yao —— 六十四卦地牢的状态机。

64 个房间就是 64 个卦，一个不浪费。生成而不是手写，是为了保证房间表
永远和 data/hexagrams.json 一致。

用法: python tools/gen_gua_jing.py
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "hexagrams.json"
OUT = ROOT / "examples" / "gua-jing" / "gua_jing.yao"

HEADER = """\
# 卦境 · 六十四卦地牢
#
# 房间 = 卦，移动 = 变爻。状态是 12 位的 `变`：
#   本 = 你现在在哪一间
#   动 = 你是从哪条爻走进来的（这一位记录了来路）
#   之 = 本 ^ 动 = 上一间房
#
# 由 tools/gen_gua_jing.py 生成，请勿手工编辑。

机 卦境 {
  事 行(位 n)
  事 错卦
  事 综卦
  事 互卦
"""

FOOTER = """
  # 移动：翻转第 n 爻，并记下这一爻是来路
  转 * 行   -> 变(本 ^ (1 << (n - 1)), 1 << (n - 1))

  # 错：六爻全变，等价于对径点跳跃；动 = 111111 时 之 正好是来处
  转 * 错卦 -> 变(错(本), 0b111111)

  # 综：镜像世界，坐标反序，不算爻变
  转 * 综卦 -> 变(综(本), 0)

  # 互：密道，走进卦的内部结构
  转 * 互卦 -> 变(互(本), 0)

  起 未济
}
"""


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    data = json.loads(DATA.read_text(encoding="utf-8"))
    hexagrams = data["hexagrams"]

    states = []
    for h in hexagrams:
        states.append(f"  态 {h['name']} = {h['name']}")

    text = HEADER + "\n" + "\n".join(states) + "\n" + FOOTER

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"已写入 {OUT.relative_to(ROOT)}  ({len(hexagrams)} 个态)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
