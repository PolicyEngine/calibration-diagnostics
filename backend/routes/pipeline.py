"""Endpoints serving the extracted pipeline DAG + per-stage deep-dives.

The data is committed under backend/data/pipeline/. Run the AST extractor
(`backend/scripts/extract_pipeline_dag.py`) to refresh nodes.json when
policyengine_us_data is upgraded; per-stage markdown is hand- or
agent-authored.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA_ROOT = Path(__file__).resolve().parents[1] / "data" / "pipeline"


def _load_nodes() -> dict:
    path = DATA_ROOT / "nodes.json"
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                "Pipeline DAG hasn't been extracted yet. Run "
                "`python backend/scripts/extract_pipeline_dag.py`."
            ),
        )
    return json.loads(path.read_text())


# Canonical 5-stage taxonomy from
# policyengine_us_data.stage_contracts.stages. Label is the human form.
STAGE_LABELS = {
    "1_build_datasets":                 "1. Build datasets",
    "2_build_calibration_package":      "2. Build calibration package",
    "3_fit_weights":                    "3. Fit weights",
    "4_build_outputs":                  "4. Build outputs",
    "5_validate_and_promote_release":   "5. Validate & promote release",
}


@router.get("/pipeline")
def get_pipeline():
    """Full DAG: nodes, edges, stats. Grouped by both stage (canonical) and
    pathway (legacy) for the frontend."""
    payload = _load_nodes()
    nodes = payload["nodes"]

    # Group by stage (canonical 5-stage taxonomy)
    stages: dict[str, list[str]] = {}
    for n in nodes:
        sid = n.get("stage_id") or "(unknown)"
        stages.setdefault(sid, []).append(n["id"])

    # Group by pathway (legacy; kept so existing pathway docs still surface)
    pathways: dict[str, list[str]] = {}
    for n in nodes:
        for p in (n.get("pathways") or ["(none)"]):
            pathways.setdefault(p, []).append(n["id"])

    stages_dir = DATA_ROOT / "stages"
    has_doc: dict[str, bool] = {}
    if stages_dir.exists():
        for path in stages_dir.glob("*.md"):
            has_doc[path.stem] = True

    stage_summary = [
        {
            "id": sid,
            "label": STAGE_LABELS.get(sid, sid),
            "node_count": len(ids),
            "has_doc": has_doc.get(sid, False),
        }
        for sid, ids in sorted(stages.items())
    ]
    pathway_summary = [
        {
            "id": p,
            "label": p.replace("_", " ").title(),
            "node_count": len(ids),
            "has_doc": has_doc.get(p, False),
        }
        for p, ids in sorted(pathways.items())
    ]
    return {
        "nodes": nodes,
        "edges": payload.get("edges", []),
        "unproduced_artifacts": payload.get("unproduced_artifacts", []),
        "stats": payload.get("stats", {}),
        "stages": stage_summary,
        "pathways": pathway_summary,
    }


@router.get("/pipeline/stages/{stage_id}")
def get_stage(stage_id: str):
    """Markdown deep-dive for a single pathway/stage."""
    safe = stage_id.replace("/", "").replace("..", "")
    md_path = DATA_ROOT / "stages" / f"{safe}.md"
    if not md_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No deep-dive doc for stage '{stage_id}'",
        )
    return {
        "stage_id": stage_id,
        "markdown": md_path.read_text(encoding="utf-8"),
    }
