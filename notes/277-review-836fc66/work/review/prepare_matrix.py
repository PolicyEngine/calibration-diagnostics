from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
for version, snap in [('old', '67e6d0b'), ('new', '836fc66')]:
    source = (ROOT / f'inputs/dashboard-{snap}/frontend/components/microcosm/target-row-labels.ts').read_text()
    source = source.replace('import { humanizeName } from "@/components/shared/format";', '''// The shared formatter is absent from the input. Only aggregate's old title
// calls this stand-in in the 132-row comparison (reported below).
export const formatterCalls: string[] = [];
function humanizeName(value: string): string {
  formatterCalls.push(value);
  return value === 'loan_type' ? 'loan type' : `[humanizeName:${value}]`;
}''')
    source = source.replace('import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";', 'type MicrocosmTargetRow = any;')
    (ROOT / f'work/review/{version}-target-row-labels.ts').write_text(source)
print('Copied both label modules; formatter stand-in records calls; production logic unchanged.')
