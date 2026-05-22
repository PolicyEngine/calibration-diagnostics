"""Extract the pipeline DAG from policyengine_us_data via AST.

Walks the package, finds every `@pipeline_node(...)` decorator, pulls its
fields (handling both forms: keyword args and PipelineNode(...) literal),
and emits a structured JSON consumed by the dashboard.

Run from the repo root::

    python3.12 backend/scripts/extract_pipeline_dag.py

Output: backend/data/pipeline/nodes.json
"""

from __future__ import annotations

import ast
import importlib.util
import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


def _locate_package_root() -> Path:
    spec = importlib.util.find_spec("policyengine_us_data")
    if spec is None or spec.origin is None:
        raise RuntimeError("policyengine_us_data not installed")
    return Path(spec.origin).parent


def _literal(node: ast.AST) -> Any:
    """Best-effort literal eval, handling lists/tuples/dicts/strings/numbers."""
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError):
        # Fall back to a readable representation
        return ast.unparse(node)


def _extract_keywords(call: ast.Call) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for kw in call.keywords:
        if kw.arg is None:
            continue
        out[kw.arg] = _literal(kw.value)
    return out


def _is_pipeline_node_decorator(deco: ast.AST) -> ast.Call | None:
    """Return the inner Call node if `deco` is `@pipeline_node(...)`."""
    if not isinstance(deco, ast.Call):
        return None
    func = deco.func
    name = getattr(func, "attr", None) if isinstance(func, ast.Attribute) else getattr(func, "id", None)
    if name == "pipeline_node":
        return deco
    return None


def _node_from_decorator(deco_call: ast.Call) -> dict[str, Any]:
    """Build a node dict from a @pipeline_node(...) decorator call.

    Handles both forms:
        @pipeline_node(PipelineNode(id=..., label=..., ...))
        @pipeline_node(id=..., label=..., ...)
    """
    # Form 1: positional PipelineNode(...) literal
    if deco_call.args and isinstance(deco_call.args[0], ast.Call):
        inner = deco_call.args[0]
        if getattr(inner.func, "id", None) == "PipelineNode":
            return _extract_keywords(inner)
    # Form 2: kwargs directly on @pipeline_node
    return _extract_keywords(deco_call)


def _decorator_target_name(func_or_class: ast.AST) -> str:
    """The name of the function/class the decorator is attached to."""
    if isinstance(func_or_class, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return func_or_class.name
    return "<unknown>"


# --- 5-stage canonical taxonomy ---------------------------------------------
#
# The team uses 5 stages declared in policyengine_us_data.stage_contracts.stages:
#   STAGE_1_BUILD_DATASETS, STAGE_2_BUILD_CALIBRATION_PACKAGE,
#   STAGE_3_FIT_WEIGHTS, STAGE_4_BUILD_OUTPUTS, STAGE_5_VALIDATE_AND_PROMOTE_RELEASE.
#
# Pipeline nodes don't carry stage_id directly, so we map via pathway + a
# heuristic that splits local_h5 into Stage 4 (build) vs Stage 5 (validate/
# promote/release).

STAGE_BY_PATHWAY = {
    "data_build":          "1_build_datasets",
    "calibration_package": "2_build_calibration_package",
    "weight_fit":          "3_fit_weights",
    "local_h5":            "4_build_outputs",
}

STAGE_5_KEYWORDS = (
    "validate_", "atomic_promote", "publish_", "_promote",
    "release", "_sanity", "version_manifest",
)


def _stage_for_node(node: dict) -> str:
    """Best-effort mapping from a node's pathway + id to one of the 5
    canonical stages. Local_h5 nodes that look like validate/promote work
    are reclassified to Stage 5."""
    pathways = node.get("pathways") or []
    primary = pathways[0] if pathways else ""
    base_stage = STAGE_BY_PATHWAY.get(primary, "")

    # Promote local_h5 validate/release nodes to Stage 5.
    if base_stage == "4_build_outputs":
        nid = node.get("id") or ""
        src = node.get("source_file") or ""
        if any(kw in nid for kw in STAGE_5_KEYWORDS) or any(
            kw in src for kw in STAGE_5_KEYWORDS
        ):
            return "5_validate_and_promote_release"
    return base_stage


def extract_nodes(package_root: Path) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    seen_ids: list[str] = []
    for py in sorted(package_root.rglob("*.py")):
        if "__pycache__" in py.parts:
            continue
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except SyntaxError as exc:
            logger.warning("Skipping %s: %s", py, exc)
            continue
        for top in ast.walk(tree):
            decos = getattr(top, "decorator_list", None)
            if not decos:
                continue
            for deco in decos:
                call = _is_pipeline_node_decorator(deco)
                if call is None:
                    continue
                node = _node_from_decorator(call)
                if not node.get("id"):
                    # Skip the pure example decorators in pipeline_metadata.py
                    continue
                rel_source = py.relative_to(package_root.parent).as_posix()
                node.setdefault("source_file", rel_source)
                node["target_symbol"] = _decorator_target_name(top)
                node["decorator_line"] = deco.lineno
                node["stage_id"] = _stage_for_node(node)
                seen_ids.append(node["id"])
                nodes.append(node)
    return nodes


def build_edges(nodes: list[dict]) -> list[dict]:
    """Derive data-flow edges from artifacts_in/out.

    For every artifact A: node X produces A, node Y consumes A -> edge X→Y.
    """
    by_id: dict[str, dict] = {n["id"]: n for n in nodes}
    producers: dict[str, list[str]] = {}
    consumers: dict[str, list[str]] = {}

    for n in nodes:
        for art in (n.get("artifacts_out") or []):
            producers.setdefault(art, []).append(n["id"])
        for art in (n.get("artifacts_in") or []):
            consumers.setdefault(art, []).append(n["id"])

    edges: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for art, prods in producers.items():
        for cons_id in consumers.get(art, []):
            for prod_id in prods:
                if prod_id == cons_id:
                    continue
                key = (prod_id, cons_id, art)
                if key in seen:
                    continue
                seen.add(key)
                edges.append({
                    "from": prod_id,
                    "to": cons_id,
                    "artifact": art,
                    "kind": "data_flow",
                })

    # Artifacts that have no producer (purely external)
    unproduced = sorted(set(consumers.keys()) - set(producers.keys()))
    return edges, unproduced


def main():
    pkg_root = _locate_package_root()
    logger.info("Scanning %s", pkg_root)
    nodes = extract_nodes(pkg_root)
    edges, unproduced = build_edges(nodes)

    # Stats
    by_type = Counter(n.get("node_type", "?") for n in nodes)
    by_status = Counter(n.get("status", "?") for n in nodes)
    by_pathway = Counter()
    for n in nodes:
        for p in (n.get("pathways") or []):
            by_pathway[p] += 1
    by_stage = Counter(n.get("stage_id") or "(unknown)" for n in nodes)

    logger.info("Found %d nodes", len(nodes))
    logger.info("  by type: %s", dict(by_type))
    logger.info("  by status: %s", dict(by_status))
    logger.info("  by pathway: %s", dict(by_pathway))
    logger.info("  by stage:   %s", dict(by_stage))
    logger.info("Built %d edges (data-flow). Unproduced artifacts: %d",
                len(edges), len(unproduced))

    out_dir = Path("backend/data/pipeline")
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "nodes": nodes,
        "edges": edges,
        "unproduced_artifacts": unproduced,
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "by_type": dict(by_type),
            "by_status": dict(by_status),
            "by_pathway": dict(by_pathway),
            "by_stage": dict(by_stage),
        },
    }
    out_path = out_dir / "nodes.json"
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    logger.info("Wrote %s", out_path)


if __name__ == "__main__":
    main()
