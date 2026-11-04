from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[2]
work=root/'work/tests-properties'
for version,snap in [('old','67e6d0b'),('new','836fc66')]:
    package=work/f'{version}-package'
    locator=package/'src/calibration-release-locator.ts'
    source=locator.read_text()
    source=source.replace('import { readCalibrationTreeManifest } from "./calibration-tree-blob";', 'const readCalibrationTreeManifest = (..._args: unknown[]): never => { throw new Error("I/O boundary disabled in isolated review"); };')
    locator.write_text(source)
old=work/'old-package/src'
shutil.copy2(work/'new-package/src/multi-fact-identity.test.ts',old/'multi-fact-identity.test.ts')
shutil.copytree(work/'new-package/src/fixtures/mixed-groupby-storage',old/'fixtures/mixed-groupby-storage',dirs_exist_ok=True)
(work/'deny-network.ts').write_text('globalThis.fetch = (() => { throw new Error("Network disabled in isolated review"); }) as typeof fetch;\n')
print('Prepared old/new package copies; old has the final multi-fact test and new JSON fixture. Only unrelated locator I/O import replaced with throw-if-called boundary.')
