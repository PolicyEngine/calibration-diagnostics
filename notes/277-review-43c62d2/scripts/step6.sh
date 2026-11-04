#!/bin/bash
# Step 6: export the private helpers in a scratch copy of 43c62d2 and run the
# generated-input checks. Usage: step6.sh <scratch-worktree-at-43c62d2>
set -e
S=/tmp/claude-0/-home-user-calibration-diagnostics/e3fd4703-49ed-5a1b-996e-6eb38a998eb6/scratchpad
W=$1
P=$W/frontend/packages/calibration-tree/src
git -C "$W" checkout -q -- .
printf '\nexport { categoryLevels as __categoryLevels, computeDimensions as __computeDimensions, countOrNull as __countOrNull, repeatsGeography as __repeatsGeography };\n' >> $P/latest-artifact.ts
cp $S/scripts/${TESTFILE:-step6_invariants.test.ts} $P/step6-invariants.test.ts
cd $W/frontend && bun test packages/calibration-tree/src/step6-invariants.test.ts || true
rm $P/step6-invariants.test.ts
git -C "$W" checkout -q -- .
