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
DEFAULT_PIPELINE_ID = "us-data"

PIPELINES = {
    "us-data": {
        "label": "policyengine-us-data",
        "description": "Extracted @pipeline_node DAG from policyengine_us_data.",
        "nodes_path": DATA_ROOT / "nodes.json",
        "docs_dir": DATA_ROOT / "stages",
        "stage_labels": {
            "1_build_datasets": "1. Build datasets",
            "2_build_calibration_package": "2. Build calibration package",
            "3_fit_weights": "3. Fit weights",
            "4_build_outputs": "4. Build outputs",
            "5_validate_and_promote_release": "5. Validate & promote release",
        },
    },
    "microplex-us": {
        "label": "Microplex-US",
        "description": (
            "Curated US Microplex flow from source fusion through "
            "PolicyEngine oracle evaluation and published diagnostics."
        ),
        "nodes_path": DATA_ROOT / "microplex.json",
        "docs_dir": DATA_ROOT / "microplex" / "stages",
        "stage_labels": {
            "01_run_profile": "1. Run profile",
            "02_source_loading": "2. Source loading",
            "03_source_planning": "3. Source planning",
            "04_seed_scaffold": "4. Seed scaffold",
            "05_donor_integration_synthesis": "5. Donor integration",
            "06_policyengine_entities": "6. PolicyEngine entities",
            "07_calibration": "7. Calibration",
            "08_dataset_assembly": "8. Dataset assembly",
            "09_validation_benchmarking": "9. Validation & benchmarking",
        },
    },
}


def _pipeline_config(pipeline_id: str | None) -> dict:
    selected = pipeline_id or DEFAULT_PIPELINE_ID
    config = PIPELINES.get(selected)
    if config is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown pipeline '{selected}'",
        )
    return {"id": selected, **config}


def _load_nodes(pipeline_id: str | None = None) -> dict:
    config = _pipeline_config(pipeline_id)
    path = config["nodes_path"]
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                "Pipeline DAG hasn't been extracted yet. Run "
                "`python backend/scripts/extract_pipeline_dag.py`."
            ),
        )
    return json.loads(path.read_text())


@router.get("/pipeline")
def get_pipeline(
    pipeline_id: str | None = None,
    pipeline: str | None = None,
):
    """Full DAG: nodes, edges, stats. Grouped by both stage (canonical) and
    pathway (legacy) for the frontend."""
    selected_pipeline = pipeline_id or pipeline or DEFAULT_PIPELINE_ID
    config = _pipeline_config(selected_pipeline)
    payload = _load_nodes(selected_pipeline)
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

    stages_dir = config["docs_dir"]
    has_doc: dict[str, bool] = {}
    if stages_dir.exists():
        for path in stages_dir.glob("*.md"):
            has_doc[path.stem] = True

    stage_summary = [
        {
            "id": sid,
            "label": config["stage_labels"].get(sid, sid),
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
        "pipeline_id": selected_pipeline,
        "pipeline_label": payload.get("pipeline_label", config["label"]),
        "description": payload.get("description", config["description"]),
        "source_repo": payload.get("source_repo"),
        "source_urls": payload.get("source_urls", []),
        "nodes": nodes,
        "edges": payload.get("edges", []),
        "unproduced_artifacts": payload.get("unproduced_artifacts", []),
        "stats": payload.get("stats", {}),
        "stages": stage_summary,
        "pathways": pathway_summary,
    }


@router.get("/pipeline/stages/{stage_id}")
def get_stage(
    stage_id: str,
    pipeline_id: str | None = None,
    pipeline: str | None = None,
):
    """Markdown deep-dive for a single pathway/stage."""
    selected_pipeline = pipeline_id or pipeline or DEFAULT_PIPELINE_ID
    config = _pipeline_config(selected_pipeline)
    safe = stage_id.replace("/", "").replace("..", "")
    md_path = config["docs_dir"] / f"{safe}.md"
    if not md_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No deep-dive doc for stage '{stage_id}'",
        )
    return {
        "pipeline_id": selected_pipeline,
        "stage_id": stage_id,
        "markdown": md_path.read_text(encoding="utf-8"),
    }
