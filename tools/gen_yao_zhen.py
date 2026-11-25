#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 examples/yao-zhen/yao_zhen.yao —— 爻阵（解谜游戏）的状态机。

规则：按第 n 爻时，该爻**及其相邻之爻**一起翻转（"比"）。
这是《易》里"动一爻而牵动其比"的直译，也让游戏成为一个真正的解谜：
按对了位置，可能反而弄坏旁边。

目标卦由宿主（游戏壳）指定，机器只管移动。
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "hexagrams.json"
OUT = ROOT / "examples" / "yao-zhen" / "yao_zhen.yao"

HEADER = """\
# 爻阵 · 解谜游戏
#
# 按第 n 爻，该爻与其相邻之爻一起翻转（比）。
# 六爻之阵，牵一发而动全身。
#
# 由 tools/gen_yao_zhen.py 生成，请勿手工编辑。

机 爻阵 {
  事 行(位 n)
"""

FOOTER = """
  # 二至五爻：连自己带左右，共三爻翻转
  # 初爻与上爻只在边界内翻转两爻
  转 * 行 -> 合 n {
    1 => 变(本 ^ 0b000011, 1),
    6 => 变(本 ^ 0b110000, 0b100000),
    _ => 变(本 ^ (7 << (n - 2)), 1 << (n - 1))
  }

  起 未济
}
"""


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    hexagrams = json.loads(DATA.read_text(encoding="utf-8"))["hexagrams"]
    states = "\n".join(f"  态 {h['name']} = {h['name']}" for h in hexagrams)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(HEADER + "\n" + states + "\n" + FOOTER, encoding="utf-8", newline="\n")
    print(f"已写入 {OUT.relative_to(ROOT)}  ({len(hexagrams)} 个态)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
