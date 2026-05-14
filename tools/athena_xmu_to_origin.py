# -*- coding: utf-8 -*-
"""
athena_xmu_to_origin.py

功能：
1. 從 DATA_FOLDER 自動掃描 Athena 匯出的 .xmu 檔，支援子資料夾
2. 每個子資料夾視為一個樣品，子資料夾內 .xmu 視為重複量測
3. 解析 Athena header 中的 E0 與 edge_step
4. 計算：
   Normalized_mu = (xmu - pre_edge) / edge_step
   Flattened_mu = Normalized_mu - ((post_edge - pre_edge) / edge_step) + 1
5. 同一子資料夾內兩筆 scan 先對齊 energy、去除不一致尖峰、補值後平均
6. 將每一筆原始 scan 與每個樣品平均結果匯入 OriginPro worksheet
7. 建立 averaged normalized 與 averaged flattened 疊圖
8. 另存 Origin project

使用方式：
1. 先安裝 originpro：
   python -m pip install originpro

2. 修改下方 DATA_FOLDER 和 OUTPUT_OPJU

3. 在 VS Code 執行：
   python athena_xmu_to_origin.py
"""

import os
import re
import sys
import traceback
from datetime import datetime

try:
    import originpro as op
except ImportError:
    raise ImportError(
        "找不到 originpro package。\n"
        "請先在 VS Code terminal 執行：\n"
        "python -m pip install originpro"
    )


# ============================================================
# 1. 使用者設定區：請改這裡
# ============================================================

# 放 Athena .xmu 檔案的資料夾
DATA_FOLDER = r"C:\Users\User\OneDrive\Desktop\Data\XAS\Ga-k-edge"

# 所有輸出檔案集中放在這個資料夾
OUTPUT_FOLDER = r"C:\Users\User\OneDrive\Desktop\Data\XAS\Origin_Output"

# 輸出的 Origin project
OUTPUT_OPJU = os.path.join(OUTPUT_FOLDER, "Athena_XMU_processed.opju")

# 是否顯示 Origin 視窗
SHOW_ORIGIN = True

# 程式跑完後是否保留 Origin 開啟
KEEP_ORIGIN_OPEN = True

# 是否每個原始 scan 都單獨畫一張圖
MAKE_INDIVIDUAL_GRAPHS = True

# 是否建立所有樣品 averaged normalized 疊圖
MAKE_OVERLAY_NORMALIZED = True

# 是否建立所有樣品 averaged flattened 疊圖
MAKE_OVERLAY_FLATTENED = True


# ============================================================
# 子資料夾與平均處理設定
# ============================================================

RECURSIVE_SUBFOLDER_MODE = True

# 每個子資料夾視為一個樣品
GROUP_BY_SUBFOLDER = True

# 是否對同一子資料夾內的兩筆 scan 做去尖峰 + 內插 + 平均
AVERAGE_DUPLICATE_SCANS = True

# 判斷兩筆 scan 差異異常的強度，數值越小越容易刪點
SPIKE_DIFF_MAD_FACTOR = 4.5

# 判斷單一 scan 偏離局部中位數的強度
LOCAL_SPIKE_FACTOR = 2.5

# 用幾個點計算局部中位數，建議奇數
LOCAL_WINDOW = 31

# 峰段模式會自動沿著同一個差異峰延伸；這裡只保留額外安全 padding，預設 0
SPIKE_REMOVE_PADDING_POINTS = 0

# 峰段邊界門檻：峰心超過 MAD 門檻後，向左右延伸到低於此比例為止
PEAK_EDGE_THRESHOLD_RATIO = 0.35

# 太短的差異段容易是雜訊；1 表示單點尖峰也保留處理
MIN_PEAK_SEGMENT_POINTS = 1

# 子資料夾樣品在 overlay 圖中的固定顏色
SAMPLE_COLORS = {
    "40-10": "#1f77b4",
    "45-5": "#d62728",
    "50-0": "#2ca02c",
}

DEFAULT_SAMPLE_COLORS = [
    "#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e",
    "#17becf", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22",
]


# ============================================================
# 2. 外部 Python 連結 Origin 的保護設定
# ============================================================

def origin_exception_hook(exctype, value, tb):
    """
    如果程式發生錯誤，印出錯誤訊息。
    若不想讓 Origin 背景殘留，可在這裡 op.exit()。
    """
    print("\n程式執行時發生錯誤：")
    traceback.print_exception(exctype, value, tb)

    if op.oext and not KEEP_ORIGIN_OPEN:
        try:
            op.exit()
        except Exception:
            pass


if op.oext:
    sys.excepthook = origin_exception_hook
    op.set_show(SHOW_ORIGIN)


# ============================================================
# 3. Athena .xmu 讀取與解析
# ============================================================

def read_athena_xmu(file_path):
    """
    讀取 Athena .xmu 檔案。
    回傳：
    headers: 以 # 開頭的 header
    data: 數值資料，每列為 list[float]
    """
    headers = []
    data = []

    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()

            if not line:
                continue

            if line.startswith("#"):
                headers.append(line)
                continue

            parts = line.split()

            try:
                row = [float(x) for x in parts]
                data.append(row)
            except ValueError:
                continue

    if not data:
        raise ValueError(f"沒有讀到有效數據：{file_path}")

    return headers, data


def get_header_value(headers, key):
    """
    從 Athena header 抓數值，例如：
    Athena.e0
    Athena.edge_step
    """
    for h in headers:
        if key in h:
            nums = re.findall(r"[-+]?\d*\.\d+|[-+]?\d+", h)
            if nums:
                return float(nums[-1])
    return None


def process_xmu_file(file_path, sample_name=None):
    """
    將 Athena .xmu 資料轉成可匯入 Origin 的欄位。
    Athena .xmu 常見欄位：
    8 欄：energy, xmu, bkg, pre_edge, post_edge, der, sec, i0
    9 欄：energy, xmu, bkg, pre_edge, post_edge, der, sec, i0, chi(e)
    """
    headers, data = read_athena_xmu(file_path)

    e0 = get_header_value(headers, "Athena.e0")
    edge_step = get_header_value(headers, "Athena.edge_step")

    if edge_step is None:
        raise ValueError(
            f"找不到 Athena.edge_step：{file_path}\n"
            "請確認這是 Athena 輸出的 .xmu 檔案。"
        )

    if abs(edge_step) < 1e-30:
        raise ValueError(f"Athena.edge_step 為 0，無法正規化：{file_path}")

    result = {
        "file_path": file_path,
        "file_name": os.path.basename(file_path),
        "sample_name": sample_name or os.path.splitext(os.path.basename(file_path))[0],
        "e0": e0,
        "edge_step": edge_step,
        "energy": [],
        "xmu": [],
        "bkg": [],
        "pre_edge": [],
        "post_edge": [],
        "derivative": [],
        "second_derivative": [],
        "i0": [],
        "chi_e": [],
        "normalized_mu": [],
        "post_edge_norm": [],
        "flattened_mu": [],
        "energy_minus_e0": [],
    }

    for row in data:
        if len(row) < 8:
            continue

        energy = row[0]
        xmu = row[1]
        bkg = row[2]
        pre_edge = row[3]
        post_edge = row[4]
        derivative = row[5]
        second_derivative = row[6]
        i0 = row[7]
        chi_e = row[8] if len(row) >= 9 else 0.0

        normalized_mu = (xmu - pre_edge) / edge_step
        post_edge_norm = (post_edge - pre_edge) / edge_step
        flattened_mu = normalized_mu - post_edge_norm + 1
        energy_minus_e0 = energy - e0 if e0 is not None else 0

        result["energy"].append(energy)
        result["xmu"].append(xmu)
        result["bkg"].append(bkg)
        result["pre_edge"].append(pre_edge)
        result["post_edge"].append(post_edge)
        result["derivative"].append(derivative)
        result["second_derivative"].append(second_derivative)
        result["i0"].append(i0)
        result["chi_e"].append(chi_e)
        result["normalized_mu"].append(normalized_mu)
        result["post_edge_norm"].append(post_edge_norm)
        result["flattened_mu"].append(flattened_mu)
        result["energy_minus_e0"].append(energy_minus_e0)

    if not result["energy"]:
        raise ValueError(f"沒有讀到至少 8 欄格式的 Athena .xmu 數據：{file_path}")

    return result


# ============================================================
# 4. Robust 去尖峰、內插、平均
# ============================================================

def median(values):
    vals = sorted([v for v in values if v is not None])
    n = len(vals)
    if n == 0:
        return None
    if n % 2 == 1:
        return vals[n // 2]
    return 0.5 * (vals[n // 2 - 1] + vals[n // 2])


def mad(values):
    """
    Median Absolute Deviation.
    用來做 robust outlier detection。
    """
    vals = [v for v in values if v is not None]
    med = median(vals)
    if med is None:
        return None
    deviations = [abs(v - med) for v in vals]
    return median(deviations)


def local_median(y, i, window=7):
    """
    計算第 i 點附近的局部中位數。
    不包含第 i 點本身。
    """
    half = window // 2
    start = max(0, i - half)
    end = min(len(y), i + half + 1)

    vals = []
    for j in range(start, end):
        if j != i and y[j] is not None:
            vals.append(y[j])

    return median(vals)


def interpolate_none(x, y):
    """
    對 y 中的 None 做線性內插。
    若 None 在開頭或結尾，使用最近的有效值補。
    """
    y_new = y[:]
    n = len(y_new)

    valid_indices = [i for i, v in enumerate(y_new) if v is not None]

    if not valid_indices:
        raise ValueError("整條曲線都是 None，無法內插。")

    first_valid = valid_indices[0]
    last_valid = valid_indices[-1]

    for i in range(0, first_valid):
        y_new[i] = y_new[first_valid]

    for i in range(last_valid + 1, n):
        y_new[i] = y_new[last_valid]

    i = first_valid
    while i <= last_valid:
        if y_new[i] is not None:
            i += 1
            continue

        left = i - 1
        right = i

        while right < n and y_new[right] is None:
            right += 1

        if right >= n:
            break

        x_left = x[left]
        x_right = x[right]
        y_left = y_new[left]
        y_right = y_new[right]

        for k in range(left + 1, right):
            if x_right == x_left:
                y_new[k] = y_left
            else:
                ratio = (x[k] - x_left) / (x_right - x_left)
                y_new[k] = y_left + ratio * (y_right - y_left)

        i = right

    return y_new


def interpolate_to_grid(x_old, y_old, x_new):
    """
    將一組資料內插到新的 energy grid。
    """
    result = []
    j = 0
    n = len(x_old)

    if n < 2:
        raise ValueError("資料點太少，無法內插。")

    for x in x_new:
        while j < n - 2 and x_old[j + 1] < x:
            j += 1

        if x <= x_old[0]:
            result.append(y_old[0])
        elif x >= x_old[-1]:
            result.append(y_old[-1])
        else:
            x1 = x_old[j]
            x2 = x_old[j + 1]
            y1 = y_old[j]
            y2 = y_old[j + 1]

            if x2 == x1:
                result.append(y1)
            else:
                ratio = (x - x1) / (x2 - x1)
                result.append(y1 + ratio * (y2 - y1))

    return result


def despike_two_scans(x, y1, y2, diff_mad_factor=8.0, local_factor=6.0, window=7):
    """
    比較同一子資料夾內的兩筆重複量測。

    這版不是逐點刪除，而是把 y1-y2 的差異視為一條曲線：
    1. 找出差異超過 robust MAD 門檻的峰心。
    2. 沿著同一個正/負差異峰向左右延伸到峰腳。
    3. 以整個峰段的 signed area 判斷是哪一筆 scan 多出訊號。
    4. 將該 scan 的整段設為 None，再線性內插補回。

    回傳：
    y1_clean, y2_clean, removed_from_1, removed_from_2
    """
    if len(y1) != len(y2):
        raise ValueError("y1 和 y2 長度不同，請先內插到共同 energy grid。")

    n = len(y1)
    diff = [y1[i] - y2[i] for i in range(n)]
    diff_med = median(diff)
    diff_mad = mad(diff)

    if diff_med is None:
        diff_med = 0.0
    if diff_mad is None or diff_mad == 0:
        diff_mad = 1e-12

    robust_sigma = 1.4826 * diff_mad
    core_threshold = diff_mad_factor * robust_sigma
    edge_threshold = PEAK_EDGE_THRESHOLD_RATIO * core_threshold
    centered_diff = [d - diff_med for d in diff]

    removed_from_1 = [0] * n
    removed_from_2 = [0] * n
    visited = [0] * n
    segments = []

    for i in range(n):
        if visited[i] or abs(centered_diff[i]) <= core_threshold:
            continue

        sign = 1 if centered_diff[i] > 0 else -1
        start = i
        end = i

        while start > 0 and centered_diff[start - 1] * sign > edge_threshold:
            start -= 1

        while end < n - 1 and centered_diff[end + 1] * sign > edge_threshold:
            end += 1

        for j in range(start, end + 1):
            visited[j] = 1

        if end - start + 1 >= MIN_PEAK_SEGMENT_POINTS:
            segments.append((start, end, sign))

    # 合併重疊或相鄰且同方向的峰段，避免一個寬峰被切成多段。
    merged_segments = []
    for start, end, sign in segments:
        if merged_segments and sign == merged_segments[-1][2] and start <= merged_segments[-1][1] + 1:
            old_start, old_end, old_sign = merged_segments[-1]
            merged_segments[-1] = (old_start, max(old_end, end), old_sign)
        else:
            merged_segments.append((start, end, sign))

    for start, end, sign in merged_segments:
        signed_area = sum(centered_diff[start:end + 1])

        # signed_area > 0 表示 scan1 在這整段比 scan2 高，視為 scan1 多出的峰。
        if signed_area > 0:
            for j in range(start, end + 1):
                removed_from_1[j] = 1
        elif signed_area < 0:
            for j in range(start, end + 1):
                removed_from_2[j] = 1

    removed_from_1 = expand_removed_mask(removed_from_1, SPIKE_REMOVE_PADDING_POINTS)
    removed_from_2 = expand_removed_mask(removed_from_2, SPIKE_REMOVE_PADDING_POINTS)

    y1_clean = y1[:]
    y2_clean = y2[:]

    for i, flag in enumerate(removed_from_1):
        if flag:
            y1_clean[i] = None

    for i, flag in enumerate(removed_from_2):
        if flag:
            y2_clean[i] = None

    y1_clean = interpolate_none(x, y1_clean)
    y2_clean = interpolate_none(x, y2_clean)

    return y1_clean, y2_clean, removed_from_1, removed_from_2

def average_two_clean_scans(y1_clean, y2_clean):
    return [(a + b) / 2 for a, b in zip(y1_clean, y2_clean)]


def expand_removed_mask(mask, padding):
    """
    將已判定的跳點向左右擴張幾個點。
    這可以避免只刪掉峰頂，留下多餘峰的肩部。
    """
    if padding <= 0:
        return mask[:]

    expanded = mask[:]
    n = len(mask)
    for i, flag in enumerate(mask):
        if not flag:
            continue
        start = max(0, i - padding)
        end = min(n, i + padding + 1)
        for j in range(start, end):
            expanded[j] = 1

    return expanded


def get_sample_color(sample_name, index=0):
    if sample_name in SAMPLE_COLORS:
        return SAMPLE_COLORS[sample_name]

    for key, color in SAMPLE_COLORS.items():
        if sample_name.startswith(key):
            return color

    return DEFAULT_SAMPLE_COLORS[index % len(DEFAULT_SAMPLE_COLORS)]


def find_xmu_files_by_subfolder(data_folder):
    """
    掃描 DATA_FOLDER 底下所有子資料夾。
    回傳：
    {
        "40-10": ["...scan1.xmu", "...scan2.xmu"],
        "45-5": ["...scan1.xmu", "...scan2.xmu"]
    }
    """
    groups = {}

    if RECURSIVE_SUBFOLDER_MODE:
        walker = os.walk(data_folder)
    else:
        walker = [(data_folder, [], os.listdir(data_folder))]

    for root, dirs, files in walker:
        xmu_files = [
            os.path.join(root, f)
            for f in files
            if f.lower().endswith(".xmu")
        ]

        if not xmu_files:
            continue

        if GROUP_BY_SUBFOLDER:
            if root == data_folder:
                sample_name = "Root_Folder"
            else:
                sample_name = os.path.basename(root)
        else:
            sample_name = "All_XMU"

        if sample_name not in groups:
            groups[sample_name] = []
        groups[sample_name].extend(sorted(xmu_files))

    return groups


def build_common_energy_grid(results):
    """
    results 是兩筆 process_xmu_file() 的結果。
    取共同能量範圍，並使用點數較多的那一筆當 reference grid。
    """
    e_min = max(min(r["energy"]) for r in results)
    e_max = min(max(r["energy"]) for r in results)

    ref = max(results, key=lambda r: len(r["energy"]))
    grid = [e for e in ref["energy"] if e_min <= e <= e_max]

    if len(grid) < 10:
        raise ValueError("共同 energy grid 點數太少，無法平均。")

    return grid


def apply_removal_masks_to_scans(x, y1, y2, removed_from_1, removed_from_2):
    """
    使用同一組去尖峰位置處理另一條曲線。
    這裡 normalized_mu 先決定哪個 energy 點屬於異常，
    flattened_mu 使用相同位置，避免兩種輸出出現不一致的刪點位置。
    """
    y1_masked = y1[:]
    y2_masked = y2[:]

    for i, flag in enumerate(removed_from_1):
        if flag:
            y1_masked[i] = None

    for i, flag in enumerate(removed_from_2):
        if flag:
            y2_masked[i] = None

    return interpolate_none(x, y1_masked), interpolate_none(x, y2_masked)


def make_averaged_result_from_two_scans(sample_name, result1, result2):
    """
    對同一子資料夾內兩筆 Athena .xmu 做：
    energy 對齊 -> 去除不一致尖峰 -> 內插 -> 平均。
    """
    common_energy = build_common_energy_grid([result1, result2])

    norm1 = interpolate_to_grid(result1["energy"], result1["normalized_mu"], common_energy)
    norm2 = interpolate_to_grid(result2["energy"], result2["normalized_mu"], common_energy)

    norm1_clean, norm2_clean, removed_norm_1, removed_norm_2 = despike_two_scans(
        common_energy,
        norm1,
        norm2,
        diff_mad_factor=SPIKE_DIFF_MAD_FACTOR,
        local_factor=LOCAL_SPIKE_FACTOR,
        window=LOCAL_WINDOW,
    )

    avg_norm = average_two_clean_scans(norm1_clean, norm2_clean)

    flat1 = interpolate_to_grid(result1["energy"], result1["flattened_mu"], common_energy)
    flat2 = interpolate_to_grid(result2["energy"], result2["flattened_mu"], common_energy)

    # 去尖峰位置只由同一子資料夾內兩筆 normalized_mu 互相比對決定，
    # flattened_mu 套用同一組位置，避免兩種曲線刪點位置不同。
    flat1_clean, flat2_clean = apply_removal_masks_to_scans(
        common_energy,
        flat1,
        flat2,
        removed_norm_1,
        removed_norm_2,
    )
    removed_flat_1 = removed_norm_1[:]
    removed_flat_2 = removed_norm_2[:]

    avg_flat = average_two_clean_scans(flat1_clean, flat2_clean)

    averaged_result = {
        "sample_name": sample_name + "_average",
        "source_scan1": result1["file_name"],
        "source_scan2": result2["file_name"],
        "energy": common_energy,
        "scan1_normalized_clean": norm1_clean,
        "scan2_normalized_clean": norm2_clean,
        "average_normalized": avg_norm,
        "scan1_flattened_clean": flat1_clean,
        "scan2_flattened_clean": flat2_clean,
        "average_flattened": avg_flat,
        "removed_from_scan1_norm": removed_norm_1,
        "removed_from_scan2_norm": removed_norm_2,
        "removed_from_scan1_flat": removed_flat_1,
        "removed_from_scan2_flat": removed_flat_2,
    }

    return averaged_result


# ============================================================
# 5. 匯入 Origin worksheet
# ============================================================

def safe_origin_name(name, max_len=25):
    """
    Origin 內部短名稱避免特殊符號與過長。
    """
    clean = re.sub(r"[^A-Za-z0-9_]", "_", name)
    if not clean:
        clean = "XMU_Data"
    return clean[:max_len]


def csv_escape(value):
    if value is None:
        return ""
    text = str(value)
    if any(ch in text for ch in [",", "\"", "\n", "\r"]):
        return "\"" + text.replace("\"", "\"\"") + "\""
    return text


def write_csv(file_path, headers, rows):
    with open(file_path, "w", encoding="utf-8-sig", newline="") as f:
        f.write(",".join(csv_escape(h) for h in headers) + "\n")
        for row in rows:
            f.write(",".join(csv_escape(v) for v in row) + "\n")


def export_raw_result_csv(result, output_folder):
    file_name = safe_origin_name(result["sample_name"], max_len=80) + ".csv"
    file_path = os.path.join(output_folder, file_name)
    headers = [
        "Energy", "xmu", "bkg", "pre_edge", "post_edge", "derivative",
        "second_derivative", "i0", "chi_e", "Normalized_mu",
        "Post_edge_norm", "Flattened_mu", "Energy_minus_E0",
    ]
    rows = []
    for i in range(len(result["energy"])):
        rows.append([
            result["energy"][i], result["xmu"][i], result["bkg"][i],
            result["pre_edge"][i], result["post_edge"][i], result["derivative"][i],
            result["second_derivative"][i], result["i0"][i], result["chi_e"][i],
            result["normalized_mu"][i], result["post_edge_norm"][i],
            result["flattened_mu"][i], result["energy_minus_e0"][i],
        ])
    write_csv(file_path, headers, rows)
    return file_path


def export_averaged_result_csv(avg_result, output_folder):
    file_name = safe_origin_name(avg_result["sample_name"], max_len=80) + ".csv"
    file_path = os.path.join(output_folder, file_name)
    headers = [
        "Energy", "Scan1_Normalized_clean", "Scan2_Normalized_clean",
        "Average_Normalized", "Scan1_Flattened_clean", "Scan2_Flattened_clean",
        "Average_Flattened", "Removed_from_scan1_norm", "Removed_from_scan2_norm",
        "Removed_from_scan1_flat", "Removed_from_scan2_flat",
    ]
    rows = []
    for i in range(len(avg_result["energy"])):
        rows.append([
            avg_result["energy"][i], avg_result["scan1_normalized_clean"][i],
            avg_result["scan2_normalized_clean"][i], avg_result["average_normalized"][i],
            avg_result["scan1_flattened_clean"][i], avg_result["scan2_flattened_clean"][i],
            avg_result["average_flattened"][i], avg_result["removed_from_scan1_norm"][i],
            avg_result["removed_from_scan2_norm"][i], avg_result["removed_from_scan1_flat"][i],
            avg_result["removed_from_scan2_flat"][i],
        ])
    write_csv(file_path, headers, rows)
    return file_path


def import_result_to_origin(result):
    """
    將單一 .xmu 處理結果匯入 Origin worksheet。
    """
    sample_name = result["sample_name"]
    worksheet_name = safe_origin_name(sample_name)

    wks = op.new_sheet("w", lname=sample_name)
    wks.cols = 13

    wks.from_list(0, result["energy"], lname="Energy", units="eV", axis="X")
    wks.from_list(1, result["xmu"], lname="xmu", units="a.u.", axis="Y")
    wks.from_list(2, result["bkg"], lname="bkg", units="a.u.", axis="Y")
    wks.from_list(3, result["pre_edge"], lname="pre_edge", units="a.u.", axis="Y")
    wks.from_list(4, result["post_edge"], lname="post_edge", units="a.u.", axis="Y")
    wks.from_list(5, result["derivative"], lname="derivative", units="a.u.", axis="Y")
    wks.from_list(6, result["second_derivative"], lname="second_derivative", units="a.u.", axis="Y")
    wks.from_list(7, result["i0"], lname="i0", units="counts", axis="Y")
    wks.from_list(8, result["chi_e"], lname="chi_e", units="a.u.", axis="Y")
    wks.from_list(9, result["normalized_mu"], lname="Normalized_mu", units="a.u.", axis="Y")
    wks.from_list(10, result["post_edge_norm"], lname="Post_edge_norm", units="a.u.", axis="Y")
    wks.from_list(11, result["flattened_mu"], lname="Flattened_mu", units="a.u.", axis="Y")
    wks.from_list(12, result["energy_minus_e0"], lname="Energy_minus_E0", units="eV", axis="X")

    comment = (
        f"Athena .xmu processed by external Python\n"
        f"File: {result['file_path']}\n"
        f"E0: {result['e0']}\n"
        f"edge_step: {result['edge_step']}\n"
        f"Normalized_mu = (xmu - pre_edge) / edge_step\n"
        f"Flattened_mu = Normalized_mu - ((post_edge - pre_edge) / edge_step) + 1"
    )

    try:
        wks.set_label(0, comment, "C")
    except Exception:
        pass

    return wks, worksheet_name


def import_averaged_result_to_origin(avg_result):
    sample_name = avg_result["sample_name"]

    wks = op.new_sheet("w", lname=sample_name)
    wks.cols = 11

    wks.from_list(0, avg_result["energy"], lname="Energy", units="eV", axis="X")

    wks.from_list(1, avg_result["scan1_normalized_clean"], lname="Scan1_Normalized_clean", units="a.u.", axis="Y")
    wks.from_list(2, avg_result["scan2_normalized_clean"], lname="Scan2_Normalized_clean", units="a.u.", axis="Y")
    wks.from_list(3, avg_result["average_normalized"], lname="Average_Normalized", units="a.u.", axis="Y")

    wks.from_list(4, avg_result["scan1_flattened_clean"], lname="Scan1_Flattened_clean", units="a.u.", axis="Y")
    wks.from_list(5, avg_result["scan2_flattened_clean"], lname="Scan2_Flattened_clean", units="a.u.", axis="Y")
    wks.from_list(6, avg_result["average_flattened"], lname="Average_Flattened", units="a.u.", axis="Y")

    wks.from_list(7, avg_result["removed_from_scan1_norm"], lname="Removed_from_scan1_norm", units="", axis="Y")
    wks.from_list(8, avg_result["removed_from_scan2_norm"], lname="Removed_from_scan2_norm", units="", axis="Y")
    wks.from_list(9, avg_result["removed_from_scan1_flat"], lname="Removed_from_scan1_flat", units="", axis="Y")
    wks.from_list(10, avg_result["removed_from_scan2_flat"], lname="Removed_from_scan2_flat", units="", axis="Y")

    comment = (
        "Averaged worksheet generated from duplicate Athena .xmu scans\n"
        f"Scan 1: {avg_result['source_scan1']}\n"
        f"Scan 2: {avg_result['source_scan2']}\n"
        f"SPIKE_DIFF_MAD_FACTOR: {SPIKE_DIFF_MAD_FACTOR}\n"
        f"LOCAL_SPIKE_FACTOR: {LOCAL_SPIKE_FACTOR}\n"
        f"LOCAL_WINDOW: {LOCAL_WINDOW}"
    )

    try:
        wks.set_label(0, comment, "C")
    except Exception:
        pass

    return wks


# ============================================================
# 6. Origin 畫圖
# ============================================================

def make_individual_graph(wks, sample_name):
    """
    每個原始 scan 建立一張圖：
    Energy vs Normalized_mu
    Energy vs Flattened_mu
    """
    graph_name = safe_origin_name(sample_name + "_XAS")
    gp = op.new_graph(template="line", lname=graph_name)
    gl = gp[0]

    p1 = gl.add_plot(wks, coly=9, colx=0, type="line")
    p1.width = 2

    p2 = gl.add_plot(wks, coly=11, colx=0, type="line")
    p2.width = 2

    gl.rescale()

    try:
        gl.axis("x").title = "Energy (eV)"
        gl.axis("y").title = "Normalized / Flattened μ(E)"
    except Exception:
        pass

    return gp


def make_overlay_graph(wks_list, coly, graph_title, y_title):
    """
    建立多樣品疊圖。
    averaged worksheet 欄位：
    3 = Average_Normalized
    6 = Average_Flattened
    """
    graph_name = safe_origin_name(graph_title)
    gp = op.new_graph(template="line", lname=graph_name)
    gl = gp[0]

    for index, (wks, sample_name) in enumerate(wks_list):
        plot = gl.add_plot(wks, coly=coly, colx=0, type="line")
        plot.width = 2
        plot.color = get_sample_color(sample_name, index)
        plot.colorinc = 0

    gl.rescale()

    try:
        gl.axis("x").title = "Energy (eV)"
        gl.axis("y").title = y_title
    except Exception:
        pass

    return gp


# ============================================================
# 7. 主程式
# ============================================================

def main():
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    print(f"輸出資料夾：{OUTPUT_FOLDER}")

    if not os.path.isdir(DATA_FOLDER):
        raise FileNotFoundError(
            f"找不到資料夾：{DATA_FOLDER}\n"
            "請修改 DATA_FOLDER 成你的 .xmu 檔案資料夾。"
        )

    groups = find_xmu_files_by_subfolder(DATA_FOLDER)

    if not groups:
        raise FileNotFoundError(
            f"資料夾中找不到 .xmu 檔案：{DATA_FOLDER}"
        )

    print("找到以下樣品資料夾與 .xmu 檔案：")
    for sample_name, files in sorted(groups.items()):
        print(f"\n[{sample_name}]")
        for f in files:
            print(" -", f)

    op.new()

    averaged_worksheets = []

    for sample_name, files in sorted(groups.items()):
        print(f"\n處理樣品：{sample_name}")

        scan_results = []

        for idx, file_path in enumerate(files, start=1):
            scan_name = f"{sample_name}_scan{idx}"
            print(f"  讀取 scan {idx}：{file_path}")

            result = process_xmu_file(file_path, sample_name=scan_name)
            scan_results.append(result)

            wks, worksheet_name = import_result_to_origin(result)
            raw_csv = export_raw_result_csv(result, OUTPUT_FOLDER)

            print(f"    E0 = {result['e0']}")
            print(f"    CSV = {raw_csv}")
            print(f"    edge_step = {result['edge_step']}")
            print(f"    data points = {len(result['energy'])}")

            if MAKE_INDIVIDUAL_GRAPHS:
                make_individual_graph(wks, result["sample_name"])

        if AVERAGE_DUPLICATE_SCANS and len(scan_results) >= 2:
            if len(scan_results) > 2:
                print("  注意：此資料夾超過兩筆 .xmu，目前只使用排序後前兩筆做 averaged worksheet。")

            avg_result = make_averaged_result_from_two_scans(sample_name, scan_results[0], scan_results[1])
            avg_wks = import_averaged_result_to_origin(avg_result)
            avg_csv = export_averaged_result_csv(avg_result, OUTPUT_FOLDER)
            averaged_worksheets.append((avg_wks, sample_name))

            removed_norm_1 = sum(avg_result["removed_from_scan1_norm"])
            removed_norm_2 = sum(avg_result["removed_from_scan2_norm"])
            removed_flat_1 = sum(avg_result["removed_from_scan1_flat"])
            removed_flat_2 = sum(avg_result["removed_from_scan2_flat"])

            print(f"  averaged points = {len(avg_result['energy'])}")
            print(f"  averaged CSV = {avg_csv}")
            print(f"  removed norm: scan1={removed_norm_1}, scan2={removed_norm_2}")
            print(f"  removed flat: scan1={removed_flat_1}, scan2={removed_flat_2}")
        elif AVERAGE_DUPLICATE_SCANS:
            print("  注意：此資料夾少於兩筆 .xmu，略過 averaged worksheet。")

    if MAKE_OVERLAY_NORMALIZED and averaged_worksheets:
        make_overlay_graph(
            averaged_worksheets,
            coly=3,
            graph_title="Overlay_Averaged_Normalized_mu",
            y_title="Averaged Normalized μ(E)",
        )

    if MAKE_OVERLAY_FLATTENED and averaged_worksheets:
        make_overlay_graph(
            averaged_worksheets,
            coly=6,
            graph_title="Overlay_Averaged_Flattened_mu",
            y_title="Averaged Flattened μ(E)",
        )

    output_folder = os.path.dirname(OUTPUT_OPJU)
    if output_folder and not os.path.isdir(output_folder):
        os.makedirs(output_folder, exist_ok=True)

    save_path = OUTPUT_OPJU
    saved = op.save(save_path)

    if not saved or not os.path.isfile(save_path):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_path = os.path.join(OUTPUT_FOLDER, f"Athena_XMU_processed_{timestamp}.opju")
        saved = op.save(save_path)

    if not saved or not os.path.isfile(save_path):
        raise RuntimeError(
            f"Origin project 儲存失敗：{save_path}\n"
            "CSV 已輸出，但 Origin project 可能被 OriginPro 或 OneDrive 佔用。"
        )

    print(f"\n完成：已儲存 Origin project：{save_path}")

    if op.oext and not KEEP_ORIGIN_OPEN:
        op.exit()


if __name__ == "__main__":
    main()










