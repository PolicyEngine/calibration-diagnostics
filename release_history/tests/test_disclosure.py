import numpy as np

from release_history.disclosure import (
    COMPLEMENTARY,
    RESIDUAL,
    SMALL_CELL,
    Cell,
    Table,
    apply_policy,
    support,
)
from release_history.measure import measure
from release_history.spec import parse_spec

from .fakes import FakeBackend, fake_spec_dict

# Households 0 and 1 are clones of one survey household; 2..9 are distinct.
SOURCES = np.array([7, 7, 8, 9, 10, 11, 12, 13, 14, 15])


def mask(*households: int) -> np.ndarray:
    out = np.zeros(SOURCES.size, dtype=bool)
    out[list(households)] = True
    return out


def test_support_counts_distinct_source_households():
    assert support(mask(0, 1), SOURCES) == 1  # clones count once
    assert support(mask(0, 1, 2), SOURCES) == 2
    assert support(mask(), SOURCES) == 0


def test_cells_on_one_or_two_sources_are_withheld_and_zero_support_is_published():
    small = Cell("a", 2026, "currency", 5.0, supports=[mask(0, 1, 2)])
    enough = Cell("b", 2026, "currency", 6.0, supports=[mask(2, 3, 4)])
    zero = Cell("c", 2026, "currency", 0.0, supports=[mask()])
    withheld = apply_policy(
        "source_household_small_cells", [small, enough, zero], [], source_ids=SOURCES, floor=3
    )
    assert withheld == 1
    assert (small.status, small.reason, small.value) == ("withheld", SMALL_CELL, None)
    assert enough.status == "ok" and zero.status == "ok" and zero.value == 0.0


def test_a_rate_needs_its_complement_on_enough_sources_too():
    rate = Cell("rate", 2026, "rate", 0.9, supports=[mask(2, 3, 4, 5), mask(6)])
    apply_policy("source_household_small_cells", [rate], [], source_ids=SOURCES, floor=3)
    assert rate.status == "withheld"


def test_one_withheld_part_takes_its_smallest_partner_with_it():
    total = Cell("total", 2026, "ratio", 1.0, supports=[mask(*range(2, 10))])
    parts = [
        Cell("d1", 2026, "ratio", 1.0, supports=[mask(2)]),  # 1 source: withheld
        Cell("d2", 2026, "ratio", 1.0, supports=[mask(3, 4, 5)]),  # smallest partner
        Cell("d3", 2026, "ratio", 1.0, supports=[mask(6, 7, 8, 9)]),
    ]
    table = Table(2026, "total", ["d1", "d2", "d3"])
    apply_policy(
        "source_household_small_cells", [total, *parts], [table], source_ids=SOURCES, floor=3
    )
    assert parts[0].reason == SMALL_CELL
    assert parts[1].reason == COMPLEMENTARY
    assert parts[2].status == "ok" and total.status == "ok"


def test_a_small_hidden_residual_withholds_a_published_part():
    total = Cell("budget", 2026, "currency", 10.0, supports=[mask(*range(2, 10))])
    part = Cell("tax", 2026, "currency", 9.0, supports=[mask(2, 3, 4, 5)])
    table = Table(2026, "budget", ["tax"], hidden=[mask(6)], reason=RESIDUAL)
    apply_policy(
        "source_household_small_cells", [total, part], [table], source_ids=SOURCES, floor=3
    )
    assert (part.status, part.reason) == ("withheld", RESIDUAL)
    assert total.status == "ok"


def test_with_no_part_left_to_withhold_the_total_goes():
    total = Cell("budget", 2026, "currency", 10.0, supports=[mask(*range(2, 10))])
    table = Table(2026, "budget", [], hidden=[mask(6, 7)], reason=RESIDUAL)
    apply_policy("source_household_small_cells", [total], [table], source_ids=SOURCES, floor=3)
    assert (total.status, total.reason) == ("withheld", RESIDUAL)


def test_policy_none_changes_nothing():
    cell = Cell("a", 2026, "currency", 5.0, supports=[mask(2)])
    assert apply_policy("none", [cell], [], source_ids=None, floor=3) == 0
    assert cell.status == "ok"


def test_no_published_cell_rests_on_one_or_two_sources_after_a_measurement():
    # Each fake household is its own survey household: four sources in all.
    spec = parse_spec(
        fake_spec_dict(
            disclosure={
                "policy": "source_household_small_cells",
                "min_source_households": 3,
                "source_id_columns": ["household_source_id"],
            }
        )
    )
    result = measure(spec, FakeBackend())
    sources = np.array([1, 2, 3, 4])
    apply_policy(spec.disclosure_policy, result.cells, result.tables, source_ids=sources, floor=3)
    for cell in result.cells:
        if cell.status == "ok":
            for support_mask in cell.supports:
                assert support(support_mask, sources) == 0 or support(support_mask, sources) >= 3
    by_output = {c.output: c for c in result.cells}
    # Decile 1 is one household, so its mean is withheld.
    assert by_output["baseline/net_income_mean/decile_1"].status == "withheld"
    # The tax rise touches all four households: its budget line stays.
    assert by_output["reform/tax_up/budgetary_impact"].status == "ok"
