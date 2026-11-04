from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
report = (ROOT/'out.md').read_text()
assert report.splitlines()[0] == '67e6d0b..836fc66 — CHANGES NEEDED'
for section in range(1, 7):
    assert re.search(rf'^## {section}\. ', report, re.M), section
inventory = json.loads((ROOT/'work/review/input-sha256.json').read_text())
assert all(hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == digest for path, digest in inventory.items())
print('REPORT_FIRST_LINE:', report.splitlines()[0])
print('REVIEW_CHECK_SECTIONS: 6')
print('INPUT_HASHES_UNCHANGED:', len(inventory))
result = subprocess.run(['git', 'diff', '--exit-code', '--', 'inputs'], cwd=ROOT, capture_output=True, text=True)
print('INPUT_GIT_DIFF_EXIT:', result.returncode)
if result.stdout or result.stderr:
    print(result.stdout + result.stderr)
assert result.returncode == 0
required = ['work/review/matrix.log', 'work/null-pair/producer.log', 'work/null-pair/no-false-all-regression.log', 'work/tests-properties/new-multi-fact.log', 'work/tests-properties/new-labels.log', 'work/tests-properties/exports.log', 'work/prose/claim-inventory.log']
assert all((ROOT/file).is_file() for file in required)
print('EVIDENCE_FILES_PRESENT:', len(required))
print('REPORT_VALIDATION: pass')
