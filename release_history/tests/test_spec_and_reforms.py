import pytest

from release_history.reforms import (
    UnknownParameterError,
    parameter_node,
    period_key,
    reform_dict,
)
from release_history.spec import SpecError, load_spec, parse_spec

from .fakes import fake_parameters, fake_spec_dict


def test_every_committed_country_spec_parses():
    for country in ("uk", "us"):
        spec = load_spec(country)
        assert spec.country == country
        assert spec.reforms and spec.baseline
        assert len(spec.digest) == 64


def test_the_uk_spec_holds_the_seven_reckoner_reforms_for_2026_27():
    spec = load_spec("uk")
    assert spec.periods == (2026,)
    assert spec.label_period(2026) == "2026-27"
    assert len(spec.reforms) == 7
    assert all(r.add and not r.scale and not r.parameters for r in spec.reforms)
    assert spec.disclosure_policy == "source_household_small_cells"
    assert spec.min_source_households == 3


def test_the_digest_follows_the_document_not_its_formatting():
    first = parse_spec(fake_spec_dict())
    again = parse_spec(fake_spec_dict())
    changed = parse_spec(fake_spec_dict(periods=[2026, 2027]))
    assert first.digest == again.digest != changed.digest


@pytest.mark.parametrize(
    "override, message",
    [
        ({"schema_version": 2}, "schema_version"),
        ({"periods": []}, "periods"),
        # When a country runs is a repository variable, never a spec key.
        ({"schedule": "weekly"}, "RELEASE_HISTORY_WEEKLY"),
        (
            {
                "disclosure": {
                    "policy": "source_household_small_cells",
                    "min_source_households": 2,
                    "source_id_columns": ["x"],
                }
            },
            "never lowered",
        ),
        ({"reforms": [{"id": "r", "targets": ["income_tax"]}]}, "at least one of"),
        ({"reforms": [{"id": "r", "add": {"gov.tax.rate": 0.1}}]}, "targets"),
        ({"baseline": [{"id": "p", "stat": "population"}]}, "entity"),
    ],
)
def test_specs_that_cannot_be_measured_are_refused(override, message):
    with pytest.raises(SpecError, match=message):
        parse_spec(fake_spec_dict(**override))


def test_the_series_is_the_named_lines_from_since():
    spec = parse_spec(fake_spec_dict(series={"releases": ["zz-national"], "since": "2026-10-19"}))
    assert spec.in_series("zz-national", "2026-10-19T00:00:00Z")
    assert spec.in_series("zz-national", "2026-11-07T04:00:00+00:00")
    assert not spec.in_series("zz-national", "2026-10-18T23:59:59Z")
    # Compared by UTC date: 00:30 in UTC+1 on the 19th is the 18th in UTC.
    assert not spec.in_series("zz-national", "2026-10-19T00:30:00+01:00")
    assert not spec.in_series("zz-national-dense", "2026-11-01T00:00:00Z")
    assert parse_spec(fake_spec_dict()).in_series("zz-national", "2020-01-01T00:00:00Z")


@pytest.mark.parametrize(
    "series, message",
    [
        ({"releases": ["^zz-2024-"]}, "patterns are gone"),
        ({"releases": ["zz-national"], "exclude": ["-5c6b3f68$"]}, "series.since"),
        ({"releases": ["zz-national"], "since": "19 Oct 2026"}, "YYYY-MM-DD"),
        ({"releases": []}, "at least one"),
    ],
)
def test_series_rules_beyond_names_and_a_date_are_refused(series, message):
    with pytest.raises(SpecError, match=message):
        parse_spec(fake_spec_dict(series=series))


# Each country's spec digest is part of its panel id. A change here gives the country a new panel
# and re-measures its whole series; update the pin only when that is the intent.
PINNED_SPEC_DIGESTS = {
    "uk": "22ce4922f89de8f7910d9af5c627e4857d510e8fbed343b8ca2fc58d9d6db787",
    "us": "6a7f48e198a83bf60b58c9a0634373f890272d1a305b1fbb2aff593217b26ee2",
}


@pytest.mark.parametrize("country", sorted(PINNED_SPEC_DIGESTS))
def test_each_country_s_spec_digest_is_pinned(country):
    assert load_spec(country).digest == PINNED_SPEC_DIGESTS[country]


def test_bracket_paths_walk_into_brackets():
    parameters = fake_parameters()
    assert parameter_node(parameters, "gov.tax.rates[1].rate")("2026-06-01") == 0.4
    with pytest.raises(UnknownParameterError):
        parameter_node(parameters, "gov.tax.rates[5].rate")
    with pytest.raises(UnknownParameterError):
        parameter_node(parameters, "gov.tax")  # a folder, not a parameter


def test_reform_operations_build_absolute_values_per_period():
    spec = parse_spec(
        fake_spec_dict(
            periods=[2026, 2027],
            reforms=[
                {
                    "id": "mixed",
                    "targets": ["income_tax"],
                    "add": {"gov.tax.rates[0].rate": 0.01},
                    "scale": {"gov.benefit.amount": 1.1},
                    "parameters": {"gov.tax.rate": 0.25},
                }
            ],
        )
    )
    built = reform_dict(spec.reforms[0], fake_parameters(), spec.periods)
    assert built["gov.tax.rates[0].rate"] == {
        period_key(2026): pytest.approx(0.21),
        period_key(2027): pytest.approx(0.21),
    }
    assert built["gov.benefit.amount"][period_key(2026)] == pytest.approx(110.0)
    assert built["gov.tax.rate"] == {period_key(2026): 0.25, period_key(2027): 0.25}
