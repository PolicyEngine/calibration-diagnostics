"""Capture metadata in the existing serving process, before any population work.

A lightweight child proves interpreter inheritance, not a population calculation.
Actual Modal call/input IDs need external control-plane correlation.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def validate_nonce(nonce):
    """Reject unbounded or ambiguous audit input before starting a child."""
    if (
        not isinstance(nonce, str)
        or re.fullmatch(r"[A-Za-z0-9_-]{16,128}", nonce) is None
    ):
        raise ValueError("A bounded audit nonce is required")


def serving_witness(nonce):
    import modal

    validate_nonce(nonce)
    cfg = Path(sys.prefix) / "pyvenv.cfg"
    cfg_bytes = cfg.read_bytes() if cfg.is_file() else None
    cfg_fields = {}
    if cfg_bytes is not None:
        for line in cfg_bytes.decode().splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in {
                "home",
                "implementation",
                "version",
                "version_info",
                "include-system-site-packages",
                "uv",
            }:
                cfg_fields[key.strip()] = value.strip()
    child_code = """import importlib.metadata as metadata
import json, os, sys
from pathlib import Path
packages = {}
for name in ("policyengine", "policyengine-us", "policyengine-core", "spm-calculator"):
    try:
        packages[name] = metadata.version(name)
    except metadata.PackageNotFoundError:
        packages[name] = None
print(json.dumps({"pid": os.getpid(), "executable": sys.executable,
                  "prefix": sys.prefix, "base_prefix": sys.base_prefix,
                  "sys_path": sys.path, "packages": packages,
                  "resolved_sys_path": [
                      str(Path(p or os.getcwd()).resolve()) for p in sys.path]}))
"""
    child = subprocess.run(
        [sys.executable, "-B", "-c", child_code],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if child.returncode:
        raise RuntimeError("Audit child failed")
    names = (
        "modal",
        "backend.app",
        "backend.variable_endpoint",
        "backend.runtime_audit",
        "scripts.runtime_identity",
        "policyengine_us",
        "policyengine_core",
        "spm_calculator",
    )
    function_call_id = modal.current_function_call_id()
    input_id = modal.current_input_id()
    return {
        "nonce": nonce,
        "modal_context_available": bool(function_call_id and input_id),
        "pid": os.getpid(),
        "function_call_id": function_call_id,
        "input_id": input_id,
        "executable": sys.executable,
        "prefix": sys.prefix,
        "base_prefix": sys.base_prefix,
        "sys_path": list(sys.path),
        "resolved_sys_path": [str(Path(p or os.getcwd()).resolve()) for p in sys.path],
        "child": json.loads(child.stdout),
        "pyvenv_cfg": {
            "path": str(cfg),
            "exists": cfg_bytes is not None,
            "sha256": hashlib.sha256(cfg_bytes).hexdigest()
            if cfg_bytes is not None
            else None,
            "fields": cfg_fields,
        },
        "module_origin_note": (
            "Null means not loaded in this process, not an absent distribution. "
            "Child package versions are metadata only, not evidence of model execution."
        ),
        "already_loaded_module_origins": {
            name: getattr(sys.modules.get(name), "__file__", None) for name in names
        },
    }
