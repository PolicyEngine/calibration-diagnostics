from pathlib import Path
import os
import subprocess
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE / 'isolated-head'
FILE = ROOT / 'src/latest-artifact.ts'
OLD = '''  const count =
    typeof value === "string" && /^\\s*\\d+\\s*$/.test(value) ? Number(value) : numberOrNull(value);
  return count != null && Number.isSafeInteger(count) && count >= 0 ? count : null;'''
original = FILE.read_text()
assert original.count(OLD) == 1
mutants = {
    'accept-fraction': OLD.replace('\\d+\\s*$', '\\d+(\\.\\d+)?\\s*$').replace('Number.isSafeInteger(count)', 'Number.isFinite(count)'),
    'accept-negative': OLD.replace('^\\s*\\d+', '^\\s*-?\\d+').replace(' && count >= 0', ''),
    'accept-space': OLD.replace('^\\s*\\d+\\s*$', '^\\s*\\d*\\s*$'),
}
results = {}
try:
    for name, mutated in mutants.items():
        FILE.write_text(original.replace(OLD, mutated))
        command = [str(Path.home() / '.bun/bin/bun'), 'test', '--preload', str(HERE / 'deny-network.ts'),
                   'src/latest-artifact.test.ts', '-t', 'a universe constraint count that is not a whole count reads null']
        run = subprocess.run(command, cwd=ROOT, env={**os.environ, 'BUN_INSTALL_CACHE_DIR': str(HERE / 'bun-cache')},
                             capture_output=True, text=True)
        (HERE / f'count-mutant-{name}.log').write_text('COMMAND: ' + ' '.join(command) + '\n' + run.stdout + run.stderr)
        results[name] = {'exit': run.returncode, 'tail': (run.stdout + run.stderr)[-180:]}
finally:
    FILE.write_text(original)
(HERE / 'count-mutants.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
