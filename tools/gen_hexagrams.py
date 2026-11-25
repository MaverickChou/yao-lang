#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 data/hexagrams.json —— 爻 (Yao) 语言 v0.1 的 64 卦元数据。

设计原则：凡是可以推导的，绝不手写。
    - 卦象字符 (U+4DC0..U+4DFF) 按文王序排列，因此 glyph = chr(0x4DC0 + order - 1)
    - 二进制值由 (上卦, 下卦) 唯一确定
    - 错/综/互 全部由位运算导出
手写的只有两样东西：文王序的卦名表、上下卦组成表。
两者都由本脚本自校验（64 个互异二进制、文王序 1..64 全覆盖、错综轨道数 = 36）。

用法:
    python tools/gen_hexagrams.py            # 生成 data/hexagrams.json 并打印校验摘要
    python tools/gen_hexagrams.py --check    # 只校验，不写文件
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

# ---------------------------------------------------------------- 基本约定

# 爻位：bit0 = 初爻（最下），bit5 = 上爻（最上）。这条约定是全语言的宪法。
def bit(x: int, i: int) -> int:
    """取第 i 爻（i = 1..6，自初爻起）。"""
    return (x >> (i - 1)) & 1


# 八卦：值为三爻位模式，bit0 = 初爻
TRIGRAMS = [
    # (名, 值, 卦象字符, 象, 卦德)
    ("乾", 0b111, "\u2630", "天", "健"),
    ("兑", 0b011, "\u2631", "泽", "悦"),
    ("离", 0b101, "\u2632", "火", "丽"),
    ("震", 0b001, "\u2633", "雷", "动"),
    ("巽", 0b110, "\u2634", "风", "入"),
    ("坎", 0b010, "\u2635", "水", "陷"),
    ("艮", 0b100, "\u2636", "山", "止"),
    ("坤", 0b000, "\u2637", "地", "顺"),
]
TRI = {name: val for name, val, *_ in TRIGRAMS}

# 文王序 1..64：(卦名, 上卦, 下卦)
KING_WEN = [
    ("乾", "乾", "乾"), ("坤", "坤", "坤"), ("屯", "坎", "震"), ("蒙", "艮", "坎"),
    ("需", "坎", "乾"), ("讼", "乾", "坎"), ("师", "坤", "坎"), ("比", "坎", "坤"),
    ("小畜", "巽", "乾"), ("履", "乾", "兑"), ("泰", "坤", "乾"), ("否", "乾", "坤"),
    ("同人", "乾", "离"), ("大有", "离", "乾"), ("谦", "坤", "艮"), ("豫", "震", "坤"),
    ("随", "兑", "震"), ("蛊", "艮", "巽"), ("临", "坤", "兑"), ("观", "巽", "坤"),
    ("噬嗑", "离", "震"), ("贲", "艮", "离"), ("剥", "艮", "坤"), ("复", "坤", "震"),
    ("无妄", "乾", "震"), ("大畜", "艮", "乾"), ("颐", "艮", "震"), ("大过", "兑", "巽"),
    ("坎", "坎", "坎"), ("离", "离", "离"), ("咸", "兑", "艮"), ("恒", "震", "巽"),
    ("遯", "乾", "艮"), ("大壮", "震", "乾"), ("晋", "离", "坤"), ("明夷", "坤", "离"),
    ("家人", "巽", "离"), ("睽", "离", "兑"), ("蹇", "坎", "艮"), ("解", "震", "坎"),
    ("损", "艮", "兑"), ("益", "巽", "震"), ("夬", "兑", "乾"), ("姤", "乾", "巽"),
    ("萃", "兑", "坤"), ("升", "坤", "巽"), ("困", "兑", "坎"), ("井", "坎", "巽"),
    ("革", "兑", "离"), ("鼎", "离", "巽"), ("震", "震", "震"), ("艮", "艮", "艮"),
    ("渐", "巽", "艮"), ("归妹", "震", "兑"), ("丰", "震", "离"), ("旅", "离", "艮"),
    ("巽", "巽", "巽"), ("兑", "兑", "兑"), ("涣", "巽", "坎"), ("节", "坎", "兑"),
    ("中孚", "巽", "兑"), ("小过", "震", "艮"), ("既济", "坎", "离"), ("未济", "离", "坎"),
]

# 繁体 / 异体别名。规范形一律用简体；AST 内部只存 0..63 的序号。
ALIASES = {
    "訟": "讼", "師": "师", "謙": "谦", "隨": "随", "蠱": "蛊", "臨": "临", "觀": "观",
    "賁": "贲", "剝": "剥", "復": "复", "無妄": "无妄", "頤": "颐", "大過": "大过",
    "離": "离", "恆": "恒", "遁": "遯", "大壯": "大壮", "晉": "晋", "損": "损",
    "漸": "渐", "歸妹": "归妹", "豐": "丰", "兌": "兑", "渙": "涣", "節": "节",
    "小過": "小过", "既濟": "既济", "未濟": "未济", "暌": "睽", "无妄": "无妄",
    "頥": "颐", "旣濟": "既济",
}

# 英文转写，给非中文用户与不便切输入法的人用（同时也是 CLI 的稳定 ID）
PINYIN = [
    "qian", "kun", "zhun", "meng", "xu", "song", "shi", "bi",
    "xiaoxu", "lv", "tai", "pi", "tongren", "dayou", "qian2", "yu",
    "sui", "gu", "lin", "guan", "shike", "bi2", "bo", "fu",
    "wuwang", "daxu", "yi2", "daguo", "kan", "li", "xian", "heng",
    "dun", "dazhuang", "jin", "mingyi", "jiaren", "kui", "jian", "jie",
    "sun", "yi3", "guai", "gou", "cui", "sheng", "kun2", "jing",
    "ge", "ding", "zhen", "gen", "jian4", "guimei", "feng", "lv3",
    "xun", "dui", "huan", "jie2", "zhongfu", "xiaoguo", "jiji", "weiji",
]


# ---------------------------------------------------------------- 位运算

def rev6(x: int) -> int:
    """综卦：六爻倒序（初爻 <-> 上爻）。"""
    return int(format(x, "06b")[::-1], 2)


def cuo(x: int) -> int:
    """错卦：六爻全变。"""
    return x ^ 0b111111


def hu(x: int) -> int:
    """互卦：下互取 2/3/4 爻，上互取 3/4/5 爻。"""
    return ((x >> 1) & 0b111) | (((x >> 2) & 0b111) << 3)


def dangwei(x: int) -> int:
    """当位爻数：奇数位宜阳，偶数位宜阴（1..6，初爻为 1）。"""
    n = 0
    for i in range(1, 7):
        want = 1 if i % 2 == 1 else 0
        if bit(x, i) == want:
            n += 1
    return n


def lines(x: int) -> str:
    """把卦渲染成六行字符画，自上而下。"""
    out = []
    for i in range(6, 0, -1):
        out.append("\u2585\u2585\u2585\u2585\u2585" if bit(x, i) else "\u2585\u2585 \u2585\u2585")
    return "\n".join(out)


# ---------------------------------------------------------------- 构建

def build() -> dict:
    assert len(KING_WEN) == 64, "文王序必须是 64 卦"

    entries = []
    for idx, (name, up, lo) in enumerate(KING_WEN, start=1):
        value = TRI[lo] | (TRI[up] << 3)
        entries.append({
            "order": idx,                       # 文王序 1..64
            "id": value,                        # 卦值 0..63（先天序）
            "name": name,
            "glyph": chr(0x4DC0 + idx - 1),
            "binary": format(value, "06b"),
            "upper": up,
            "lower": lo,
            "pinyin": PINYIN[idx - 1],
            "alias": sorted(k for k, v in ALIASES.items() if v == name),
            "dangwei": dangwei(value),
        })

    by_id = {e["id"]: e for e in entries}
    by_name = {e["name"]: e for e in entries}

    # 补上关系字段：错 / 综 / 互
    for e in entries:
        e["cuo"] = by_id[cuo(e["id"])]["name"]
        e["zong"] = by_id[rev6(e["id"])]["name"]
        e["hu"] = by_id[hu(e["id"])]["name"]

    # ---- 校验 1：64 个互异卦值、文王序全覆盖
    assert len(by_id) == 64, "卦值必须互异且覆盖 0..63"
    assert set(by_id) == set(range(64)), "卦值必须是 0..63 的全集"
    assert [e["order"] for e in entries] == list(range(1, 65))

    # ---- 校验 2：错综是对合
    for e in entries:
        assert cuo(cuo(e["id"])) == e["id"]
        assert rev6(rev6(e["id"])) == e["id"]

    # ---- 校验 3：综卦轨道数应为 36（8 个自反 + 28 对）
    seen, orbits = set(), []
    for e in entries:
        if e["id"] in seen:
            continue
        orbit = {e["id"], rev6(e["id"])}
        seen |= orbit
        orbits.append(sorted(orbit))
    n_self = sum(1 for o in orbits if len(o) == 1)
    n_pairs = sum(1 for o in orbits if len(o) == 2)
    assert n_self == 8 and n_pairs == 28 and len(orbits) == 36, (
        f"错综轨道异常: self={n_self} pairs={n_pairs} total={len(orbits)}"
    )

    # ---- 校验 4：几条古典恒等式必须成立
    assert by_name["既济"]["id"] ^ 0b111111 == by_name["未济"]["id"], "既济/未济应互为错卦"
    assert rev6(by_name["既济"]["id"]) == by_name["未济"]["id"], "既济/未济应互为综卦"
    assert by_name["既济"]["hu"] == "未济", "既济之互卦应为未济"
    assert by_name["泰"]["id"] ^ 0b111111 == by_name["否"]["id"], "泰/否应互为错卦"
    assert rev6(by_name["泰"]["id"]) == by_name["否"]["id"], "泰/否应互为综卦"
    assert rev6(by_name["损"]["id"]) == by_name["益"]["id"], "损/益应互为综卦"
    assert rev6(by_name["屯"]["id"]) == by_name["蒙"]["id"], "屯/蒙应互为综卦"
    assert by_name["乾"]["hu"] == "乾" and by_name["坤"]["hu"] == "坤"
    # 全当位唯一既济，全不当位唯一未济
    assert [e["name"] for e in entries if e["dangwei"] == 6] == ["既济"]
    assert [e["name"] for e in entries if e["dangwei"] == 0] == ["未济"]

    # ---- 校验 5：卦象字符与文王序一一对应
    for e in entries:
        assert e["glyph"] == chr(0x4DC0 + e["order"] - 1)

    return {
        "spec_version": "0.1",
        "language": "爻",
        "encoding": {
            "word_bits": 6,
            "line_order": "bit0 = 初爻（最下），bit5 = 上爻（最上）",
            "hexagram": "卦 = 低 6 位；下卦 = bits0..2，上卦 = bits3..5",
            "bian": "变 = 低 6 位 本卦 + 高 6 位 动爻掩码；之卦 = 本 ^ 动",
            "glyph_block": "U+4DC0..U+4DFF，按文王序排列",
        },
        "trigrams": [
            {"name": n, "value": v, "glyph": g, "image": im, "de": de,
             "binary": format(v, "03b")}
            for n, v, g, im, de in TRIGRAMS
        ],
        "hexagrams": entries,
        "stats": {
            "count": 64,
            "zong_orbits": len(orbits),
            "self_zong": n_self,
            "zong_pairs": n_pairs,
        },
    }


def main() -> int:
    # 控制台可能是 GBK（Windows 中文默认），卦象字符不在其字符集内；降级而不崩溃。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    ap.add_argument("--out", default="data/hexagrams.json")
    args = ap.parse_args()

    data = build()
    entries = data["hexagrams"]

    print(f"爻 v{data['spec_version']} - 64 卦元数据")
    print(f"  错综轨道: {data['stats']['zong_orbits']} "
          f"(自反 {data['stats']['self_zong']} + 对 {data['stats']['zong_pairs']})")
    print(f"  全当位/全不当位: "
          f"{[e['name'] for e in entries if e['dangwei'] == 6]} / "
          f"{[e['name'] for e in entries if e['dangwei'] == 0]}")
    print("\n  文王序  卦象  名      二进制  上/下   错综互")
    for e in entries:
        print(f"  {e['order']:>3}   {e['glyph']}  {e['name']:<4}  {e['binary']}  "
              f"{e['upper']}/{e['lower']}   {e['cuo']}/{e['zong']}/{e['hu']}")

    if not args.check:
        out = pathlib.Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"\n  已写入 {out}")
    else:
        print("\n  --check: 全部校验通过，未写文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
