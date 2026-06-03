from backend.routes.pipeline import get_pipeline, get_stage


def test_pipeline_defaults_to_us_data():
    result = get_pipeline()

    assert result["pipeline_id"] == "us-data"
    assert result["nodes"]
    assert result["stages"]


def test_pipeline_serves_microplex_dag_and_docs():
    result = get_pipeline(pipeline_id="microplex-us")

    assert result["pipeline_id"] == "microplex-us"
    assert result["pipeline_label"] == "Microplex-US"
    assert result["stats"]["node_count"] == 16
    assert [stage["id"] for stage in result["stages"]][0] == "01_run_profile"
    assert any(node["id"] == "oracle_evaluation" for node in result["nodes"])

    doc = get_stage("09_validation_benchmarking", pipeline_id="microplex-us")

    assert doc["pipeline_id"] == "microplex-us"
    assert "target oracle" in doc["markdown"]
