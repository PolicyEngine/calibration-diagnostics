import { expect, test } from 'bun:test';
import * as old from './old-package/src/latest-artifact';
import * as head from './new-package/src/latest-artifact';
test('four implementation helpers leave the public module',()=>{
 for(const name of ['countOrNull','repeatsGeography','computeDimensions','categoryLevels']){console.log(`${name}: before=${name in old}, after=${name in head}`);expect(name in old).toBe(true);expect(name in head).toBe(false);}
});
