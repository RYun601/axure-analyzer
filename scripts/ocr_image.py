#!/usr/bin/env python3
"""
ocr_image.py

Local OCR for image-based Axure prototypes. Uses RapidOCR (ONNX Runtime),
so it works offline after the Python dependencies are installed.

Install:
    python -m pip install rapidocr_onnxruntime

Usage:
    python ocr_image.py <image> [--min-score 0.45] [--json-output out.json]

Output:
    Markdown table of OCR lines (stdout), grouped by vertical position.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"[ocr_image] {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument("image", help="Image path")
    parser.add_argument("--min-score", type=float, default=0.45, help="Drop items below this score")
    parser.add_argument("--json-output", default="", help="Optional raw JSON output path")
    parser.add_argument("--y-tolerance", type=float, default=14.0, help="Line grouping tolerance in pixels")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        fail(f"image not found: {image_path}")

    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception as exc:
        fail(
            "rapidocr_onnxruntime is not installed. "
            "Run: python -m pip install rapidocr_onnxruntime "
            f"(details: {exc})"
        )

    try:
        engine = RapidOCR()
        result, _ = engine(str(image_path))
    except Exception as exc:
        fail(f"OCR failed: {exc}")

    items = []
    for row in result or []:
        try:
            box, text, score = row
            score = float(score)
        except Exception:
            continue
        if not text or str(text).strip() == "":
            continue
        if score < args.min_score:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        items.append({
            "x1": round(min(xs), 1),
            "y1": round(min(ys), 1),
            "x2": round(max(xs), 1),
            "y2": round(max(ys), 1),
            "cx": round((min(xs) + max(xs)) / 2, 1),
            "cy": round((min(ys) + max(ys)) / 2, 1),
            "text": str(text).strip(),
            "score": round(score, 3),
        })

    items.sort(key=lambda it: (it["cy"], it["cx"]))

    lines = []
    for item in items:
        placed = False
        for line in lines:
            if abs(line["cy"] - item["cy"]) <= args.y_tolerance:
                line["items"].append(item)
                line["cy"] = sum(i["cy"] for i in line["items"]) / len(line["items"])
                placed = True
                break
        if not placed:
            lines.append({"cy": item["cy"], "items": [item]})

    lines.sort(key=lambda line: line["cy"])
    for line in lines:
        line["items"].sort(key=lambda it: it["cx"])

    if args.json_output:
        Path(args.json_output).write_text(
            json.dumps({"image": str(image_path), "items": items, "lines": lines}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    print(f"- 图片：`{image_path}`")
    print(f"- 识别行数：{len(lines)} / 文本块：{len(items)}")
    print("")
    print("| y | 文字 | 最低置信度 |")
    print("| ---: | --- | ---: |")
    for line in lines:
        text = "  ".join(i["text"] for i in line["items"])
        min_score = min(i["score"] for i in line["items"])
        print(f"| {round(line['cy'])} | {text.replace('|', '\\|')} | {min_score:.2f} |")


if __name__ == "__main__":
    main()
