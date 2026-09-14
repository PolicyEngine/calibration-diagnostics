"""Exercise Modal's remote module import without local Git or image build steps."""

import importlib
import sys
from unittest.mock import patch

import modal


def test_remote_module_import_requires_no_git_or_local_sources(monkeypatch):
    monkeypatch.setenv("CALIBRATION_MODAL_APP_NAME", "isolated-packaging-test")
    monkeypatch.setenv("CALIBRATION_SOURCE_COMMIT", "a" * 40)
    monkeypatch.setenv("CALIBRATION_SOURCE_TREE_SHA256", "b" * 64)
    sys.modules.pop("backend.modal_app", None)
    with (
        patch.object(modal, "is_local", return_value=False),
        patch(
            "subprocess.check_output",
            side_effect=AssertionError("No Git in remote container"),
        ),
        patch.object(
            modal.Image,
            "add_local_dir",
            side_effect=AssertionError("No local source mounts in remote container"),
        ),
    ):
        module = importlib.import_module("backend.modal_app")
    assert module.app.name == "isolated-packaging-test"
    assert module.web_app is not None
    sys.modules.pop("backend.modal_app", None)
