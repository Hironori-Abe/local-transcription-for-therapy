import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDiarizationEditedTextMapValue,
  buildExportTranscriptionPayloadValue,
  buildProofreadHintValue,
  buildSensitiveEntityProofreadHintValue,
  compactProofreadHintTextValue,
  describeProofreadDiffReasonValue,
  getSensitiveEntityHighlightLevelValue,
  isPunctuationOnlyProofreadReasonValue,
  normalizeLintIssuesValue,
  normalizeProofreadMetadataValue,
  normalizeSensitiveEntityMetadataValue,
  parseImportedTranscriptionJsonValue,
  reconcileRetranscriptionStateValue
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

test('buildExportTranscriptionPayloadValue preserves the JSON export format', () => {
  const proofread = normalizeProofreadMetadataValue(
    '元文',
    '修正文',
    0.8,
    '表記修正',
    { hasSensitiveEntity: true, kinds: ['organization'], names: ['相談室'] },
    [{ ruleId: 'rule', message: '警告', line: 1, column: 2, severity: 2 }]
  );
  const payload = buildExportTranscriptionPayloadValue({
    audioFileName: 'session.wav',
    rows: [
      { id: 7, startTime: 0, endTime: 1.5, speakerValue: 'SPEAKER_02', content: '修正文' },
      { id: 3, startTime: 1.5, endTime: 3, speakerValue: 'SPEAKER_01', content: '二行目' },
      { id: 9, startTime: 3, endTime: 4, speakerValue: 'SPEAKER_02', content: '三行目' },
      { id: 11, startTime: 4, endTime: 5, speakerValue: '', content: '話者なし' }
    ],
    speakerDisplayNameByValue: {
      SPEAKER_01: 'Cl',
      SPEAKER_02: 'IP'
    },
    proofreadMetadataBySegmentId: { 7: proofread },
    llmSegmentStatusBySegmentId: { 7: 'done', 3: 'processing' },
    proofreadCompleted: true
  });

  assert.deepEqual(payload, {
    audioFileName: 'session.wav',
    speakerDataset: [
      { speakerValue: 'SPEAKER_01', displayName: 'Cl' },
      { speakerValue: 'SPEAKER_02', displayName: 'IP' }
    ],
    transcriptionDataset: [
      {
        startTime: 0,
        endTime: 1.5,
        speakerValue: 'SPEAKER_02',
        content: '修正文',
        proofread: {
          diff: { from: '元文', to: '修正文' },
          confidence: 0.8,
          reason: '表記修正',
          lintIssues: proofread.lintIssues,
          sensitiveEntity: proofread.sensitiveEntity
        },
        llmProofread: true
      },
      {
        startTime: 1.5,
        endTime: 3,
        speakerValue: 'SPEAKER_01',
        content: '二行目',
        proofread: undefined
      },
      {
        startTime: 3,
        endTime: 4,
        speakerValue: 'SPEAKER_02',
        content: '三行目',
        proofread: undefined
      },
      {
        startTime: 4,
        endTime: 5,
        speakerValue: '',
        content: '話者なし',
        proofread: undefined
      }
    ],
    proofreadCompleted: true
  });
});

test('buildExportTranscriptionPayloadValue falls back to speaker keys and round-trips through JSON', () => {
  const payload = buildExportTranscriptionPayloadValue({
    audioFileName: '',
    rows: [{ id: 1, startTime: 0, endTime: 0, speakerValue: 'SPEAKER_00', content: '' }],
    speakerDisplayNameByValue: { SPEAKER_00: '' },
    proofreadMetadataBySegmentId: {},
    llmSegmentStatusBySegmentId: {},
    proofreadCompleted: false
  });

  assert.deepEqual(payload.speakerDataset, [
    { speakerValue: 'SPEAKER_00', displayName: 'SPEAKER_00' }
  ]);
  const parsed = parseImportedTranscriptionJsonValue(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(JSON.stringify(parsed.value), JSON.stringify(payload));
  }
});

test('reconcileRetranscriptionStateValue keeps only edits whose original text still matches', () => {
  const metadata1 = normalizeProofreadMetadataValue('原文1', '修正文1', 0.9, '修正1');
  const metadata2 = normalizeProofreadMetadataValue('旧原文2', '修正文2', 0.8, '修正2');
  const metadata4 = normalizeProofreadMetadataValue('原文4', '修正文4', 0.7, '修正4');
  const previousEdited = { 1: '修正文1', 2: '修正文2', 4: '修正文4' };
  const previousHints = { 1: 'ヒント1', 2: 'ヒント2', 4: 'ヒント4' };
  const previousMetadata = { 1: metadata1, 2: metadata2, 4: metadata4 };

  const reconciled = reconcileRetranscriptionStateValue(
    [
      { id: 1, text: '原文1' },
      { id: 2, text: '新しい原文2' },
      { id: 3, text: null }
    ],
    previousEdited,
    previousHints,
    previousMetadata
  );

  assert.deepEqual(reconciled.editedTextBySegmentId, {
    1: '修正文1',
    2: '新しい原文2',
    3: ''
  });
  assert.deepEqual(reconciled.proofreadHintBySegmentId, { 1: 'ヒント1' });
  assert.deepEqual(reconciled.proofreadMetadataBySegmentId, { 1: metadata1 });
  assert.deepEqual(previousEdited, { 1: '修正文1', 2: '修正文2', 4: '修正文4' });
  assert.deepEqual(previousHints, { 1: 'ヒント1', 2: 'ヒント2', 4: 'ヒント4' });
  assert.deepEqual(previousMetadata, { 1: metadata1, 2: metadata2, 4: metadata4 });
});

test('reconcileRetranscriptionStateValue preserves current metadata without a prior edited value', () => {
  const metadata = normalizeProofreadMetadataValue('原文', '修正文', 1, '修正');
  const reconciled = reconcileRetranscriptionStateValue(
    [{ id: 5, text: '原文' }, { id: 6, text: '手動編集前の原文' }],
    { 6: '手動編集後' },
    { 5: 'ヒント5', 6: 'ヒント6' },
    { 5: metadata }
  );

  assert.deepEqual(reconciled.editedTextBySegmentId, {
    5: '原文',
    6: '手動編集前の原文'
  });
  assert.deepEqual(reconciled.proofreadHintBySegmentId, { 5: 'ヒント5' });
  assert.deepEqual(reconciled.proofreadMetadataBySegmentId, { 5: metadata });
});

test('buildDiarizationEditedTextMapValue keeps edits and initializes only new segments', () => {
  const previousEdited = {
    1: '編集済み',
    2: '',
    9: '消失したセグメント'
  };
  const result = buildDiarizationEditedTextMapValue(
    [
      { id: 1, text: '新しい話者分離結果1' },
      { id: 2, text: '新しい話者分離結果2' },
      { id: 3, text: '新規セグメント' },
      { id: 4, text: null }
    ],
    previousEdited
  );

  assert.deepEqual(result, {
    1: '編集済み',
    2: '',
    3: '新規セグメント',
    4: ''
  });
  assert.deepEqual(previousEdited, {
    1: '編集済み',
    2: '',
    9: '消失したセグメント'
  });
});

test('parseImportedTranscriptionJsonValue accepts and normalizes a complete export', () => {
  const parsed = parseImportedTranscriptionJsonValue(JSON.stringify({
    audioFileName: 'session.wav',
    speakerDataset: [{ speakerValue: 'SPEAKER_00', displayName: 'Th' }],
    transcriptionDataset: [{
      startTime: 0,
      endTime: 1.5,
      speakerValue: 'SPEAKER_00',
      content: '修正文',
      proofread: {
        diff: { from: '元文', to: '修正文' },
        confidence: 1.2,
        reason: ' 表記修正 ',
        sensitiveEntity: {
          hasSensitiveEntity: true,
          kinds: ['location'],
          names: ['東京']
        },
        lintIssues: [{ ruleId: ' rule ', message: ' 警告 ' }]
      },
      llmProofread: true
    }],
    proofreadCompleted: true,
    ignoredField: 'ignored'
  }));

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.deepEqual(parsed.value.speakerDataset, [
    { speakerValue: 'SPEAKER_00', displayName: 'Th' }
  ]);
  assert.equal(parsed.value.proofreadCompleted, true);
  assert.deepEqual(parsed.value.transcriptionDataset[0]?.proofread, {
    diff: { from: '元文', to: '修正文' },
    confidence: 1,
    reason: '表記修正',
    lintIssues: [{ ruleId: 'rule', message: '警告', line: 0, column: 0, severity: 1 }],
    sensitiveEntity: {
      hasSensitiveEntity: true,
      kinds: ['location'],
      names: ['東京'],
      personNames: [],
      organizationNames: [],
      locationNames: ['東京'],
      personDetectionSource: ''
    }
  });
  assert.equal(parsed.value.transcriptionDataset[0]?.llmProofread, true);
});

test('parseImportedTranscriptionJsonValue preserves optional field defaults', () => {
  const parsed = parseImportedTranscriptionJsonValue(JSON.stringify({
    audioFileName: '',
    speakerDataset: [],
    transcriptionDataset: [{
      startTime: 0,
      endTime: 0,
      speakerValue: '',
      content: '',
      proofread: null,
      llmProofread: false
    }]
  }));

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.value.proofreadCompleted, false);
  assert.equal(parsed.value.transcriptionDataset[0]?.proofread, undefined);
  assert.equal(parsed.value.transcriptionDataset[0]?.llmProofread, undefined);
});

test('parseImportedTranscriptionJsonValue preserves import validation messages', () => {
  const validRoot = {
    audioFileName: 'session.wav',
    speakerDataset: [] as unknown[],
    transcriptionDataset: [] as unknown[]
  };
  const cases: Array<{ content: string; error: string }> = [
    { content: '{', error: 'JSON の形式が不正です。' },
    { content: 'null', error: 'JSON のルートはオブジェクトである必要があります。' },
    { content: '{}', error: 'audioFileName は文字列である必要があります。' },
    {
      content: JSON.stringify({ audioFileName: 'session.wav' }),
      error: 'speakerDataset は配列である必要があります。'
    },
    {
      content: JSON.stringify({ audioFileName: 'session.wav', speakerDataset: [] }),
      error: 'transcriptionDataset は配列である必要があります。'
    },
    {
      content: JSON.stringify({ ...validRoot, proofreadCompleted: 'yes' }),
      error: 'proofreadCompleted は真偽値である必要があります。'
    },
    {
      content: JSON.stringify({ ...validRoot, speakerDataset: [null] }),
      error: 'speakerDataset[0] の形式が不正です。'
    },
    {
      content: JSON.stringify({ ...validRoot, speakerDataset: [{ speakerValue: 1, displayName: 'Th' }] }),
      error: 'speakerDataset[0] は speakerValue/displayName の文字列が必要です。'
    },
    {
      content: JSON.stringify({ ...validRoot, transcriptionDataset: [null] }),
      error: 'transcriptionDataset[0] の形式が不正です。'
    },
    {
      content: JSON.stringify({ ...validRoot, transcriptionDataset: [{}] }),
      error: 'transcriptionDataset[0] は startTime/endTime(数値), speakerValue/content(文字列) が必要です。'
    },
    {
      content: '{"audioFileName":"session.wav","speakerDataset":[],"transcriptionDataset":[{"startTime":1e400,"endTime":2e400,"speakerValue":"S","content":"text"}]}',
      error: 'transcriptionDataset[0] の時刻が不正です。'
    },
    {
      content: JSON.stringify({
        ...validRoot,
        transcriptionDataset: [{ startTime: 2, endTime: 1, speakerValue: 'S', content: 'text' }]
      }),
      error: 'transcriptionDataset[0] の開始/終了時刻の関係が不正です。'
    },
    {
      content: JSON.stringify({
        ...validRoot,
        transcriptionDataset: [{ startTime: 0, endTime: 1, speakerValue: 'S', content: 'text', proofread: 1 }]
      }),
      error: 'transcriptionDataset[0].proofread の形式が不正です。'
    },
    {
      content: JSON.stringify({
        ...validRoot,
        transcriptionDataset: [{ startTime: 0, endTime: 1, speakerValue: 'S', content: 'text', proofread: {} }]
      }),
      error: 'transcriptionDataset[0].proofread.diff の形式が不正です。'
    },
    {
      content: JSON.stringify({
        ...validRoot,
        transcriptionDataset: [{
          startTime: 0,
          endTime: 1,
          speakerValue: 'S',
          content: 'text',
          proofread: { diff: { from: 'a', to: 'b' }, confidence: 'high', reason: '修正' }
        }]
      }),
      error: 'transcriptionDataset[0].proofread は diff.from/to(文字列), confidence(数値), reason(文字列) が必要です。'
    }
  ];

  for (const testCase of cases) {
    assert.deepEqual(parseImportedTranscriptionJsonValue(testCase.content), {
      ok: false,
      error: testCase.error
    });
  }
});
