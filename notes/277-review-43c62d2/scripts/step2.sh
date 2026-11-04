#!/bin/bash
# Step 2: run each test commit's changed test files at the test commit and at the fix.
S=/tmp/claude-0/-home-user-calibration-diagnostics/e3fd4703-49ed-5a1b-996e-6eb38a998eb6/scratchpad
W=$S/walk
cd /home/user/calibration-diagnostics
for p in "1 4ea7712 8771c0a" "2 567274f 1da6cc0" "3 49f397e f4e1ef5" "4 6843fe0 a5e604e" "6 45b72e0 43c62d2"; do
  set -- $p; item=$1; t=$2; f=$3
  files=$(git diff --name-only $t^ $t | grep '\.test\.ts$' | sed 's#^frontend/##')
  for c in $t $f; do
    git -C $W checkout -q --detach $c
    echo "=== item $item at $c ($(git log -1 --format=%s $c))"
    (cd $W/frontend && bun test $files 2>&1) > $S/logs/step2-item$item-$c.log
    grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)$" $S/logs/step2-item$item-$c.log
  done
  # The test commit's tests against the fix's code, where the fix also edits tests.
  if git diff --name-only $t $f | grep -q '\.test\.ts$'; then
    git -C $W checkout -q --detach $f
    for x in $files; do git -C $W show $t:frontend/$x > $W/frontend/$x; done
    echo "=== item $item: test commit $t's tests on fix $f's code"
    (cd $W/frontend && bun test $files 2>&1) > $S/logs/step2-item$item-testcommit-tests-on-$f.log
    grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)$" $S/logs/step2-item$item-testcommit-tests-on-$f.log
    git -C $W checkout -q -- .
  fi
done
