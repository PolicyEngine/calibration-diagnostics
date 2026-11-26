"""The JSON Schemas in `release_history/schemas/`, for tests to hold documents to."""

import json
from functools import cache
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMAS = Path(__file__).parents[1] / "schemas"


@cache
def validator(kind: str) -> Draft202012Validator:
    """The validator of `<kind>.schema.json`, itself checked against draft 2020-12."""
    document = json.loads((SCHEMAS / f"{kind}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(document)
    return Draft202012Validator(document)


def errors(kind: str, document: object) -> list[str]:
    return [error.message for error in validator(kind).iter_errors(document)]
