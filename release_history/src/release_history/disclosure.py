"""Disclosure policies, applied inside the producer before anything is written.

`none`: no checks (for countries whose microdata are public).

`source_household_small_cells` (the UK; UKDS CD171 §5.2.1 with María's working
floor of 3 distinct survey households since 2026-10-29):

- Floor: every support mask a cell carries must rest on 0 or at least
  `floor` distinct source households. Microcosm clones share a source id, so
  they count once. A cell on 1 to floor-1 is withheld.
- Complementary withholding inside a table: when a table's total is published,
  whatever can be derived as the total minus its published parts (the parts
  withheld above, plus the parts the measurement never publishes, such as the
  adults beside a children cell) must also rest on 0 or at least `floor`
  sources. Otherwise the published part with the smallest support is withheld
  too, and so on.

What is stored is a status and a reason per cell, never a support count.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SMALL_CELL = "small_cell"
COMPLEMENTARY = "complementary"
RESIDUAL = "residual"


@dataclass
class Cell:
    """One published number: an output, for one period, in one measurement."""

    output: str
    period: int
    unit: str
    value: float | None
    status: str = "ok"
    reason: str | None = None
    supports: list[np.ndarray] = field(default_factory=list, repr=False)

    def withhold(self, reason: str) -> None:
        self.status = "withheld"
        self.reason = reason
        self.value = None

    def to_json(self) -> dict:
        out: dict = {
            "output": self.output,
            "period": self.period,
            "unit": self.unit,
            "value": self.value,
            "status": self.status,
        }
        if self.reason is not None:
            out["reason"] = self.reason
        return out


@dataclass
class Table:
    """A published total and parts of it; `hidden` are derivable, unpublished parts."""

    period: int
    total: str | None
    parts: list[str]
    hidden: list[np.ndarray] = field(default_factory=list, repr=False)
    reason: str = COMPLEMENTARY


def support(mask: np.ndarray, source_ids: np.ndarray) -> int:
    """The number of distinct source households a household-level mask touches."""
    if mask.dtype != bool:
        mask = mask.astype(bool)
    if not mask.any():
        return 0
    return int(np.unique(source_ids[mask]).size)


def _small(count: int, floor: int) -> bool:
    return 0 < count < floor


def apply_source_household_small_cells(
    cells: list[Cell], tables: list[Table], source_ids: np.ndarray, floor: int
) -> int:
    """Withhold cells in place. Returns the number of cells withheld."""
    by_key = {(cell.output, cell.period): cell for cell in cells}
    withheld = 0
    for cell in cells:
        if cell.status != "ok":
            continue
        if any(_small(support(mask, source_ids), floor) for mask in cell.supports):
            cell.withhold(SMALL_CELL)
            withheld += 1
    for table in tables:
        total = by_key.get((table.total, table.period)) if table.total else None
        if total is None or total.status != "ok":
            continue
        parts = [by_key[(p, table.period)] for p in table.parts if (p, table.period) in by_key]
        while True:
            derivable = [*table.hidden]
            derivable += [m for part in parts if part.status != "ok" for m in part.supports[:1]]
            if not derivable:
                break
            union = np.logical_or.reduce([m.astype(bool) for m in derivable])
            if not _small(support(union, source_ids), floor):
                break
            candidates = [
                part
                for part in parts
                if part.status == "ok" and part.supports and support(part.supports[0], source_ids)
            ]
            if not candidates:
                total.withhold(table.reason)
                withheld += 1
                break
            smallest = min(candidates, key=lambda part: support(part.supports[0], source_ids))
            smallest.withhold(table.reason)
            withheld += 1
    return withheld


def apply_policy(
    policy: str,
    cells: list[Cell],
    tables: list[Table],
    *,
    source_ids: np.ndarray | None,
    floor: int,
) -> int:
    if policy == "none":
        return 0
    if policy == "source_household_small_cells":
        if source_ids is None:
            raise ValueError("source_household_small_cells needs source household ids")
        return apply_source_household_small_cells(cells, tables, source_ids, floor)
    raise ValueError(f"Unknown disclosure policy {policy!r}")
