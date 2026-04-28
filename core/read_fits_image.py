#!/usr/bin/env python3
"""Small FITS primary-image reader used by the XES pipeline.

The project intentionally avoids adding astropy just to read detector images.
This module supports the common primary-image subset needed for raw XES CCD
frames and keeps the old command-line row/column CSV export workflow.
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np


CARD_SIZE = 80
BLOCK_SIZE = 2880


BITPIX_DTYPES = {
    8: "u1",
    16: "i2",
    32: "i4",
    -32: "f4",
    -64: "f8",
}


@dataclass(frozen=True)
class FitsImage:
    path: Path | None
    source: str
    header_cards: list[str]
    header: dict[str, object]
    data_offset: int
    shape: tuple[int, ...]
    pixels: np.ndarray

    @property
    def width(self) -> int:
        return int(self.shape[0]) if self.shape else int(len(self.pixels))

    @property
    def height(self) -> int:
        return int(self.shape[1]) if len(self.shape) >= 2 else 1

    @property
    def plane_count(self) -> int:
        plane_size = max(1, self.width * self.height)
        return max(1, int(len(self.pixels) // plane_size))

    def as_array(self, plane: int = 0) -> np.ndarray:
        """Return one detector plane as a 2D array shaped (row, column)."""
        plane = int(plane)
        if plane < 0 or plane >= self.plane_count:
            raise ValueError(f"Plane index out of range: {plane}")

        plane_size = self.width * self.height
        start = plane * plane_size
        end = start + plane_size
        return np.asarray(self.pixels[start:end], dtype=float).reshape(self.height, self.width)


def parse_value(raw: str) -> object:
    value = raw.split("/", 1)[0].strip()
    if not value:
        return ""
    if value.startswith("'") and "'" in value[1:]:
        return value[1:value.find("'", 1)]
    if value in {"T", "F"}:
        return value == "T"

    numeric = value.replace("D", "E").replace("d", "E")
    try:
        if any(ch in numeric.upper() for ch in (".", "E")):
            return float(numeric)
        return int(numeric)
    except ValueError:
        return value


def read_header(blob: bytes) -> tuple[list[str], dict[str, object], int]:
    cards: list[str] = []
    header: dict[str, object] = {}

    for offset in range(0, len(blob), CARD_SIZE):
        card = blob[offset:offset + CARD_SIZE].decode("ascii", errors="replace")
        cards.append(card)
        key = card[:8].strip()
        if key == "END":
            header_size = ((offset + CARD_SIZE + BLOCK_SIZE - 1) // BLOCK_SIZE) * BLOCK_SIZE
            return cards, header, header_size
        if "=" in card[:10]:
            header[key] = parse_value(card[10:])

    raise ValueError("FITS header END card not found")


def read_primary_image_bytes(blob: bytes, source: str = "<uploaded>", path: Path | None = None) -> FitsImage:
    cards, header, data_offset = read_header(blob)

    try:
        bitpix = int(header["BITPIX"])
        naxis = int(header["NAXIS"])
    except KeyError as exc:
        raise ValueError(f"Missing required FITS header keyword: {exc.args[0]}") from exc

    if naxis < 1:
        raise ValueError("FITS file does not contain primary image data")
    if bitpix not in BITPIX_DTYPES:
        raise ValueError(f"Unsupported BITPIX: {bitpix}")

    shape = tuple(int(header[f"NAXIS{i}"]) for i in range(1, naxis + 1))
    count = math.prod(shape)
    dtype = np.dtype(f">{BITPIX_DTYPES[bitpix]}")
    byte_count = dtype.itemsize

    data = blob[data_offset:data_offset + count * byte_count]
    if len(data) != count * byte_count:
        raise ValueError("FITS image data is shorter than header dimensions declare")

    raw_values = np.frombuffer(data, dtype=dtype, count=count)
    pixels = raw_values.astype(np.float64)

    blank = header.get("BLANK")
    if blank is not None and bitpix > 0:
        pixels[raw_values == int(blank)] = np.nan

    bscale = float(header.get("BSCALE", 1.0))
    bzero = float(header.get("BZERO", 0.0))
    if bscale != 1.0 or bzero != 0.0:
        pixels = pixels * bscale + bzero

    return FitsImage(path, source, cards, header, data_offset, shape, pixels)


def read_primary_image(path: Path) -> FitsImage:
    path = Path(path)
    return read_primary_image_bytes(path.read_bytes(), source=str(path), path=path)


def row_sums(image: FitsImage, plane: int = 0) -> list[float]:
    return np.nansum(image.as_array(plane), axis=1).astype(float).tolist()


def column_sums(image: FitsImage, plane: int = 0) -> list[float]:
    return np.nansum(image.as_array(plane), axis=0).astype(float).tolist()


def write_series(path: Path, label: str, values: Iterable[float]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([label, "sum"])
        for index, value in enumerate(values):
            writer.writerow([index, value])


def main() -> int:
    parser = argparse.ArgumentParser(description="Read a FITS primary image and optionally export spectra.")
    parser.add_argument("fits_file", type=Path)
    parser.add_argument("--row-csv", type=Path)
    parser.add_argument("--column-csv", type=Path)
    parser.add_argument("--plane", type=int, default=0)
    args = parser.parse_args()

    image = read_primary_image(args.fits_file)
    finite = image.pixels[np.isfinite(image.pixels)]
    if len(finite) == 0:
        raise ValueError("FITS image does not contain finite pixel values")

    print(f"path: {image.source}")
    print(f"data_offset: {image.data_offset}")
    print(f"shape_naxis_order: {image.shape}")
    print(f"array_shape: {(image.height, image.width)}")
    print(f"planes: {image.plane_count}")
    print(f"bitpix: {image.header.get('BITPIX')}")
    print(f"bscale: {image.header.get('BSCALE', 1.0)}")
    print(f"bzero: {image.header.get('BZERO', 0.0)}")
    print(f"min: {float(np.nanmin(finite))}")
    print(f"max: {float(np.nanmax(finite))}")
    print(f"mean: {float(np.nanmean(finite))}")
    print(f"nonzero: {int(np.count_nonzero(finite))}")

    rows = row_sums(image, plane=args.plane)
    columns = column_sums(image, plane=args.plane)
    print(f"top_rows: {sorted(enumerate(rows), key=lambda item: item[1], reverse=True)[:10]}")
    print(f"top_columns: {sorted(enumerate(columns), key=lambda item: item[1], reverse=True)[:10]}")

    if args.row_csv:
        write_series(args.row_csv, "row", rows)
    if args.column_csv:
        write_series(args.column_csv, "column", columns)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
