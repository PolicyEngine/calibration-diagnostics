"""Each TypedDict in `release_history.documents` matches its schema in `schemas/`.

At every level of nesting, the TypedDict requires the keys the schema requires,
and a closed object (`additionalProperties: false`) declares no other key. So a
key added to a schema and not to its type, or the other way round, fails here.
"""

import json
import typing
from typing import Any

import pytest

from release_history import documents

from .schema_check import SCHEMAS

ROOTS = {
    "point": documents.PointDocument,
    "panel": documents.PanelDocument,
    "series": documents.SeriesRecord,
    "labels": documents.LabelsDocument,
    "attempt": documents.AttemptReportDocument,
    "planned-point": documents.PlannedPointDocument,
    "timeline": documents.TimelineDocument,
}


def typed_dicts(annotation: Any, aliases: frozenset[Any] = frozenset()) -> list[Any]:
    """The TypedDicts an annotation holds, through aliases (`JsonValue` refers to itself),
    unions, lists and maps."""
    if isinstance(annotation, typing.TypeAliasType):
        if annotation in aliases:
            return []
        return typed_dicts(annotation.__value__, aliases | {annotation})
    if typing.is_typeddict(annotation):
        return [annotation]
    return [
        found
        for argument in typing.get_args(annotation)
        for found in typed_dicts(argument, aliases)
    ]


def object_schemas(schema: dict[str, Any]) -> list[dict[str, Any]]:
    """The object schemas with properties a property's schema holds: itself, its anyOf or
    oneOf branches, its items, or a map's values."""
    if "properties" in schema:
        return [schema]
    found = []
    for branch in schema.get("anyOf", []) + schema.get("oneOf", []):
        found += object_schemas(branch)
    for nested in (schema.get("items"), schema.get("additionalProperties")):
        if isinstance(nested, dict):
            found += object_schemas(nested)
    return found


def compare(typed_dict: Any, schema: dict[str, Any], where: str) -> None:
    properties = schema["properties"]
    declared = typed_dict.__required_keys__ | typed_dict.__optional_keys__
    assert typed_dict.__required_keys__ == set(schema.get("required", [])), where
    if schema.get("additionalProperties") is False:
        assert declared == set(properties), where
    else:
        assert set(properties) <= declared, where
    hints = typing.get_type_hints(typed_dict)
    for key, property_schema in properties.items():
        nested_schemas = object_schemas(property_schema)
        nested_types = typed_dicts(hints[key])
        assert len(nested_types) == len(nested_schemas), f"{where}.{key}"
        for nested_type, nested_schema in zip(nested_types, nested_schemas, strict=True):
            compare(nested_type, nested_schema, f"{where}.{key}")


@pytest.mark.parametrize("kind", sorted(ROOTS))
def test_each_document_type_matches_its_schema(kind):
    schema = json.loads((SCHEMAS / f"{kind}.schema.json").read_text(encoding="utf-8"))
    compare(ROOTS[kind], schema, kind)


def test_every_schema_has_a_document_type():
    assert {
        path.name.removesuffix(".schema.json") for path in SCHEMAS.glob("*.schema.json")
    } == set(ROOTS)


def test_a_drifted_type_fails_the_comparison():
    schema = json.loads((SCHEMAS / "point.schema.json").read_text(encoding="utf-8"))
    schema["properties"]["runtime"]["properties"]["extra"] = {"type": "string"}
    schema["properties"]["runtime"]["required"].append("extra")
    with pytest.raises(AssertionError, match="point.runtime"):
        compare(documents.PointDocument, schema, "point")
