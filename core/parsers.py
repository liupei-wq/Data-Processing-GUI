"""Shared parsers for text-based spectroscopy data files."""

from __future__ import annotations

import io

import numpy as np
import pandas as pd


def is_numeric_line(line: str) -> bool:
    """Return True if every whitespace/comma-separated token in line is a float."""
    parts = line.strip().replace(",", " ").split()
    if not parts:
        return False
    try:
        for part in parts:
            float(part)
        return True
    except ValueError:
        return False


def parse_two_column_spectrum_bytes(
    raw: bytes,
    encodings=("utf-8", "utf-8-sig", "big5", "cp950", "latin-1", "utf-16"),
):
    for enc in encodings:
        try:
            content = raw.decode(enc)
        except UnicodeDecodeError:
            continue

        all_lines = content.splitlines()

        data_lines = []
        in_data = False
        for line in all_lines:
            if is_numeric_line(line):
                in_data = True
                data_lines.append(line.strip())
            elif in_data:
                break

        if len(data_lines) >= 2:
            clean = "\n".join(data_lines)
            for sep in ("\t", r"\s+", ","):
                try:
                    df = pd.read_csv(
                        io.StringIO(clean),
                        sep=sep,
                        header=None,
                        engine="python",
                        on_bad_lines="skip",
                    )
                    num_df = df.apply(pd.to_numeric, errors="coerce")
                    valid = [col for col in num_df.columns if num_df[col].notna().mean() > 0.8]
                    if len(valid) < 2:
                        continue
                    if len(valid) >= 3:
                        col0 = num_df[valid[0]].dropna()
                        diffs = col0.diff().dropna().abs()
                        if diffs.mean() > 0 and diffs.std() / diffs.mean() < 0.05:
                            x = num_df[valid[1]].dropna().to_numpy()
                            y = num_df[valid[2]].dropna().to_numpy()
                        else:
                            x = num_df[valid[0]].dropna().to_numpy()
                            y = num_df[valid[1]].dropna().to_numpy()
                    else:
                        x = num_df[valid[0]].dropna().to_numpy()
                        y = num_df[valid[1]].dropna().to_numpy()
                    n = min(len(x), len(y))
                    if n >= 2:
                        x, y = x[:n], y[:n]
                        idx = np.argsort(x)
                        return x[idx], y[idx], None
                except Exception:
                    continue

        lines = [
            line for line in all_lines
            if line.strip() and line.strip()[0] not in ("#", "%", ";", "!")
        ]
        if not lines:
            continue
        clean = "\n".join(lines)
        for sep in (",", "\t", r"\s+"):
            for hdr in (0, None):
                try:
                    df = pd.read_csv(
                        io.StringIO(clean),
                        sep=sep,
                        header=hdr,
                        engine="python",
                        on_bad_lines="skip",
                    )
                    num_df = df.apply(pd.to_numeric, errors="coerce")
                    valid = [col for col in num_df.columns if num_df[col].notna().mean() > 0.8]
                    if len(valid) >= 2:
                        x = num_df[valid[0]].dropna().to_numpy()
                        y = num_df[valid[1]].dropna().to_numpy()
                        n = min(len(x), len(y))
                        if n >= 2:
                            x, y = x[:n], y[:n]
                            idx = np.argsort(x)
                            return x[idx], y[idx], None
                except Exception:
                    continue

    return None, None, "無法解析：請確認為兩欄數字格式（X, Y）"


def parse_structured_xps(content_str: str):
    lines = content_str.splitlines()
    x_vals, y_vals = [], []
    mode = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if "Dimension 1 scale=" in line:
            vals = line.split("=", 1)[1].split()
            x_vals.extend([float(v) for v in vals])
            mode = "X"
            continue
        if "[Data 1]" in line or "Data=" in line:
            if "Data=" in line:
                vals = line.split("=", 1)[1].split()
                y_vals.extend([float(v) for v in vals])
            mode = "Y"
            continue
        if line.startswith("[") and mode is not None:
            if mode == "Y":
                break
            mode = None
            continue
        if mode == "X":
            vals = line.split()
            x_vals.extend([
                float(v) for v in vals
                if v.replace(".", "", 1).replace("E", "", 1)
                    .replace("+", "", 1).replace("-", "", 1).isdigit()
            ])
        elif mode == "Y":
            vals = line.split()
            if len(vals) >= 2:
                y_vals.append(float(vals[1]))
            elif len(vals) == 1:
                y_vals.append(float(vals[0]))

    x, y = np.array(x_vals), np.array(y_vals)
    if len(x) > 0 and len(y) > 0:
        min_len = min(len(x), len(y))
        x, y = x[:min_len], y[:min_len]
        idx = np.argsort(x)
        return x[idx], y[idx]
    raise ValueError("解析失敗：找不到 XPS 數據區塊")


def parse_xps_bytes(raw: bytes):
    for enc in ("utf-8", "big5", "cp950", "latin-1", "utf-16"):
        try:
            content_str = raw.decode(enc)
            # 先嘗試標準 CSV（兩欄數字，首行可為標頭）
            df = pd.read_csv(io.StringIO(content_str))
            if df.shape[1] >= 2:
                x = df.iloc[:, 0].to_numpy(dtype=float)
                y = df.iloc[:, 1].to_numpy(dtype=float)
                if len(x) >= 2:
                    idx = np.argsort(x)
                    return x[idx], y[idx], None
        except UnicodeDecodeError:
            continue
        except Exception:
            pass

        try:
            content_str = raw.decode(enc)
            x, y = parse_structured_xps(content_str)
            return x, y, None
        except UnicodeDecodeError:
            continue
        except Exception as e:
            return None, None, str(e)
    return None, None, "無法辨識編碼"
