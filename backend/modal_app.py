"""Deploy the pinned calculation runtime; never deploy under an implicit app name."""

import hashlib
import os
import subprocess
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
# Modal's cached debian_slim base for Python 3.12 carries pip 26.1.2, whose
# bundled certifi (2026.02.25) still contains the compromised eMudhra root
# "emSign ECC Root CA - G3"; --cert or PIP_CERT only add to that trust. The
# image replaces it with pip 26.2.2, whose bundled certifi (2026.10.19) drops
# the root, before it installs anything else. --require-hashes accepts only
# the wheel with the sha256 PyPI publishes, whatever certificate the
# connection presents.
PIP_VERSION = "26.2.2"
PIP_WHEEL_SHA256 = "fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70"
PIP_BOOTSTRAP_COMMAND = (
    f"printf '%s\\n' 'pip=={PIP_VERSION} --hash=sha256:{PIP_WHEEL_SHA256}'"
    " > /tmp/pip-bootstrap.txt"
    " && python -m pip install --require-hashes --no-deps -r /tmp/pip-bootstrap.txt"
    " && rm /tmp/pip-bootstrap.txt"
)


def deployment_identity() -> tuple[str, str]:
    """Bind the installed source to a clean Git commit before image creation."""
    paths = ["backend", "frontend/scripts"]
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=all", "--", *paths],
        cwd=ROOT,
        text=True,
    )
    if dirty:
        raise RuntimeError("Commit the calculation runtime before deploying its image.")
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    tree = subprocess.check_output(
        ["git", "ls-tree", "-r", "HEAD", "--", *paths], cwd=ROOT
    )
    return commit, hashlib.sha256(tree).hexdigest()


app_name = os.environ["CALIBRATION_MODAL_APP_NAME"]
app = modal.App(app_name)
image = None
if modal.is_local():
    source_commit, source_tree_sha256 = deployment_identity()
    image = (
        modal.Image.debian_slim(python_version="3.12")
        # Modal's prebuilt Debian base keeps the ca-certificates package it was
        # built with. Install the current one so clients that read the
        # operating-system CA store, such as hf-xet, stop trusting roots Debian
        # has since removed. Modal caches this step; force a rebuild to refresh it.
        .apt_install("ca-certificates")
        # pip reads that store as well as its own certifi, so it is replaced
        # after the upgrade and before it downloads any package.
        .run_commands(PIP_BOOTSTRAP_COMMAND)
        .pip_install_from_requirements(str(ROOT / "backend/requirements.lock"))
        .add_local_dir(
            str(ROOT / "frontend/scripts"),
            "/root/scripts",
            copy=True,
            ignore=["**/__pycache__/**", "**/*.pyc"],
        )
        .add_local_dir(
            str(ROOT / "backend"),
            "/root/backend",
            copy=True,
            ignore=["**/__pycache__/**", "**/*.pyc"],
        )
        .env(
            {
                "CALIBRATION_SOURCE_COMMIT": source_commit,
                "CALIBRATION_MODAL_APP_NAME": app_name,
                "CALIBRATION_SOURCE_TREE_SHA256": source_tree_sha256,
                "CALIBRATION_REQUIREMENTS": "/root/backend/requirements.txt",
                "PYTHONPATH": "/root",
            }
        )
        .run_commands("python /root/scripts/verify_hosted_runtime.py")
    )
else:
    # Modal imports this definition inside a container without Git or the checkout.
    # Source identity was bound into the image by the clean local deployment.
    if not os.environ.get("CALIBRATION_SOURCE_COMMIT") or not os.environ.get(
        "CALIBRATION_SOURCE_TREE_SHA256"
    ):
        raise RuntimeError("The packaged calculation source identity is missing.")


@app.function(
    image=image,
    cpu=2.0,
    memory=(16384, 16384),
    timeout=800,
    max_containers=1,
    scaledown_window=60,
)
@modal.concurrent(max_inputs=1)
@modal.asgi_app(requires_proxy_auth=True)
def web_app():
    from backend.app import app as api

    return api
