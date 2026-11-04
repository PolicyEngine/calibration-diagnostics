import { test, expect } from 'bun:test';
import fixture from '../tests-properties/new-package/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json';
import probe from '../tests-properties/new-package/src/fixtures/mixed-groupby-storage/hierarchy-probe-targets.json';
import { buildCalibration as oldBuild, latestMicrocosmTargetDiagnosticsPage as oldPage } from '../tests-properties/old-package/src/latest-artifact';
import { buildCalibration as newBuild, latestMicrocosmTargetDiagnosticsPage as newPage } from '../tests-properties/new-package/src/latest-artifact';
import { dimensionSummary as oldLabel, formatterCalls as oldCalls } from './old-target-row-labels';
import { dimensionSummary as newLabel, formatterCalls as newCalls } from './new-target-row-labels';

const rows = fixture.targets as any[];
function fsa(suffix: string) { return structuredClone(rows.find(row => row.target_name.endsWith(suffix))!); }
function page(build: any, read: any, targets: any[], version = 8, country = 'us') {
  const cal = build({...fixture, schema_version: version, targets}, 'review-matrix', null, {}, {}, {}, country);
  return read('https://test.invalid/api/microcosm/target-diagnostics?limit=500', cal).targets;
}
function multi(row: any, operation: string, extra: any = {}) {
  Object.assign(row.metadata, {ledger_member_fact_count: '3', ledger_member_fact_keys: '["base","num","den"]', ledger_value_operation: operation, ...extra});
  return row;
}

test('132 FSA dimensions differ only for excluding Parent PLUS', () => {
  const oldRows = page(oldBuild, oldPage, rows);
  const newRows = page(newBuild, newPage, rows);
  const before = new Map(oldRows.map((row: any) => [row.name, oldLabel(row)]));
  const changed = newRows.filter((row: any) => before.get(row.name) !== newLabel(row)).map((row: any) => ({name:row.name, before:before.get(row.name), after:newLabel(row)}));
  expect(oldRows).toHaveLength(132);
  expect(newRows).toHaveLength(132);
  expect(changed).toHaveLength(1);
  expect(changed[0].name).toContain('.excluding_parent_plus.');
  expect(changed[0].before).toBe('Combines several loan type values');
  expect(changed[0].after).toBe('Combines several source cells');
  expect(newCalls).toEqual([]);
  expect(oldCalls).toEqual(['loan_type']);
  console.log('FSA', JSON.stringify({total:132, unchanged:131, changed, oldFormatterCalls: oldCalls, newFormatterCalls:newCalls}));
});

test('public reader matrix at 836fc66', () => {
  const al = () => fsa('portfolio_by_location.2026_03_31.al.dollars_outstanding');
  const excluding = () => fsa('dollars_outstanding.excluding_parent_plus.dollars_outstanding');
  const mixed = () => ({...structuredClone(probe[0].dashboard_target), name:'combined-balance@2024', target_name:'combined-balance', target:40, initial_estimate:40, final_estimate:40, relative_error:0});
  const missingPair = mixed();
  delete missingPair.metadata.ledger_layout_groupby_dimension;
  delete missingPair.metadata.ledger_layout_groupby_value_id;
  const scaledNoPair = multi(al(), 'scaled_by_ratio');
  delete scaledNoPair.metadata.ledger_layout_groupby_dimension;
  delete scaledNoPair.metadata.ledger_layout_groupby_value_id;
  const scaledNoHierarchy = multi(al(), 'scaled_by_ratio');
  delete scaledNoHierarchy.hierarchy;
  const legacy = excluding(); delete legacy.hierarchy;
  const filtered = structuredClone(legacy); filtered.filter = 'cell_be2_female_18_64';
  const structured = excluding(); delete structured.hierarchy;
  structured.source = {id:'publisher',label:'Publisher'};
  structured.variable = {id:'balance',label:'Balance'};
  structured.dimensions = {};
  const cases: [string,any,number,string,any,string][] = [
    ['single fact',al(),8,'us','absent','Alabama'],
    ['scaled_by_ratio one identity fact',multi(al(),'scaled_by_ratio'),8,'us',false,'Alabama'],
    ['rolled_forward_by_ratio one base',multi(al(),'rolled_forward_by_ratio',{ledger_value_base_cells:'1'}),8,'us',false,'Alabama'],
    ['allocated_residual_by_ratio one base',multi(al(),'allocated_residual_by_ratio',{ledger_allocation_receipt:'{"fact_keys":{"base":["base"]}}'}),8,'us',false,'Alabama'],
    ['one-fact identity without pair',scaledNoPair,8,'us',null,'Alabama'],
    ['one-fact identity without hierarchy',scaledNoHierarchy,6,'us',false,'[humanizeName:al]'],
    ['multi-identity pair listed',multi(al(),'sum'),8,'us',false,'Alabama'],
    ['multi-identity omitted FSA',excluding(),8,'us',true,'Combines several source cells'],
    ['multi-identity omitted mixed',mixed(),8,'uk',true,'Combines several source cells'],
    ['multi-identity no representative pair',missingPair,8,'uk',null,'All'],
    ['schema6 no legacy filter',legacy,6,'us',null,'stafford unsubsidized'],
    ['schema6 recognized legacy filter',filtered,6,'be',null,'Female · 18–64'],
    ['schema7 structured without hierarchy',structured,7,'us',null,'All'],
  ];
  for (const [name, row, schema, country, field, label] of cases) {
    const [shown] = page(newBuild, newPage, [row], schema, country);
    const actual = shown.chronicle.layout_groupby_unlisted_across_facts ?? ('layout_groupby_unlisted_across_facts' in shown.chronicle ? null : 'absent');
    console.log('MATRIX',JSON.stringify({case:name,field:actual,group:shown.chronicle.layout_groupby_value_id,dimension_adapter:shown.dimension_adapter,dimensions:shown.target_dimensions,label:newLabel(shown)}));
    expect(actual).toBe(field);
    // Formatter absent: [humanizeName:al] records the fallback call rather
    // than guessing its rendered capitalization.
    expect(newLabel(shown)).toBe(label);
  }
  const broken = excluding(); delete broken.hierarchy;
  expect(() => page(newBuild,newPage,[broken])).toThrow('hierarchy must be an object');
});
