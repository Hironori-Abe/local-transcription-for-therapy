import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProofreadHintValue,
  buildSensitiveEntityProofreadHintValue,
  compactProofreadHintTextValue,
  describeProofreadDiffReasonValue,
  getSensitiveEntityHighlightLevelValue,
  isPunctuationOnlyProofreadReasonValue,
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

test('describeProofreadDiffReasonValue reports only actual punctuation changes', () => {
  assert.equal(describeProofreadDiffReasonValue('今日は晴れ', '今日は、晴れ。'), '、。を追加');
  assert.equal(describeProofreadDiffReasonValue('今日は、晴れ。', '今日は晴れ！'), '句読点・記号の調整');
  assert.equal(describeProofreadDiffReasonValue('今日は晴れ', '今日は雨'), '');
  assert.equal(describeProofreadDiffReasonValue('同じ', '同じ'), '');
  assert.equal(describeProofreadDiffReasonValue('a b', 'a\tb'), '句読点・記号の調整');
});

test('punctuation reason and compact text helpers preserve existing display rules', () => {
  assert.equal(isPunctuationOnlyProofreadReasonValue(' 文末句点の補完 '), true);
  assert.equal(isPunctuationOnlyProofreadReasonValue('「。」を追加'), true);
  assert.equal(isPunctuationOnlyProofreadReasonValue('llm_correction'), false);
  assert.equal(compactProofreadHintTextValue('  a\n  b  '), 'a b');
  assert.equal(compactProofreadHintTextValue('abcdef', 3), 'abc...');
});

test('sensitive-entity hints preserve person, location, organization, and honorific wording', () => {
  const base = {
    hasSensitiveEntity: true,
    kinds: [] as string[],
    names: [] as string[],
    personNames: [] as string[],
    organizationNames: [] as string[],
    locationNames: [] as string[],
    personDetectionSource: ''
  };
  assert.equal(buildSensitiveEntityProofreadHintValue({ ...base, hasSensitiveEntity: false }), null);
  assert.equal(
    buildSensitiveEntityProofreadHintValue({ ...base, personNames: ['山田'], locationNames: ['東京'] }),
    '人名・地名混入の可能性: 山田、東京'
  );
  assert.equal(
    buildSensitiveEntityProofreadHintValue({ ...base, locationNames: ['東京'] }),
    '地名混入の可能性: 東京'
  );
  assert.equal(
    buildSensitiveEntityProofreadHintValue({ ...base, organizationNames: ['相談室'] }),
    '組織名など混入の可能性: 相談室'
  );
  assert.equal(
    buildSensitiveEntityProofreadHintValue({ ...base, kinds: ['person'], personDetectionSource: 'honorific' }),
    '人名混入の可能性: さん／君などの検出'
  );
});

test('buildProofreadHintValue prioritizes warnings and preserves fallback wording', () => {
  assert.equal(
    buildProofreadHintValue('元文', '修正文', '文末句点の補完'),
    '句読点の調整：（元文） 元文'
  );
  assert.equal(buildProofreadHintValue('元文', '修正文', '表記修正'), 'AI: 表記修正');
  assert.equal(buildProofreadHintValue('同じ', '同じ', 'llm_correction'), 'AI：（変更無し）');
  assert.equal(buildProofreadHintValue('元文', '修正文', 'llm_correction'), 'AI（元文）: 「元文」');
  assert.equal(
    buildProofreadHintValue('元文', '修正文', '表記修正', {
      hasSensitiveEntity: true,
      kinds: ['location'],
      names: ['東京']
    }),
    '地名混入の可能性: 東京'
  );
});
