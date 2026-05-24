from __future__ import annotations

import html
import pandas as pd


DEFAULT_INTERPRETATION = """- Hybrid_upper_ratio 最高的樣品，代表相對於 O 2p 主導的上價帶，其中價帶貢獻較強。
- 這可能反映較強的 Ga-O hybridized states、局部配位無序，或較寬的 Ga-O 鍵結分布。
- 擬合得到的 Ga_tet/Ga_oct 光譜貢獻應解讀為相對光譜權重，不是絕對原子比例。"""


def build_markdown(summary: pd.DataFrame, interpretation: str) -> str:
    table = summary.to_markdown(index=False) if not summary.empty else "沒有摘要結果。"
    return f"""# 價帶 DFT-informed 分析報告

## 摘要表

{table}

## 結果解讀

{interpretation}

## 注意事項

此工具不執行 DFT 第一原理計算。pDOS 擬合係數是相對光譜貢獻，不是直接的 tetrahedral/octahedral Ga 比例。
實驗價帶強度會受到光電離截面、光子能量、展寬、表面敏感性、無序、校正與背景影響。
"""


def build_html(summary: pd.DataFrame, interpretation: str) -> str:
    table = summary.to_html(index=False, classes="summary", border=0) if not summary.empty else "<p>沒有摘要結果。</p>"
    paragraphs = "<br>".join(html.escape(line) for line in interpretation.splitlines())
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>價帶 DFT-informed 分析報告</title>
<style>body{{font-family:Arial,sans-serif;margin:32px;color:#111827}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #d1d5db;padding:6px 8px}}th{{background:#f3f4f6}}</style>
</head><body><h1>價帶 DFT-informed 分析報告</h1><h2>摘要表</h2>{table}<h2>結果解讀</h2><p>{paragraphs}</p><h2>注意事項</h2><p>此工具不執行 DFT。擬合係數僅代表相對光譜貢獻。</p></body></html>"""
