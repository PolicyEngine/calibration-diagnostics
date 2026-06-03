# Source Loading

This stage turns survey-specific files into Microplex observation frames with explicit source descriptors, entity relationships, and variable capability metadata.

## Inputs

- Resolved provider/query plan.
- Raw CPS, PUF, and donor-source extracts.
- Source metadata and mappings.

## Outputs

- Observation frames.
- Source descriptors.
- Entity relationship metadata.

## Analyst Checks

- Identify which source owns each variable.
- Check whether variables are native to the scaffold or donor-only.
- Check that entity IDs and source units are preserved where later projection depends on them.

