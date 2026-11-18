"""Turn a spec's reform definition into the reform dict a country model takes.

`add` and `scale` follow HMRC's ready reckoner construction, "baseline plus
illustrative change": the delta is applied to the reference model's own
baseline value for each period. The baseline is read at a single mid-year
instant and the reform value covers the whole calendar year, as
policyengine-scorecard's `pipeline/compute_uk_reckoner.py` (`reform_values`)
does, so the two tools cost the same reform the same way.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from release_history.spec import ReformSpec

_SEGMENT = re.compile(r"\.(?![^\[]*\])")
_BRACKET = re.compile(r"(.+)\[(\d+)\]")


class UnknownParameterError(LookupError):
    """A reform names a parameter path the reference model does not have."""


def parameter_node(parameters: Any, path: str) -> Any:
    """Walk a parameter tree by dotted path; `rates.uk[0].rate` indexes brackets."""
    node = parameters
    try:
        for part in _SEGMENT.split(path):
            bracket = _BRACKET.fullmatch(part)
            if bracket:
                node = getattr(node, bracket.group(1)).brackets[int(bracket.group(2))]
            else:
                node = getattr(node, part)
    except (AttributeError, IndexError) as error:
        raise UnknownParameterError(path) from error
    # A leaf parameter carries its dated values; a folder (ParameterNode) does not.
    if not hasattr(node, "values_list"):
        raise UnknownParameterError(f"{path} is a parameter folder, not a parameter")
    return node


def baseline_value(parameters: Any, path: str, period: int) -> float:
    value = parameter_node(parameters, path)(f"{period}-06-01")
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError(f"{path} is not numeric at {period}")
    return float(value)


def period_key(period: int) -> str:
    return f"{period}-01-01.{period}-12-31"


def reform_dict(
    reform: ReformSpec, parameters: Any, periods: tuple[int, ...]
) -> dict[str, dict[str, Any]]:
    """The absolute value of every changed parameter in every measured period."""
    out: dict[str, dict[str, Any]] = {}
    for path, delta in reform.add.items():
        out[path] = {period_key(p): baseline_value(parameters, path, p) + delta for p in periods}
    for path, factor in reform.scale.items():
        out[path] = {period_key(p): baseline_value(parameters, path, p) * factor for p in periods}
    for path, value in reform.parameters.items():
        parameter_node(parameters, path)  # refuse unknown paths early
        if isinstance(value, Mapping):
            out[path] = dict(value)
        else:
            out[path] = {period_key(p): value for p in periods}
    return out


def behaviour_dict(
    behaviour: Mapping[str, Any], parameters: Any, periods: tuple[int, ...]
) -> dict[str, dict[str, Any]]:
    """Parameter overrides the spec applies on both sides (static costings, say)."""
    out: dict[str, dict[str, Any]] = {}
    for path, value in behaviour.items():
        parameter_node(parameters, path)
        out[path] = {period_key(p): value for p in periods}
    return out


def merged(*dicts: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for item in dicts:
        for path, values in item.items():
            out.setdefault(path, {}).update(values)
    return out
