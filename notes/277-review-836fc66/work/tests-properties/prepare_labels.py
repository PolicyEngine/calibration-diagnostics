from pathlib import Path
work=Path(__file__).resolve().parent
root=work.parents[1]
for version,snap in [('old','67e6d0b'),('new','836fc66')]:
    dest=work/f'{version}-front';dest.mkdir(exist_ok=True)
    source=(root/f'inputs/dashboard-{snap}/frontend/components/microcosm/target-row-labels.ts').read_text()
    source=source.replace('import { humanizeName } from "@/components/shared/format";','import { humanizeName } from "../formatter-stand-in";')
    source=source.replace('import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";','type MicrocosmTargetRow = any;')
    (dest/'target-row-labels.ts').write_text(source)
    test=(root/'inputs/dashboard-836fc66/frontend/components/microcosm/target-row-labels.test.ts').read_text()
    test=test.replace('@/packages/calibration-tree/src/',f'../{version}-package/src/').replace('@policyengine/calibration-tree/latest-artifact',f'../{version}-package/src/latest-artifact')
    test=test.replace('import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";','type MicrocosmTargetRow = any;')
    (dest/'target-row-labels.test.ts').write_text(test)
(work/'formatter-stand-in.ts').write_text('// Missing shared/format.ts stand-in: only underscore replacement. No exact formatter/casing claim.\nexport const humanizeName = (value: string) => value.replace(/_/g, " ");\n')
print('Prepared label test copies; aliases resolved locally; missing formatter replaced with explicitly limited stand-in.')
