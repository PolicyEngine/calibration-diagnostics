from pathlib import Path
import shutil
work=Path(__file__).resolve().parent
source=work/'new-package'
for name in ['accept-fraction','accept-negative','accept-space','no-levels']:
    dest=work/f'mutant-{name}'
    shutil.copytree(source,dest,dirs_exist_ok=True)
    file=dest/'src/latest-artifact.ts';code=file.read_text()
    if name=='accept-fraction':code=code.replace('Number.isSafeInteger(count) && count >= 0','Number.isFinite(count) && count >= 0',1)
    elif name=='accept-negative':code=code.replace('Number.isSafeInteger(count) && count >= 0','Number.isSafeInteger(count)',1)
    elif name=='accept-space':code=code.replace('typeof value === "string" && /^\\s*\\d+\\s*$/.test(value) ? Number(value) : numberOrNull(value)','typeof value === "string" ? Number(value) : numberOrNull(value)',1)
    else:code=code.replace('const levels = microcosmTargetLevels(group);\n  return { level: levels.length > 1 ? null : (levels[0] ?? none), levels };','const levels: string[] = [];\n  return { level: none, levels };',1)
    file.write_text(code)
    print(name,'mutation applied =',code!= (source/'src/latest-artifact.ts').read_text())
