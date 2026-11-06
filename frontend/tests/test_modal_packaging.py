"""Exercise Modal's remote module import and the local image definition."""

import importlib
import sys
from unittest.mock import MagicMock, patch

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


def test_local_image_replaces_pip_after_the_ca_store_upgrade(monkeypatch):
    """The base's pip downloads only the hash-pinned pip that replaces it."""
    monkeypatch.setenv("CALIBRATION_MODAL_APP_NAME", "isolated-packaging-test")
    sys.modules.pop("backend.modal_app", None)
    base_image = MagicMock(name="debian_slim")
    # git status (clean), git rev-parse HEAD, git ls-tree, in deployment_identity.
    git_outputs = ["", "a" * 40 + "\n", b"100644 blob 0\tbackend/app.py\n"]
    with (
        patch.object(modal, "is_local", return_value=True),
        patch("subprocess.check_output", side_effect=git_outputs),
        patch.object(modal.Image, "debian_slim", return_value=base_image),
        patch.object(modal, "App"),
    ):
        module = importlib.import_module("backend.modal_app")
    sys.modules.pop("backend.modal_app", None)

    image_steps = [
        (call_name.rsplit(".", 1)[-1], call_args)
        for call_name, call_args, _ in base_image.mock_calls
    ]
    ca_upgrade_index = image_steps.index(("apt_install", ("ca-certificates",)))
    bootstrap_index = image_steps.index(
        ("run_commands", (module.PIP_BOOTSTRAP_COMMAND,))
    )
    package_install_indexes = [
        step_index
        for step_index, (step_name, step_args) in enumerate(image_steps)
        if step_name.startswith("pip_install")
        or (
            step_name == "run_commands"
            and step_index != bootstrap_index
            and any("pip install" in str(command) for command in step_args)
        )
    ]
    assert package_install_indexes
    assert ca_upgrade_index < bootstrap_index < min(package_install_indexes)
    assert module.PIP_BOOTSTRAP_COMMAND == (
        "printf '%s\\n' 'pip==26.2.2 --hash=sha256:"
        "fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70'"
        " > /tmp/pip-bootstrap.txt"
        " && python -m pip install --require-hashes --no-deps"
        " -r /tmp/pip-bootstrap.txt"
        " && rm /tmp/pip-bootstrap.txt"
    )
