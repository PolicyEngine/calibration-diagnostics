"""Deploy the pinned calculation runtime; never deploy under an implicit app name."""

import hashlib
import os
import subprocess
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]


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
    memory=(8192, 8192),
    timeout=800,
    max_containers=1,
    scaledown_window=60,
)
@modal.concurrent(max_inputs=1)
@modal.asgi_app(requires_proxy_auth=True)
def web_app():
    from backend.app import app as api

    return api
