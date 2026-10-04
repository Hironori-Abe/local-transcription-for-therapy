import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLegacyDataSize, groupLegacyData, legacyDataTotalLabel } from './legacy-data.ts';

test('small nonzero legacy data never rounds down to zero MB or GB', () => {
  assert.equal(formatLegacyDataSize(1), '1 B');
  assert.equal(formatLegacyDataSize(1024), '1.0 KB');
  assert.equal(formatLegacyDataSize(400_000), '390.6 KB');
  assert.equal(formatLegacyDataSize(1024 ** 2), '1.0 MB');
  assert.equal(formatLegacyDataSize(1024 ** 3), '1.0 GB');
  assert.equal(formatLegacyDataSize(null), '容量不明');
});

test('group and total sizes preserve unknown measurements', () => {
  const items = [{ label: 'cache', path: 'a', bytes: 10 }, { label: 'cache', path: 'b', bytes: null },
    { label: 'packages', path: 'c', bytes: 1024 }];
  assert.deepEqual(groupLegacyData(items), [{ label: 'cache', bytes: null }, { label: 'packages', bytes: 1024 }]);
  assert.equal(legacyDataTotalLabel(items), '1.0 KB ＋ 容量不明');
  assert.equal(legacyDataTotalLabel([{ label: 'cache', path: 'a', bytes: null }]), '容量不明');
  assert.equal(legacyDataTotalLabel([{ label: 'cache', path: 'a', bytes: 10 }]), '10 B');
});
