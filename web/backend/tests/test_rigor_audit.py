"""
嚴謹度審查（2026-11-10）各項修正的數值驗證。

每個測試都用「已知答案」的合成資料，確認程式能算回正確的數值，
或確認舊版的錯誤行為已經消失。

執行方式（在 web/backend 目錄下）：
    python -m pip install numpy scipy pandas fastapi pydantic python-multipart pytest
    python -m pytest tests/test_rigor_audit.py -v
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.integrate import trapezoid

from core.peak_fitting import fit_peaks
from core.processing import smooth_signal, strip_kalpha2
from db.xps_database import ORBITAL_RSF, get_orbital_rsf
from routers.xas import _normalize_athena, _smoothed_derivative
from routers.xes import DatasetInput as XesDataset
from routers.xes import ProcessParams as XesParams
from routers.xes import ProcessRequest as XesRequest
from routers.xes import process_xes
from routers.xps import RsfItem, VbmRequest, _auto_doublet_links, compute_vbm, get_rsf_values

GA2O3_DIR = Path(__file__).resolve().parents[3] / "Ga2O3_VB_Analyzer"
sys.path.insert(0, str(GA2O3_DIR))
from src.fitting import fit_components  # noqa: E402
from src.pdos_model import apply_cross_sections  # noqa: E402

import pandas as pd  # noqa: E402


def gaussian_fwhm(x, height, center, fwhm):
    sigma = fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    return height * np.exp(-((x - center) ** 2) / (2.0 * sigma ** 2))


# ── 1. VBM 線性外推：最小平方、無偏、誤差估計合理 ────────────────────────────

def _vbm_spectrum(rng, noise=15.0):
    x = np.linspace(0.0, 8.0, 401)
    clean = 50.0 + 200.0 * np.clip(x - 3.0, 0, None)
    return x, clean + rng.normal(0.0, noise, x.size)


def test_vbm_least_squares_is_unbiased_and_error_is_calibrated():
    rng = np.random.default_rng(1)
    values, errors = [], []
    for _ in range(200):
        x, y = _vbm_spectrum(rng)
        r = compute_vbm(VbmRequest(x=x.tolist(), y=y.tolist(), edge_lo=3.5, edge_hi=5.0,
                                   baseline_lo=0.5, baseline_hi=2.5))
        assert r.success
        values.append(r.vbm_ev)
        errors.append(r.vbm_err_ev)
    values = np.array(values)
    assert abs(values.mean() - 3.0) < 0.01          # 舊版平均偏高 +0.19 eV
    assert values.std() < 0.04                      # 舊版 0.061
    # 回報的 ±1σ 應與實際離散程度一致（±30%）
    assert 0.7 < np.mean(errors) / values.std() < 1.3


def test_vbm_line_uses_all_points_in_window():
    rng = np.random.default_rng(2)
    x, y = _vbm_spectrum(rng)
    r = compute_vbm(VbmRequest(x=x.tolist(), y=y.tolist(), edge_lo=3.5, edge_hi=5.0,
                               baseline_lo=0.5, baseline_hi=2.5))
    assert r.edge_line.method == "least_squares"
    assert r.edge_line.point_count == int(np.sum((x >= 3.5) & (x <= 5.0)))


# ── 2. 擬合參數標準誤差：與 Monte Carlo 離散一致 ─────────────────────────────

def test_fit_standard_errors_match_monte_carlo_scatter():
    x = np.linspace(525.0, 537.0, 481)
    true = (1000.0, 530.2, 1.4)
    init = [{"center": 530.0, "fwhm": 1.2, "amplitude": 900.0, "lock_center": False, "lock_fwhm": False,
             "lock_area": False, "center_min": 529.0, "center_max": 531.5, "fwhm_min": 0.5, "fwhm_max": 3.0}]
    rng = np.random.default_rng(3)
    centers, areas, center_errs, area_errs = [], [], [], []
    for _ in range(150):
        y = gaussian_fwhm(x, *true) + rng.normal(0.0, 20.0, x.size)
        r = fit_peaks(x, y, init, profile="gaussian")
        pk = r["peaks"][0]
        centers.append(pk["center"]); areas.append(pk["area"])
        center_errs.append(pk["center_err"]); area_errs.append(pk["area_err"])
    assert 0.75 < np.mean(center_errs) / np.std(centers) < 1.3
    assert 0.75 < np.mean(area_errs) / np.std(areas) < 1.3


# ── 3. XPS 自旋軌道雙峰約束 ──────────────────────────────────────────────────

def test_doublet_link_enforces_ratio_offset_and_width():
    x = np.linspace(845.0, 885.0, 801)
    y = gaussian_fwhm(x, 1000.0, 854.2, 1.8) + gaussian_fwhm(x, 500.0, 871.5, 1.8)
    rng = np.random.default_rng(4)
    y = y + rng.normal(0.0, 10.0, x.size)
    peaks = [
        {"center": 854.0, "fwhm": 1.5, "amplitude": 900.0, "lock_center": False, "lock_fwhm": False,
         "lock_area": False, "center_min": 852.0, "center_max": 856.0, "fwhm_min": 0.5, "fwhm_max": 4.0,
         "label": "Ni 2p3/2 NiO"},
        {"center": 871.5, "fwhm": 1.5, "amplitude": 400.0, "lock_center": False, "lock_fwhm": False,
         "lock_area": False, "label": "Ni 2p1/2 NiO",
         "link_to": 0, "link_center_offset": 17.3, "link_area_ratio": 0.5},
    ]
    r = fit_peaks(x, y, peaks, profile="gaussian")
    major, minor = r["peaks"]
    assert abs(minor["area"] / major["area"] - 0.5) < 1e-9
    assert abs((minor["center"] - major["center"]) - 17.3) < 1e-9
    assert abs(minor["fwhm"] - major["fwhm"]) < 1e-12
    assert minor["doublet"] and major["doublet"]


def test_auto_doublet_pairing_by_label():
    labels = ["Ni 2p3/2 NiO (Ni²⁺)", "Ni 2p1/2 NiO (Ni²⁺)", "Ni 2p3/2 Ni⁰", "Ni 2p1/2 Ni⁰", "O 1s lattice"]
    seeds = [854.2, 871.8, 852.7, 870.0, 530.0]
    links, _ = _auto_doublet_links(labels, seeds)
    assert links[1]["link_to"] == 0 and links[3]["link_to"] == 2
    assert abs(links[1]["link_area_ratio"] - 0.5) < 1e-12
    assert 4 not in links and 0 not in links and 2 not in links


# ── 4. RSF：子能階依簡併度換算、可疑值標記、動能校正 ───────────────────────

def test_rsf_sublevel_split_and_flag():
    rsf, source = get_orbital_rsf("Ga", "Ga 2p3/2")
    assert abs(rsf - ORBITAL_RSF["Ga 2p"] * 2.0 / 3.0) < 1e-12   # 舊版直接用 2p 總量
    assert "⚠" in source
    rsf_ni, source_ni = get_orbital_rsf("Ni", "Ni 2p3/2")
    assert rsf_ni == ORBITAL_RSF["Ni 2p3/2"] and "⚠" not in source_ni


def test_rsf_kinetic_energy_correction_keeps_c1s_at_one():
    rows = get_rsf_values(
        [RsfItem(element="C", label="C 1s", binding_energy=284.8),
         RsfItem(element="O", label="O 1s", binding_energy=530.0)],
        photon_energy=1486.6, ke_exponent=0.75,
    )
    assert abs(rows[0].rsf - 1.0) < 1e-12
    expected = 2.93 * ((1486.6 - 530.0) / (1486.6 - 284.8)) ** 0.75
    assert abs(rows[1].rsf - expected) < 1e-9
    assert rows[1].rsf_raw == 2.93


# ── 5. XES：平滑不再報錯、先扣背景再除 I0 ───────────────────────────────────

def test_xes_smoothing_works_and_background_is_removed_before_i0():
    x = np.arange(200, dtype=float)
    signal = gaussian_fwhm(x, 1000.0, 100.0, 12.0)
    dark = np.full_like(x, 40.0)
    i0 = 4.0
    req = XesRequest(
        samples=[XesDataset(name="s1", x=x.tolist(), y=(signal * i0 + dark).tolist())],
        bg1=XesDataset(name="bg", x=x.tolist(), y=dark.tolist()),
        params=XesParams(bg_method="bg1", smooth_method="savitzky_golay", smooth_window=7,
                         i0_values={"s1": i0}),
    )
    out = process_xes(req).datasets[0]
    np.testing.assert_allclose(out.y_corrected, signal, atol=1e-9)


# ── 6. 移動平均邊緣不再下垂 ─────────────────────────────────────────────────

def test_moving_average_preserves_flat_edges():
    out = smooth_signal(np.full(50, 100.0), method="moving_average", window_points=11)
    np.testing.assert_allclose(out, 100.0)


# ── 7. XAS：flatten 只作用在 E ≥ E0；二次微分降噪 ────────────────────────────

def test_athena_flatten_leaves_pre_edge_untouched():
    energy = np.linspace(520.0, 560.0, 801)
    e0 = 532.0
    step = 0.5 + 0.5 * np.tanh((energy - e0) / 0.8)
    mu = 0.2 + 0.001 * (energy - 520) + step * (1 + np.where(energy > e0, -0.0008 * (energy - e0) ** 2, 0.0))
    norm, flat, *_ = _normalize_athena(energy, mu, (520, 528), (538, 560), e0=e0)
    pre = energy < e0
    np.testing.assert_allclose(flat[pre], norm[pre])
    assert np.max(np.abs(flat[energy < 528])) < 0.01


def test_second_derivative_is_far_less_noisy_than_double_gradient():
    energy = np.linspace(525.0, 545.0, 801)
    clean = gaussian_fwhm(energy, 1.0, 535.0, 2.0)
    noisy = clean + np.random.default_rng(5).normal(0.0, 0.002, energy.size)
    truth = np.gradient(np.gradient(clean, energy), energy)
    sg = _smoothed_derivative(energy, noisy, deriv=2, window_points=21, poly_deg=3)
    raw = np.gradient(np.gradient(noisy, energy), energy)
    err_sg = np.sqrt(np.mean((sg - truth) ** 2))
    err_raw = np.sqrt(np.mean((raw - truth) ** 2))
    assert err_sg < 0.2 * err_raw


# ── 8. XRD：Rachinger Kα2 去除 ──────────────────────────────────────────────

def test_kalpha2_stripping_recovers_single_kalpha1_peak():
    two_theta = np.linspace(60.0, 66.0, 1201)
    lam1, lam2 = 1.540598, 1.544426
    tt1 = 63.0
    theta2 = np.degrees(np.arcsin(lam2 / lam1 * np.sin(np.radians(tt1 / 2.0))))
    tt2 = 2.0 * theta2
    kalpha1 = gaussian_fwhm(two_theta, 1000.0, tt1, 0.12)
    observed = kalpha1 + 0.5 * gaussian_fwhm(two_theta, 1000.0, tt2, 0.12)
    stripped = strip_kalpha2(two_theta, observed, lam1, lam2, 0.5)
    # 去除後應與真正的 Kα1 曲線一致（峰高 1000，Kα2 原本高 500）
    assert np.max(np.abs(stripped - kalpha1)) < 5.0
    assert abs(trapezoid(stripped, two_theta) / trapezoid(kalpha1, two_theta) - 1.0) < 0.005


# ── 9. Ga2O3 pDOS：百分比用面積、截面係數不會被平方 ─────────────────────────

def test_pdos_percentages_use_component_areas():
    energy = np.linspace(0.0, 12.0, 601)
    comp_a = gaussian_fwhm(energy, 10.0, 4.0, 2.355)
    comp_b = gaussian_fwhm(energy, 1.0, 8.0, 2.355)
    res = fit_components(energy, comp_a + comp_b, {"A": comp_a, "B": comp_b}, (0.0, 12.0), background="none")
    assert abs(res["percentages"]["A_percent"] - 100 * 10 / 11) < 0.1   # 舊版回報 50%


def test_cross_section_factor_is_applied_once():
    pdos = pd.DataFrame({"Energy_rel": [0.0, 1.0], "O_2p": [1.0, 1.0], "Ga_tet_p": [1.0, 1.0]})
    out = apply_cross_sections(pdos, {"O_2p": 2.0, "Ga_4p": 3.0, "Ga_tet": 5.0})
    assert out["O_2p"].tolist() == [2.0, 2.0]          # 舊版 4.0（2²）
    assert out["Ga_tet_p"].tolist() == [15.0, 15.0]    # 軌域 × 位置各一次


@pytest.mark.parametrize("bad_c", [0.0, -10.0])
def test_tougaard_rejects_non_positive_c(bad_c):
    from core.processing import tougaard_background
    with pytest.raises(ValueError):
        tougaard_background(np.linspace(0, 10, 20), np.ones(20), C=bad_c)
