# Progress

## State

The harness now rejects noncanonical partition manifests and fact pages whose
attested bodies disagree with their descriptors. Publisher hardening remains.

## Done

- Read the PR C contract in `DESIGN_BRIEF.md`.
- Confirmed the worktree is clean at `3fda1f0`.
- Rejected unknown partition keys, dot path components, and duplicate paths.
- Mirrored frontend fact-page metadata and row-count validation.
- Added correctly hashed corrupt-page and noncanonical-manifest tests.

## Next

- Snapshot verified bundle bytes and publish those immutable snapshots.
- Require remote size equality for idempotent skips.
- Cover a missing `huggingface_hub` install in a subprocess test.
- Run the complete test suite and required BE dry run.
- Write the final report to the requested output file.
