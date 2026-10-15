"""The variable catalog comes from the pinned .py model and the reviewed dataset."""

import hashlib
import importlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

FRONTEND = Path(__file__).resolve().parents[1]
CHECKED_IN_CATALOG = FRONTEND / "public" / "variable-catalog.json"


@pytest.fixture
def generator(monkeypatch):
    monkeypatch.syspath_prepend(str(FRONTEND))
    return importlib.import_module("scripts.generate_variable_catalog")


@pytest.fixture
def hosted_release(monkeypatch):
    monkeypatch.syspath_prepend(str(FRONTEND))
    return importlib.import_module("scripts.hosted_release")


def checked_in_catalog_names() -> set[str]:
    catalog = json.loads(CHECKED_IN_CATALOG.read_text())
    return {entry["name"] for entry in catalog["variables"]}


def test_catalog_refuses_an_unreviewed_dataset_file(
    generator, hosted_release, monkeypatch, tmp_path
):
    import policyengine_us

    unreviewed_population = tmp_path / "unreviewed.h5"
    unreviewed_population.write_bytes(b"not the certified population")
    monkeypatch.setattr(
        policyengine_us,
        "Microsimulation",
        lambda **kwargs: pytest.fail("No simulation for unreviewed bytes"),
    )
    with pytest.raises(hosted_release.VariableCalculationError, match="SHA-256"):
        generator.main(
            [
                "--dataset-file",
                str(unreviewed_population),
                "--output",
                str(tmp_path / "variable-catalog.json"),
            ]
        )


def test_catalog_simulation_reads_the_reviewed_dataset(
    generator, hosted_release, monkeypatch, tmp_path
):
    import policyengine_us

    reviewed_population = tmp_path / "reviewed.h5"
    reviewed_population.write_bytes(b"reviewed population fixture")
    reviewed = hosted_release.reviewed_release()
    reviewed["sha256"] = hashlib.sha256(reviewed_population.read_bytes()).hexdigest()
    monkeypatch.setattr(generator, "reviewed_release", lambda: reviewed, raising=False)
    monkeypatch.setattr(
        generator,
        "single_year_simulation_dataset",
        lambda dataset_path: ("one-year input", dataset_path),
        raising=False,
    )
    simulation_datasets = []

    class RecordingSimulation:
        def __init__(self, dataset=None):
            simulation_datasets.append(dataset)
            self.tax_benefit_system = SimpleNamespace(
                variables={
                    "takes_up_wic_if_eligible": SimpleNamespace(
                        label="Whether an eligible person takes up WIC",
                        entity=SimpleNamespace(key="person"),
                        unit=None,
                    )
                }
            )

    monkeypatch.setattr(policyengine_us, "Microsimulation", RecordingSimulation)
    output = tmp_path / "variable-catalog.json"
    generator.main(
        ["--dataset-file", str(reviewed_population), "--output", str(output)]
    )

    assert simulation_datasets == [("one-year input", str(reviewed_population))]
    catalog = json.loads(output.read_text())
    assert catalog["release_id"] == reviewed["release_id"]
    assert catalog["packages"] == reviewed["packages"]
    assert catalog["variables"] == [
        {
            "name": "takes_up_wic_if_eligible",
            "label": "Whether an eligible person takes up WIC",
            "entity": "person",
            "unit": None,
        }
    ]


def test_checked_in_catalog_matches_the_pinned_model(hosted_release):
    from policyengine_us.system import system

    reviewed = hosted_release.reviewed_release()
    catalog = json.loads(CHECKED_IN_CATALOG.read_text())
    assert catalog["release_id"] == reviewed["release_id"]
    assert catalog["packages"] == reviewed["packages"]
    assert catalog["count"] == len(catalog["variables"])
    assert checked_in_catalog_names() == set(system.variables)


def test_catalog_offers_renamed_and_deployment_check_variables():
    catalog_names = checked_in_catalog_names()
    # policyengine-us 2.x renamed the WIC take-up input.
    assert "would_claim_wic" not in catalog_names
    assert "takes_up_wic_if_eligible" in catalog_names
    assert {"spm_unit_spm_threshold", "ca_income_tax"} <= catalog_names
