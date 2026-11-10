"""
XPS 背景扣除與峰擬合的數值驗證。

做法：用「已知答案」的合成光譜（指定峰位、半高寬、面積與背景），
跑一遍與網頁版相同的程式，檢查能否算回原本的數值。

執行方式（在 web/backend 目錄下）：
    python -m pytest tests/test_xps_fitting.py -v
"""

import numpy as np
from scipy.special import voigt_profile

from core.peak_fitting import (
    area_gaussian,
    area_lorentzian,
    area_split_pseudo_voigt,
    area_voigt,
    fit_peaks,
    split_pseudo_voigt_peak,
    voigt_peak,
)
from core.processing import apply_background, shirley_background, tougaard_background

GAUSS_FWHM_TO_SIGMA = 1.0 / (2.0 * np.sqrt(2.0 * np.log(2.0)))


def gaussian_fwhm(x, height, center, fwhm):
    sigma = fwhm * GAUSS_FWHM_TO_SIGMA
    return height * np.exp(-((x - center) ** 2) / (2.0 * sigma ** 2))


def wide_numeric_area(func, half_width, n_points=2_000_001):
    xs = np.linspace(-half_width, half_width, n_points)
    return float(np.sum(func(xs)) * (xs[1] - xs[0]))


# 合成 O 1s：晶格氧 530.2 eV + 缺陷/OH 531.8 eV，加上 Shirley 型階梯背景
O1S_X = np.linspace(524.0, 538.0, 701)
O1S_TRUE = [(1000.0, 530.2, 1.3), (400.0, 531.8, 1.6)]  # (height, center, FWHM)
O1S_PEAKS = sum(gaussian_fwhm(O1S_X, *p) for p in O1S_TRUE)
O1S_STEP = 200.0 + 150.0 * np.cumsum(O1S_PEAKS) / np.sum(O1S_PEAKS)
O1S_TRUE_RATIO = (O1S_TRUE[1][0] * O1S_TRUE[1][2]) / (O1S_TRUE[0][0] * O1S_TRUE[0][2])


def o1s_init_peaks():
    return [
        {"center": 530.0, "fwhm": 1.0, "amplitude": 800.0, "lock_center": False, "lock_fwhm": False,
         "lock_area": False, "center_min": 529.0, "center_max": 531.0, "fwhm_min": 0.5, "fwhm_max": 3.0},
        {"center": 532.0, "fwhm": 1.0, "amplitude": 300.0, "lock_center": False, "lock_fwhm": False,
         "lock_area": False, "center_min": 531.0, "center_max": 533.0, "fwhm_min": 0.5, "fwhm_max": 3.0},
    ]


def fitted_area_ratio(x, y_sub):
    result = fit_peaks(x, y_sub, o1s_init_peaks(), profile="gaussian")
    assert result["success"]
    areas = [p["area"] for p in result["peaks"]]
    return areas[1] / areas[0], result


# ── 1. 完整流程：Shirley 背景 + 雙峰擬合，算回真值 ────────────────────────────

def test_shirley_plus_fit_recovers_known_o1s_components():
    y_sub, _ = apply_background(O1S_X, O1S_PEAKS + O1S_STEP, "shirley", 524.0, 538.0)
    ratio, result = fitted_area_ratio(O1S_X, y_sub)

    for fitted, (height, center, fwhm) in zip(result["peaks"], O1S_TRUE):
        assert abs(fitted["center"] - center) < 0.005
        assert abs(fitted["fwhm"] - fwhm) / fwhm < 0.005
        assert abs(fitted["amplitude"] - height) / height < 0.005
    assert abs(ratio - O1S_TRUE_RATIO) / O1S_TRUE_RATIO < 0.005
    assert result["r_squared"] > 0.9999


def test_shirley_is_independent_of_energy_order():
    y = O1S_PEAKS + O1S_STEP
    bg_ascending = shirley_background(y)
    bg_descending = shirley_background(y[::-1])[::-1]
    assert np.allclose(bg_ascending, bg_descending, rtol=1e-6)


def test_shirley_edge_averaging_reduces_noise_sensitivity():
    errors_single, errors_avg = [], []
    for seed in range(20):
        noise = np.random.default_rng(seed).normal(0.0, 8.0, O1S_X.size)
        y = O1S_PEAKS + O1S_STEP + noise
        for edge_points, errors in [(1, errors_single), (5, errors_avg)]:
            y_sub, _ = apply_background(O1S_X, y, "shirley", 524.0, 538.0, edge_points=edge_points)
            ratio, _ = fitted_area_ratio(O1S_X, y_sub)
            errors.append((ratio - O1S_TRUE_RATIO) / O1S_TRUE_RATIO)
    assert abs(np.mean(errors_avg)) < 0.03          # 無系統偏差
    assert np.std(errors_avg) < np.std(errors_single)  # 端點平均後較不受雜訊影響


# ── 2. 峰面積公式 ─────────────────────────────────────────────────────────────

def test_voigt_area_matches_analytic_and_limits():
    for sigma, gamma in [(0.5, 0.05), (0.4, 0.2), (0.3, 0.3), (0.1, 0.5)]:
        exact = 1000.0 / voigt_profile(0.0, sigma, gamma)
        assert abs(area_voigt(1000.0, sigma, gamma) - exact) / exact < 1e-12
        numeric = wide_numeric_area(lambda t: voigt_peak(t, 1000.0, 0.0, sigma, gamma), 5000.0 * gamma)
        assert abs(numeric - exact) / exact < 1e-3
    # γ→0 退化為高斯、σ→0 退化為 Lorentzian
    assert abs(area_voigt(1.0, 0.4, 1e-9) - area_gaussian(1.0, 0.4)) / area_gaussian(1.0, 0.4) < 1e-6
    assert abs(area_voigt(1.0, 1e-9, 0.4) - area_lorentzian(1.0, 0.4)) / area_lorentzian(1.0, 0.4) < 1e-6


def test_split_pseudo_voigt_area_matches_numeric_integral():
    amplitude, left, right, eta = 500.0, 0.8, 1.6, 0.4
    numeric = wide_numeric_area(
        lambda t: split_pseudo_voigt_peak(t, amplitude, 0.0, left, right, eta), 20000.0,
        n_points=4_000_001,
    )
    analytic = area_split_pseudo_voigt(amplitude, left, right, eta)
    assert abs(analytic - numeric) / analytic < 1e-3


def test_voigt_fit_recovers_true_area():
    x = np.linspace(520.0, 540.0, 2001)
    true_area, center, sigma, gamma = 900.0, 530.0, 0.35, 0.25
    y = true_area * voigt_profile(x - center, sigma, gamma)
    init = [{"center": 529.8, "fwhm": 1.0, "amplitude": float(y.max()) * 0.8, "lock_center": False,
             "lock_fwhm": False, "lock_area": False, "center_min": 528.0, "center_max": 532.0,
             "fwhm_min": 0.3, "fwhm_max": 4.0}]
    result = fit_peaks(x, y, init, profile="voigt", fit_range=[520.0, 540.0])
    assert result["success"]
    assert abs(result["peaks"][0]["area"] - true_area) / true_area < 0.005


# ── 3. Tougaard 背景方向 ──────────────────────────────────────────────────────

def test_tougaard_background_rises_on_high_binding_energy_side():
    x = np.linspace(520.0, 560.0, 801)
    offset = 50.0
    y = gaussian_fwhm(x, 1000.0, 530.0, 1.5) + offset
    bg = tougaard_background(x, y)
    low_be = bg[np.argmin(np.abs(x - 525.0))]
    high_be = bg[np.argmin(np.abs(x - 545.0))]
    assert abs(low_be - offset) < 1e-6       # 峰的低結合能側：只剩常數背景
    assert high_be > offset + 10.0            # 峰的高結合能側：能量損失背景抬升
    # 輸入順序（BE 由小到大或由大到小）不影響結果
    assert np.allclose(tougaard_background(x[::-1], y[::-1])[::-1], bg)
