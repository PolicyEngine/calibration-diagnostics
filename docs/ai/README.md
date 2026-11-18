# AI-assistant investigation documentation

These documents define tool-independent procedures for investigating Microcosm
calibration targets. Microcosm release identifiers still use the deprecated
`populace-us-*` prefix.

## When to use each document

- For the complete investigation sequence and report format, follow [Investigate a Microcosm target](workflows/investigate-microcosm-target.md).
- For a shorter reusable checklist, use [Microcosm target investigation checklist](checklists/microcosm-target-investigation.md).
- To diagnose the calibration-tree files the dashboard reads, start from
  [Calibration build and comparison artifacts](../calibration-tree-artifacts.md).
  The collector builds and publishes them ([PolicyEngine/microcosm-collector](https://github.com/PolicyEngine/microcosm-collector)).
  Treat Blob deletion and manifest changes as external state changes that need
  explicit authorization, and never print Blob, Hugging Face or webhook secrets.
- When several reviewers can inspect separate technical areas, assign the relevant documents in [roles](roles/):
  - [Investigation coordinator](roles/microcosm-investigation-supervisor.md)
  - [Chronicle and source-data review](roles/microcosm-chronicle-auditor.md)
  - [Target materialization review](roles/microcosm-materialization-auditor.md)
  - [PolicyEngine model-variable review](roles/policyengine-model-auditor.md)
  - [Calibration calculation review](roles/microcosm-calibration-auditor.md)

The procedure begins with a machine-readable target investigation packet and uses release artifacts and source code as evidence. The dashboard is useful for locating a discrepancy, but its rendered output is not sufficient evidence for a root-cause conclusion.
