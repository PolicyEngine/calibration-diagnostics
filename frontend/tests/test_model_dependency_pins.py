""".py is the only declared model dependency; its `us` extra supplies the rest."""

import json
import re
import tomllib
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PINNED_PY_REQUIREMENT = "policyengine[us]==6.7.5"
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


def test_hosted_requirements_pin_only_policyengine_py_6_7_5():
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
    assert reviewed_packages["policyengine"] == "6.7.5"
    for package, version in reviewed_packages.items():
        assert locked_versions.get(package) == version, package


def root_project_requirements() -> dict[str, list[Requirement]]:
    """Every requirement list the root project declares, keyed by its location."""
    project_file = tomllib.loads((REPOSITORY_ROOT / "pyproject.toml").read_text())
    project = project_file["project"]
    requirement_lists = {"dependencies": project.get("dependencies", [])}
    for extra, requirements in project.get("optional-dependencies", {}).items():
        requirement_lists[f"optional-dependencies.{extra}"] = requirements
    for group, requirements in project_file.get("dependency-groups", {}).items():
        requirement_lists[f"dependency-groups.{group}"] = requirements
    return {
        location: [Requirement(text) for text in requirements]
        for location, requirements in requirement_lists.items()
    }


def test_root_project_pins_only_policyengine_py_6_7_5():
    requirement_lists = root_project_requirements()
    for location, requirements in requirement_lists.items():
        names = {canonicalize_name(requirement.name) for requirement in requirements}
        assert not names & PY_DERIVED_PACKAGES, location
    assert_only_pinned_py_declares_the_model(
        requirement_lists["optional-dependencies.microcosm"]
    )


def test_root_lock_resolves_the_hosted_py_tuple():
    root_lock = tomllib.loads((REPOSITORY_ROOT / "uv.lock").read_text())
    locked_versions = {
        canonicalize_name(package["name"]): package["version"]
        for package in root_lock["package"]
        if "version" in package
    }
    reviewed_packages = json.loads(
        (REPOSITORY_ROOT / "frontend/scripts/hosted_release.json").read_text()
    )["packages"]
    for package, version in reviewed_packages.items():
        assert locked_versions.get(package) == version, package
