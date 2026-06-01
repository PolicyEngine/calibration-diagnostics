"""Tests for per-bundle H5 path resolution."""

from pathlib import Path
from unittest.mock import patch

from backend.services.bundle_eval import _h5_local_path


def test_current_staging_bundle_downloads_from_top_level_staging(tmp_path):
    downloaded = tmp_path / "cache" / "staging" / "states" / "WY.h5"
    downloaded.parent.mkdir(parents=True)
    downloaded.write_bytes(b"h5")

    with patch("huggingface_hub.hf_hub_download", return_value=str(downloaded)) as hf:
        local = _h5_local_path(
            "PolicyEngine/test",
            "staging",
            "states/WY.h5",
            str(tmp_path / "cache"),
        )

    hf.assert_called_once()
    assert hf.call_args.kwargs["filename"] == "staging/states/WY.h5"
    assert local == (
        Path(tmp_path)
        / "cache"
        / "PolicyEngine__test"
        / "staging"
        / "staging"
        / "states"
        / "WY.h5"
    )
    assert local.read_bytes() == b"h5"
