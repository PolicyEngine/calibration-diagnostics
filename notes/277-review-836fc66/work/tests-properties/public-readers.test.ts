import { expect, test } from 'bun:test';
import fixture from './new-package/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json';
const dir = process.env.PROPERTY_PACKAGE ?? './new-package';
const { buildCalibration, buildComparison, latestMicrocosmTargetDiagnosticsPage, microcosmVariableSummary } = await import(`${dir}/src/latest-artifact.ts`);
const artifact=fixture as Record<string,unknown>;
const target=(artifact.targets as Record<string,unknown>[]).find(row=>!(row.metadata as Record<string,unknown>).ledger_member_fact_count)!;
const fsa=buildCalibration(artifact,'review',null,{},{},{},'us');
function page(cal:any,variable?:string){const u=new URL('https://dashboard.test/api/microcosm/target-diagnostics');u.searchParams.set('limit','500');if(variable)u.searchParams.set('variable',variable);return latestMicrocosmTargetDiagnosticsPage(String(u),cal);}
function shownCount(value:unknown){const row=structuredClone(target);(row.metadata as Record<string,unknown>).ledger_universe_constraint_count=value;return page(buildCalibration({...artifact,targets:[row]},'count',null,{},{},{},'us')).targets[0].chronicle.universe_constraint_count;}
const isCount=(v:unknown)=>v===null||(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0);
test('public count shape and roundtrip witnesses',()=>{
 for(const v of [2.5,-1,'2.5','-1',' ','',0,'0',7,' 7 ',Number.MAX_SAFE_INTEGER,String(Number.MAX_SAFE_INTEGER)]) expect(isCount(shownCount(v))).toBe(true);
 for(const n of [0,1,7,Number.MAX_SAFE_INTEGER]){expect(shownCount(n)).toBe(n);expect(shownCount(String(n))).toBe(n);}
});
test('public count example rejects blank',()=>expect(shownCount(' ')).toBe(null));
const cases=[[],[{level:'state'}],[{level:'state'},{level:'country'},{level:'state'}],[{level:null},{level:''}],[{level:0},{level:' '}],[{level:undefined},{level:-2}]];
for(const none of ['',null] as const)test(`public category row-level equality witnesses (${JSON.stringify(none)})`,()=>{
 for(const rows of cases){const shown=none===''?microcosmVariableSummary(rows.map(row=>({...row,variable_key:'v'}))):buildComparison({...fsa,rows:rows.map((row,i)=>({...fsa.rows[i],level:row.level,variable_key:'v'}))},{...fsa,rows:rows.map((row,i)=>({...fsa.rows[i],level:row.level,variable_key:'v'}))}).variables;
 if(rows.length===0){expect(shown).toEqual([]);continue;}expect(shown).toHaveLength(1);const levels=[...new Set(rows.map(row=>String(row.level??'')))].filter(Boolean).sort();expect(shown[0].levels).toEqual(levels);expect(shown[0].level).toBe(levels.length>=2?null:(levels[0]??none));}
});
test('public facet witnesses preserve real breakdown and drop geography repeats',()=>{
 const rows=[{variable_key:'v',geography:'Alabama',target_dimensions:[{key:'loc',label:'Loc',value:'Alabama'},{key:'sex',label:'Sex',value:'Male'}]},{variable_key:'v',geography:'Alaska',target_dimensions:[{key:'loc',label:'Loc',value:'Alaska'},{key:'sex',label:'Sex',value:'Female'}]}];
 expect(page({...fsa,rows},'v').dimensions.map((d:any)=>d.key)).toEqual(['geography','sex']);
});
test('benchmark public count paths: 20,000 shape calls and 40,000 roundtrip calls',()=>{
 if(process.env.PROPERTY_PACKAGE)return;
 let start=performance.now();for(let i=0;i<20_000;i++)shownCount(i);console.log(`20,000 buildCalibration + page calls: ${(performance.now()-start).toFixed(0)} ms`);
 start=performance.now();for(let i=0;i<20_000;i++){shownCount(i);shownCount(String(i));}console.log(`40,000 buildCalibration + page calls: ${(performance.now()-start).toFixed(0)} ms`);
},60_000);
