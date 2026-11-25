#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/corpus.txt 与一份第三方转录本逐字比对。

**这不是校勘。** 它只回答一个问题："我们的稿子与某个公开电子本，字面上差在哪。"
差异不等于我们错——对方是 zhouyi.cc 系的转录，本身也有错字。
这个脚本的产出是**待人工判断的清单**，不是判定结果。

用法:
    python tools/diff_corpus.py <外部 yijing.json> [--out data/corpus.diff.md]
"""

from __future__ import annotations

import argparse
import difflib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OURS = ROOT / "data" / "corpus.txt"

# 比对时忽略的标点与空白
PUNCT = set("，。；：、！？·「」『』《》〈〉（）()【】[]{}…—－~·,.;:!?\"'“”‘’<> \t\r\n")

# 爻题前缀，如 "初九：" "六二："
YAO_PREFIX = (
    "初九", "初六", "九二", "六二", "九三", "六三",
    "九四", "六四", "九五", "六五", "上九", "上六",
)


def norm(s: str) -> str:
    return "".join(ch for ch in s if ch not in PUNCT)


def strip_guaci_prefix(text: str, name: str, accept: set[str]) -> str:
    """去掉 `乾：` `讼：` `遁：` 这类卦名前缀。"""
    t = text.strip()
    for sep in ("：", ":"):
        head, s, tail = t.partition(sep)
        h = head.strip()
        if s and (h == name or h == name + "卦" or h in accept):
            return tail.strip()
    return t


def strip_yao_prefix(text: str) -> str:
    t = text.strip()
    for p in YAO_PREFIX:
        if t.startswith(p):
            rest = t[len(p):].lstrip("：: ")
            return rest
    return t


def load_ours() -> dict[str, dict]:
    out = {}
    for raw in OURS.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        f = [x.strip() for x in line.split("|")]
        out[f[0]] = {"c": f[1], "y": f[2:8], "u": f[8] if len(f) > 8 else None}
    return out


def load_theirs(path: pathlib.Path, accept: set[str]) -> dict[str, dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    # 对方用「遁」，我们用「遯」，其余异体先归一再比
    ALIAS = {"遁": "遯", "无妄": "无妄"}
    out = {}
    for h in data["hexagrams"]:
        name = h["name"].removesuffix("卦")
        name = ALIAS.get(name, name)
        canon = h.get("canon") or {}
        guaci = (canon.get("guaci") or [""])[0]
        lines = canon.get("lines") or []
        yao = []
        for ln in lines[:6]:
            yao.append(strip_yao_prefix(ln.get("text", "")))
        out[name] = {
            "c": strip_guaci_prefix(guaci, name, accept),
            "y": yao,
            "n": len(lines),
        }
    return out


def char_diff(a: str, b: str) -> str:
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    parts = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            parts.append(a[i1:i2])
        elif tag == "replace":
            parts.append(f"[{a[i1:i2]}→{b[j1:j2]}]")
        elif tag == "delete":
            parts.append(f"[-{a[i1:i2]}]")
        elif tag == "insert":
            parts.append(f"[+{b[j1:j2]}]")
    return "".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("external", type=pathlib.Path)
    ap.add_argument("--out", default="data/corpus.diff.md")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ours = load_ours()
    theirs = load_theirs(args.external, set(ours) | {"遁"})

    same = punct_only = 0
    substantive = []   # (卦, 字段, 我们, 对方)
    missing = []

    for name, o in ours.items():
        t = theirs.get(name)
        if not t:
            missing.append(name)
            continue

        pairs = [("卦辞", o["c"], t["c"])]
        for i in range(6):
            pairs.append((f"第{i+1}爻", o["y"][i], t["y"][i] if i < len(t["y"]) else ""))

        for field, a, b in pairs:
            if a == b:
                same += 1
            elif norm(a) == norm(b):
                punct_only += 1
            else:
                substantive.append((name, field, a, b))

    lines = []
    lines.append("# 辞库比对报告\n")
    lines.append("> **这不是校勘。** 这是与一份第三方电子转录（zhouyi.cc 系）的逐字比对。")
    lines.append("> 差异不等于我们错：对方也有错字，且两边的句读体例不同。")
    lines.append("> 本报告只提供待人工判断的清单。\n")
    lines.append("## 汇总\n")
    total = same + punct_only + len(substantive)
    lines.append(f"| 项 | 数量 |\n|---|---|")
    lines.append(f"| 比对条目 | {total} |")
    lines.append(f"| 完全一致 | {same} |")
    lines.append(f"| 仅标点不同 | {punct_only} |")
    lines.append(f"| **实质差异** | **{len(substantive)}** |")
    lines.append(f"| 对方缺失的卦 | {len(missing)} |")
    lines.append("")
    if missing:
        lines.append("缺失：" + " ".join(missing) + "\n")

    lines.append("## 实质差异\n")
    lines.append("格式：`[我们→对方]`。两边都没被判定为对，需人工核纸本。\n")

    by_gua: dict[str, list] = {}
    for name, field, a, b in substantive:
        by_gua.setdefault(name, []).append((field, a, b))

    for name, items in by_gua.items():
        lines.append(f"### {name}\n")
        lines.append("| 字段 | 我们 | 对方 | 差异 |")
        lines.append("|---|---|---|---|")
        for field, a, b in items:
            lines.append(f"| {field} | {a} | {b} | `{char_diff(a, b)}` |")
        lines.append("")

    out = ROOT / args.out
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    print(f"比对 {total} 条")
    print(f"  一致       {same}")
    print(f"  仅标点不同 {punct_only}")
    print(f"  实质差异   {len(substantive)}   （涉及 {len(by_gua)} 卦）")
    print(f"  对方缺失   {len(missing)}")
    print(f"报告 → {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
