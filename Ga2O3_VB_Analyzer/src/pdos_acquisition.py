from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .io_utils import read_table


@dataclass
class PdosReference:
    data: pd.DataFrame
    source: str
    notes: list[str] = field(default_factory=list)


MP_COLUMNS = [
    "O_2p",
    "O_2s",
    "Ga_tet_s",
    "Ga_tet_p",
    "Ga_tet_d",
    "Ga_oct_s",
    "Ga_oct_p",
    "Ga_oct_d",
]


def uploaded_reference(file: Any, source: str) -> PdosReference:
    df = read_table(file)
    notes = []
    if source == "digitized":
        notes.append(
            "文獻圖數位化 pDOS 僅作定性參考，不應做定量解讀。"
        )
    return PdosReference(data=df, source=source, notes=notes)


def _mpr_class():
    try:
        from mp_api.client import MPRester

        return MPRester
    except Exception:
        try:
            from pymatgen.ext.matproj import MPRester

            return MPRester
        except Exception as exc:
            raise ImportError("請安裝 mp-api 與 pymatgen 以使用 Materials Project 匯入。") from exc


def _spin_sum(densities: Any) -> np.ndarray:
    if isinstance(densities, dict):
        vals = [np.asarray(v, dtype=float) for v in densities.values()]
        if vals:
            return np.sum(vals, axis=0)
    return np.asarray(densities, dtype=float)


def _orbital_family(orbital: Any) -> str | None:
    name = str(getattr(orbital, "name", orbital)).lower()
    if name.startswith("s"):
        return "s"
    if name.startswith("p") or name in {"px", "py", "pz"}:
        return "p"
    if name.startswith("d") or name in {"dxy", "dyz", "dz2", "dxz", "dx2"}:
        return "d"
    return None


def _coordination_numbers(structure: Any) -> tuple[dict[int, float], list[str]]:
    notes = []
    try:
        from pymatgen.analysis.local_env import CrystalNN

        cnn = CrystalNN()
        return {i: float(cnn.get_cn(structure, i, use_weights=False)) for i in range(len(structure))}, notes
    except Exception as exc:
        notes.append(f"CrystalNN 配位判斷失敗，改用 O 鄰近原子 cutoff 備援。細節：{exc}")

    cn_by_index: dict[int, float] = {}
    for i, site in enumerate(structure):
        if getattr(site.specie, "symbol", "") != "Ga":
            continue
        count = 0
        for neighbor in structure.get_neighbors(site, 2.6):
            if getattr(neighbor.specie, "symbol", "") == "O":
                count += 1
        cn_by_index[i] = float(count)
    return cn_by_index, notes


def _coordination_group(cn: float) -> tuple[str, str | None]:
    if abs(cn - 4) <= abs(cn - 6):
        note = None if abs(cn - 4) <= 1.0 else f"Ga site CN={cn:.1f} 依最接近配位指定為 Ga_tet。"
        return "Ga_tet", note
    note = None if abs(cn - 6) <= 1.0 else f"Ga site CN={cn:.1f} 依最接近配位指定為 Ga_oct。"
    return "Ga_oct", note


def _get_structure_and_dos(api_key: str, material_id: str) -> tuple[Any, Any]:
    MPRester = _mpr_class()
    with MPRester(api_key) as mpr:
        structure = mpr.get_structure_by_material_id(material_id)
        dos = mpr.get_dos_by_material_id(material_id)
    return structure, dos


def materials_project_reference(api_key: str, material_id: str) -> PdosReference:
    structure, dos = _get_structure_and_dos(api_key, material_id)
    notes = [
        f"已匯入 Materials Project 參考資料 {material_id}。能量已對齊為 E_rel = -(E - Efermi)；定量比較前請確認 VBM 對齊。"
    ]

    pdos = getattr(dos, "pdos", None)
    if not pdos:
        raise ValueError("DOS 不包含 site/orbital projected 資訊。請改以上傳 pDOS CSV。")

    energies = np.asarray(getattr(dos, "energies"), dtype=float)
    efermi = float(getattr(dos, "efermi", 0.0))
    out = pd.DataFrame({"Energy_rel": -(energies - efermi)})
    for col in MP_COLUMNS:
        out[col] = 0.0

    cn_by_index, cn_notes = _coordination_numbers(structure)
    notes.extend(cn_notes)
    index_by_site = {id(site): i for i, site in enumerate(structure)}

    matched_sites = 0
    for site, orbital_map in pdos.items():
        element = getattr(site.specie, "symbol", "")
        if element not in {"O", "Ga"}:
            continue
        site_index = index_by_site.get(id(site))
        if site_index is None:
            try:
                site_index = structure.index(site)
            except Exception:
                site_index = None

        ga_group = None
        if element == "Ga":
            cn = cn_by_index.get(site_index if site_index is not None else -1, 4.0)
            ga_group, note = _coordination_group(cn)
            if note:
                notes.append(note)

        matched_sites += 1
        for orbital, densities in orbital_map.items():
            family = _orbital_family(orbital)
            if family is None:
                continue
            contribution = _spin_sum(densities)
            if element == "O" and family in {"s", "p"}:
                out[f"O_2{family}"] += contribution
            elif element == "Ga" and ga_group and family in {"s", "p", "d"}:
                out[f"{ga_group}_{family}"] += contribution

    if matched_sites == 0:
        raise ValueError("無法解析 Ga/O site-projected DOS。請改以上傳 pDOS CSV。")

    out = out.sort_values("Energy_rel").reset_index(drop=True)
    return PdosReference(data=out, source="materials_project", notes=notes)
