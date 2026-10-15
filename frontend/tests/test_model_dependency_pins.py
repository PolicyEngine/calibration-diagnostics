""".py is the only declared model dependency; its `us` extra supplies the rest."""

import json
import re
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PINNED_PY_REQUIREMENT = "policyengine[us]==6.4.1"
PY_DERIVED_PACKAGES = {"policyengine-us", "policyengine-core", "spm-calculator"}
LOCK_PIN = re.compile(r"^([A-Za-z0-9_.\-]+)==([^\s\\;]+)")


def declared_requirements(lines: list[str]) -> list[Requirement]:
    """Parse requirement lines, ignoring comments and blank lines."""
    requirements = []
    for line in lines:
        text = line.split("#", 1)[0].strip()
        if text:
            requirements.append(Requirement(text))
    return requirements


def assert_only_pinned_py_declares_the_model(requirements: list[Requirement]) -> None:
    declared_names = {
        canonicalize_name(requirement.name) for requirement in requirements
    }
    bare_model_pins = declared_names & PY_DERIVED_PACKAGES
    assert not bare_model_pins, f"Pin .py instead of {sorted(bare_model_pins)}"
    py_requirements = [
        str(requirement)
        for requirement in requirements
        if canonicalize_name(requirement.name) == "policyengine"
    ]
    assert py_requirements == [PINNED_PY_REQUIREMENT]


def test_hosted_requirements_pin_only_policyengine_py_6_4_1():
    hosted_requirements = (REPOSITORY_ROOT / "backend/requirements.txt").read_text()
    assert_only_pinned_py_declares_the_model(
        declared_requirements(hosted_requirements.splitlines())
    )


def test_hosted_lock_installs_the_reviewed_py_tuple():
    lock_text = (REPOSITORY_ROOT / "backend/requirements.lock").read_text()
    locked_versions = {
        canonicalize_name(match.group(1)): match.group(2)
        for line in lock_text.splitlines()
        if (match := LOCK_PIN.match(line))
    }
    reviewed_packages = json.loads(
        (REPOSITORY_ROOT / "frontend/scripts/hosted_release.json").read_text()
    )["packages"]
    assert reviewed_packages["policyengine"] == "6.4.1"
    for package, version in reviewed_packages.items():
        assert locked_versions.get(package) == version, package
