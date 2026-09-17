# AI-assistant investigation documentation

These documents define tool-independent procedures for investigating Microcosm
calibration targets and maintaining the dashboard's published calibration-tree
artifacts. Microcosm release identifiers still use the deprecated
`populace-us-*` prefix.

## When to use each document

- For the complete investigation sequence and report format, follow [Investigate a Microcosm target](workflows/investigate-microcosm-target.md).
- For a shorter reusable checklist, use [Microcosm target investigation checklist](checklists/microcosm-target-investigation.md).
- To build, publish, replace, or diagnose calibration-tree files, follow
  [Publish calibration tree artifacts](workflows/publish-calibration-tree-artifacts.md)
  and its [publication checklist](checklists/calibration-tree-publication.md).
- When several reviewers can inspect separate technical areas, assign the relevant documents in [roles](roles/):
  - [Investigation coordinator](roles/microcosm-investigation-supervisor.md)
  - [Chronicle and source-data review](roles/microcosm-chronicle-auditor.md)
  - [Target materialization review](roles/microcosm-materialization-auditor.md)
  - [PolicyEngine model-variable review](roles/policyengine-model-auditor.md)
  - [Calibration calculation review](roles/microcosm-calibration-auditor.md)

The procedure begins with a machine-readable target investigation packet and uses release artifacts and source code as evidence. The dashboard is useful for locating a discrepancy, but its rendered output is not sufficient evidence for a root-cause conclusion.
