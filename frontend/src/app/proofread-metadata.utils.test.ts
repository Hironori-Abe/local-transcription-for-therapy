import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSensitiveEntityHighlightLevelValue,
  normalizeLintIssuesValue,
  normalizeProofreadMetadataValue,
  normalizeSensitiveEntityMetadataValue
} from './proofread-metadata.utils.ts';

test('normalizeLintIssuesValue trims, defaults, filters, and limits issues', () => {
  const raw = [
    null,
    { ruleId: ' rule-a ', message: ' message ', line: '2', column: '3', severity: '4' },
    { ruleId: '', message: '', line: Number.NaN, column: Number.NaN, severity: Number.NaN },
    ...Array.from({ length: 10 }, (_, index) => ({ ruleId: `rule-${index}`, message: '' }))
  ];
  const normalized = normalizeLintIssuesValue(raw);
  assert.equal(normalized.length, 8);
  assert.deepEqual(normalized[0], {
    ruleId: 'rule-a',
    message: 'message',
    line: 2,
    column: 3,
    severity: 4
  });
  assert.deepEqual(normalizeLintIssuesValue('invalid'), []);
});

test('normalizeSensitiveEntityMetadataValue sanitizes names and infers typed lists', () => {
  const person = normalizeSensitiveEntityMetadataValue({
    hasSensitiveEntity: true,
    kinds: [' PERSON ', 'unsupported'],
    names: [' 山田  太郎 ', '山田 太郎', ''],
    personDetectionSource: ' DICTIONARY '
  });
  assert.deepEqual(person, {
    hasSensitiveEntity: true,
    kinds: ['person'],
    names: ['山田 太郎'],
    personNames: ['山田 太郎'],
    organizationNames: [],
    locationNames: [],
    personDetectionSource: 'dictionary'
  });

  const organization = normalizeSensitiveEntityMetadataValue({
    hasSensitiveEntity: true,
    kinds: ['organization'],
    names: ['相談室']
  });
  assert.deepEqual(organization.organizationNames, ['相談室']);
  assert.equal(normalizeSensitiveEntityMetadataValue(null).hasSensitiveEntity, false);
});

test('normalizeProofreadMetadataValue clamps confidence and normalizes nested data', () => {
  const normalized = normalizeProofreadMetadataValue(
    '元文',
    '修正文',
    2,
    ' reason ',
    { hasSensitiveEntity: true, kinds: ['location'], names: ['東京'] },
    [{ ruleId: 'rule', message: '警告' }]
  );
  assert.deepEqual(normalized.diff, { from: '元文', to: '修正文' });
  assert.equal(normalized.confidence, 1);
  assert.equal(normalized.reason, 'reason');
  assert.deepEqual(normalized.sensitiveEntity?.locationNames, ['東京']);
  assert.equal(normalized.lintIssues?.length, 1);
  assert.equal(normalizeProofreadMetadataValue('a', 'b', Number.NaN, '').confidence, 0);
});

test('getSensitiveEntityHighlightLevelValue preserves red, yellow, and none rules', () => {
  assert.equal(getSensitiveEntityHighlightLevelValue(null), 'none');
  assert.equal(getSensitiveEntityHighlightLevelValue({ hasSensitiveEntity: false, personNames: ['山田'] }), 'none');
  assert.equal(getSensitiveEntityHighlightLevelValue({ hasSensitiveEntity: true, personNames: ['山田'] }), 'red');
  assert.equal(getSensitiveEntityHighlightLevelValue({ hasSensitiveEntity: true, locationNames: ['東京'] }), 'red');
  assert.equal(getSensitiveEntityHighlightLevelValue({ hasSensitiveEntity: true, organizationNames: ['相談室'] }), 'yellow');
  assert.equal(getSensitiveEntityHighlightLevelValue({ hasSensitiveEntity: true, kinds: [] }), 'none');
});
