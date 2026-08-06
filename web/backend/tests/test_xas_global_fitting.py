import numpy as np

from core.xas_global_fitting import fit_xas_global_components, gaussian_height


def test_global_fit_shares_shape_and_subtracts_only_small_gaussian():
    x = np.linspace(529.0, 546.0, 680)
    centers = [531.5, 534.31, 537.0, 539.5, 541.0]
    fwhms = [1.0, 1.1, 1.25, 1.0, 1.15]
    labels = ["A2", "B2", "P3", "P4", "C2"]
    heights_by_sample = [
        [0.9, 0.7, 0.35, 0.3, 0.4],
        [0.7, 0.5, 0.4, 0.45, 0.6],
    ]
    datasets = []
    for index, heights in enumerate(heights_by_sample):
        background = 0.12 + 0.006 * (x - 537.0) + index * 0.03
        main = sum(gaussian_height(x, height, center, fwhm) for height, center, fwhm in zip(heights, centers, fwhms))
        small = gaussian_height(x, 0.22 + index * 0.06, 545.05, 0.62)
        datasets.append({"name": f"sample_{index + 1}", "x": x.tolist(), "y": (background + main + small).tolist()})

    result = fit_xas_global_components(
        datasets=datasets,
        small_peak={
            "range": [544.0, 545.9],
            "center": 545.0,
            "center_min": 544.7,
            "center_max": 545.3,
            "lock_center": False,
            "fwhm": 0.7,
            "fwhm_min": 0.3,
            "fwhm_max": 1.2,
            "lock_fwhm": False,
            "background": "linear",
        },
        main_peaks=[{
            "label": label,
            "center": center + 0.04,
            "center_min": center - 0.25,
            "center_max": center + 0.25,
            "lock_center": False,
            "fwhm": fwhm + 0.05,
            "fwhm_min": 0.6,
            "fwhm_max": 1.8,
            "lock_fwhm": False,
        } for label, center, fwhm in zip(labels, centers, fwhms)],
        fit_range=[529.2, 543.0],
        main_background="linear",
        ratio_numerator="C2",
        ratio_denominator="B2",
    )

    assert result["success"] is True
    assert len(result["datasets"]) == 2
    for fitted, expected_center, expected_fwhm in zip(result["shared_peaks"], centers, fwhms):
        assert abs(fitted["center"] - expected_center) < 0.05
        assert abs(fitted["fwhm"] - expected_fwhm) < 0.08

    first = result["datasets"][0]
    corrected = np.asarray(first["corrected"])
    original = np.asarray(first["original"])
    small_component = np.asarray(first["small_peak"]["component"])
    local_background = np.asarray(first["small_peak"]["local_background"])
    assert np.allclose(corrected, original - small_component)
    assert np.max(np.abs(local_background)) > 0.05
    assert abs(first["area_ratio"] - heights_by_sample[0][-1] / heights_by_sample[0][1]) < 0.04
    assert first["r_squared"] > 0.999
