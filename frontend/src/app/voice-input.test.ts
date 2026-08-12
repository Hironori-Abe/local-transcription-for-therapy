import assert from 'node:assert/strict';
import test from 'node:test';

import {
  arrayBufferToBase64,
  buildVoiceInputContext,
  encodePcm16Wav,
  mergeFloat32Chunks,
  normalizeVoiceInputCandidates,
  normalizeVoiceInputErrorMessage,
  prepareVoiceInput,
  resamplePcmTo16k
} from './voice-input.ts';

test('voice input context preserves visible neighbors, edited text, and hidden-row fallback', () => {
  const all = [
    { id: 1, speaker: 'Th', text: '一行目' },
    { id: 2, speaker: '-', text: '二行目' },
    { id: 3, speaker: 'Cl', text: '三行目' }
  ];
  const edited = { 2: '編集済み' };
  const getText = (segment: (typeof all)[number]) => edited[segment.id as keyof typeof edited] ?? segment.text;
  assert.deepEqual(buildVoiceInputContext(all, all, 2, { 1: 1, 2: 2, 3: 3 }, (s) => s.speaker, getText), {
    previous: { rowNumber: 1, speaker: 'Th', text: '一行目' },
    current: { rowNumber: 2, speaker: null, text: '編集済み' },
    next: { rowNumber: 3, speaker: 'Cl', text: '三行目' }
  });
  assert.deepEqual(buildVoiceInputContext([all[0], all[2]], all, 2, { 1: 1, 3: 2 }, (s) => s.speaker, getText), {
    previous: null,
    current: { speaker: null, text: '編集済み' },
    next: null
  });
  assert.equal(buildVoiceInputContext(all, all, 99, {}, (s) => s.speaker, getText), null);
});

test('candidate and microphone error normalization stays bounded and actionable', () => {
  assert.deepEqual(normalizeVoiceInputCandidates([' 候補1 ', '', null, '候補2', '候補3'], 2), ['候補1', 'null']);
  assert.deepEqual(normalizeVoiceInputCandidates(undefined), []);
  const permission = 'マイク入力が許可されませんでした。OSまたはWebViewのマイク権限を許可してから再試行してください。';
  assert.equal(normalizeVoiceInputErrorMessage(new Error('NotAllowedError: Permission denied')), permission);
  assert.equal(normalizeVoiceInputErrorMessage('device not found'), '利用可能なマイクが見つかりません。');
  assert.equal(normalizeVoiceInputErrorMessage('録音処理に失敗しました'), '録音処理に失敗しました');
});

test('PCM helpers preserve chunk order, resampling, headers, and Base64 bytes', () => {
  const first = new Float32Array([0, 0.5]);
  const second = new Float32Array([-0.5, 1]);
  assert.deepEqual(Array.from(mergeFloat32Chunks([first, second])), [0, 0.5, -0.5, 1]);
  assert.deepEqual(Array.from(mergeFloat32Chunks([])), []);
  assert.equal(resamplePcmTo16k(first, 16000), first);
  assert.deepEqual(Array.from(resamplePcmTo16k(new Float32Array([0, 1, 0, -1]), 32000)), [0, 0]);
  assert.deepEqual(Array.from(resamplePcmTo16k(new Float32Array([0, 1, 0]), 24000)), [0, 0.5]);

  const wav = encodePcm16Wav(new Float32Array([-2, -1, 0, 1, 2]), 16000);
  const bytes = new Uint8Array(wav);
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint32(4, true), 46);
  assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual([44, 46, 48, 50, 52].map((offset) => view.getInt16(offset, true)), [-32768, -32768, 0, 32767, 32767]);
  assert.equal(arrayBufferToBase64(new Uint8Array([0, 1, 2, 253, 254, 255]).buffer), 'AAEC/f7/');
});

test('recording preparation rejects short input and caps duration before producing 16 kHz WAV', () => {
  assert.deepEqual(prepareVoiceInput([new Float32Array(149)], 1000, 1), {
    ok: false,
    message: '録音が短すぎます。'
  });
  const prepared = prepareVoiceInput([new Float32Array(1200).fill(0.25)], 1000, 1);
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    const wavBytes = Buffer.from(prepared.wavBase64, 'base64');
    assert.equal(wavBytes.readUInt32LE(24), 16000);
    assert.equal(wavBytes.readUInt32LE(40), 32000);
  }
});
