from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'work/review'
OUT.mkdir(parents=True, exist_ok=True)

def run(name, args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    output = '$ ' + ' '.join(args) + '\n' + result.stdout + result.stderr + f'\nEXIT {result.returncode}\n'
    (OUT / name).write_text(output)
    return output

run('field-readers.log', ['rg', '-n', 'layout_groupby_value_varies|layout_groupby_unlisted_across_facts|dimensionSummary|shownChronicle', 'inputs/dashboard-836fc66'])
run('helper-readers.log', ['rg', '-n', r'\b(countOrNull|repeatsGeography|computeDimensions|categoryLevels)\b', 'inputs/dashboard-836fc66'])
run('changed-hunks.log', ['rg', '^diff --git|^@@', 'inputs/pr/diff-67e6d0b-836fc66.diff'])

base = ROOT / 'inputs/dashboard-67e6d0b'
head = ROOT / 'inputs/dashboard-836fc66'
common = sorted(p.relative_to(base) for p in base.rglob('*') if p.is_file() and (head / p.relative_to(base)).is_file())
changed = [str(p) for p in common if (base/p).read_bytes() != (head/p).read_bytes()]
(OUT / 'changed-snapshot-files.log').write_text('\n'.join(changed) + '\n')
print('CHANGED COMMON FILES', len(changed))

fixture = json.loads((head / 'frontend/packages/calibration-tree/src/fixtures/mixed-groupby-storage/hierarchy-probe-targets.json').read_text())
log = [json.loads(line) for line in (ROOT / 'inputs/pr/review-67e6d0b/identity/hierarchy_probe.log').read_text().splitlines()[:3]]
keys = ['case', 'facts', 'hierarchy_dimensions', 'representative', 'dashboard_target']
for index, (entry, original) in enumerate(zip(fixture, log)):
    assert entry == {key: original[key] for key in keys}, index
    print('FIXTURE MATCH', index + 1, 'all five retained fields exact')
assert len(fixture) == 3

ledger = ROOT / 'inputs/microcosm-0ff293b/packages/microcosm-build/src/microcosm/build/ledger_targets.py'
ranges = [(1010, 1035), (1080, 1102), (1170, 1180), (1232, 1245), (1318, 1341), (1364, 1371), (1424, 1432), (1482, 1494), (1578, 1651), (2171, 2185), (2993, 3011), (3069, 3071), (3188, 3189), (4270, 4272), (4331, 4331), (5910, 5916)]
lines = ledger.read_text().splitlines()
with (OUT / 'microcosm-citations.log').open('w') as f:
    for start, end in ranges:
        f.write(f'\n{ledger.relative_to(ROOT)}:{start}-{end}\n')
        f.write('\n'.join(f'{i}: {lines[i-1]}' for i in range(start, end+1)) + '\n')

hashes = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'inputs').rglob('*') if p.is_file()}
(OUT / 'input-sha256.json').write_text(json.dumps(hashes, indent=2) + '\n')
print('INPUT FILE HASHES', len(hashes))
print('LOGS work/review/{field-readers,helper-readers,changed-hunks,changed-snapshot-files,microcosm-citations}.log')
