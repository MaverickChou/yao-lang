#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/corpus.txt 编译成 data/corpus.json，顺带做结构校验。

校验项：
  - 恰好 64 卦，卦名与 data/hexagrams.json 完全一致
  - 每卦 8 个字段（乾坤 9 个，末尾是用九/用六）
  - 字段非空、无前后空白
  - 爻辞不重复（防止复制粘贴串行）

用法:
    python tools/build_corpus.py            # 生成
    python tools/build_corpus.py --check    # 只校验
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "corpus.txt"
OUT = ROOT / "data" / "corpus.json"
HEX = ROOT / "data" / "hexagrams.json"
VER = ROOT / "data" / "corpus.verified.txt"

USE_LINES = {"乾": "用九", "坤": "用六"}


def read_verified(entries: dict[str, dict]) -> list[str]:
    """读已校对清单。每行一个键：`卦名.c` / `卦名.1..6` / `卦名.u`。"""
    if not VER.exists():
        return []

    keys, problems = [], []
    for lineno, raw in enumerate(VER.read_text(encoding="utf-8-sig").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        name, _, field = line.partition(".")
        if not field:
            problems.append(f"第 {lineno} 行缺少 `.字段`：{line}")
            continue
        if name not in entries:
            problems.append(f"第 {lineno} 行未知卦名：{name}")
            continue
        if field == "c":
            pass
        elif field == "u":
            if name not in USE_LINES:
                problems.append(f"第 {lineno} 行：只有乾坤有 `.u`")
                continue
        elif field.isdigit() and 1 <= int(field) <= 6:
            pass
        else:
            problems.append(f"第 {lineno} 行字段非法：{field}")
            continue

        key = f"{name}.{field}"
        if key in keys:
            problems.append(f"第 {lineno} 行重复：{key}")
            continue
        keys.append(key)

    if problems:
        raise SystemExit("✗ corpus.verified.txt 有问题：\n  - " + "\n  - ".join(problems))
    return keys


def parse(text: str) -> list[list[str]]:
    rows = []
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fields = [f.strip() for f in line.split("|")]
        if any(not f for f in fields):
            raise SystemExit(f"第 {lineno} 行有空字段：{line[:40]}…")
        rows.append(fields)
    return rows


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    hexagrams = json.loads(HEX.read_text(encoding="utf-8"))["hexagrams"]
    names = [h["name"] for h in hexagrams]

    rows = parse(SRC.read_text(encoding="utf-8-sig"))

    errors = []
    if len(rows) != 64:
        errors.append(f"应恰好 64 卦，实际 {len(rows)} 卦")

    entries = {}
    for fields in rows:
        name = fields[0]
        if name not in names:
            errors.append(f"未知卦名：{name}")
            continue
        if name in entries:
            errors.append(f"卦名重复：{name}")
            continue

        want = 9 if name in USE_LINES else 8
        if len(fields) != want:
            errors.append(f"{name}：字段数应为 {want}，实际 {len(fields)}")
            continue

        entry = {"c": fields[1], "y": fields[2:8]}
        if len(fields) == 9:
            entry["u"] = fields[8]
            entry["ul"] = USE_LINES[name]
        entries[name] = entry

    missing = [n for n in names if n not in entries]
    if missing:
        errors.append("缺少卦：" + " ".join(missing))

    # 爻辞不应重复（同一卦内）
    for name, e in entries.items():
        if len(set(e["y"])) != 6:
            errors.append(f"{name}：六爻爻辞有重复")

    if errors:
        print("✗ 校验失败")
        for e in errors:
            print("  - " + e)
        return 1

    verified = read_verified(entries)
    total_keys = sum(1 + len(e["y"]) + (1 if "u" in e else 0) for e in entries.values())

    payload = {
        "source": "通行本（王弼注本系统），简体字",
        "status": "draft" if len(verified) < total_keys else "verified",
        "note": "未出现在 verified 里的条目尚未逐字校对。校对流程见 data/corpus.NOTES.md。",
        "verified": verified,
        "entries": {n: entries[n] for n in names},  # 按文王序
    }

    total = total_keys

    if "--check" in sys.argv:
        print(f"✓ 校验通过：64 卦 / {total} 条辞，已校对 {len(verified)} 条（未写文件）")
        return 0

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"✓ 64 卦 / {total} 条辞 → {OUT.relative_to(ROOT)}")
    print(f"  已校对 {len(verified)} / {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
