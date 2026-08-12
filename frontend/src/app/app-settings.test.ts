import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppSettingsV1 } from './app-settings.ts';
import { resolveGeneralAppSettingsValue } from './app-utils.ts';

const options = {
  cpuOnlyBuild: false,
  transcriptionLanguageOptions: [{ value: 'ja' }, { value: 'en' }],
  playbackRateOptions: [0.75, 1, 1.25]
};

test('general app settings normalize every supported persisted section', () => {
  const settings: AppSettingsV1 = {
    transcription: { device: 'CPU', computeType: 'INT8', language: 'EN', hipDeviceIndex: 2 },
    playback: { rate: 1.25 },
    proofread: {
      chunkSize: 99,
      chunkMaxChars: 100,
      locationDetectionScope: { mode: 'selectedRegions', area: 'kanto', prefectures: ['13'] }
    },
    diarization: { device: 'cuda', speakerCount: 9.8 },
    export: { addUtteranceNumber: true }
  };

  assert.deepEqual(resolveGeneralAppSettingsValue(settings, options), {
    transcriptionDevice: 'cpu',
    computeType: 'int8',
    transcriptionLanguage: 'en',
    hipDeviceIndex: 2,
    playbackRate: 1.25,
    proofread: {
      chunkSize: 64,
      chunkMaxChars: 200,
      locationDetectionScope: {
        mode: 'selectedRegions',
        area: 'kanto',
        prefectures: ['13'],
        prefecturesByArea: { kanto: ['13'] }
      }
    },
    diarizationDevice: 'cuda',
    speakerCount: 5,
    addUtteranceNumber: true
  });
});

test('general app settings omit invalid optional values without replacing current UI state', () => {
  const settings = {
    transcription: { hipDeviceIndex: 1.5 },
    playback: { rate: 3 },
    diarization: { speakerCount: Number.NaN },
    export: { addUtteranceNumber: 'yes' }
  } as unknown as AppSettingsV1;

  assert.deepEqual(resolveGeneralAppSettingsValue(settings, options), {});
});

test('general app settings preserve CPU-build coercion and proofread defaults', () => {
  const settings: AppSettingsV1 = {
    transcription: { device: 'cuda', computeType: 'float16', language: 'unknown' },
    proofread: {},
    diarization: { device: 'cuda', speakerCount: -4 }
  };

  assert.deepEqual(resolveGeneralAppSettingsValue(settings, { ...options, cpuOnlyBuild: true }), {
    transcriptionDevice: 'cpu',
    computeType: 'float32',
    transcriptionLanguage: 'ja',
    proofread: {
      locationDetectionScope: {
        mode: 'commonOnly',
        area: 'kanto',
        prefectures: [],
        prefecturesByArea: {}
      }
    },
    diarizationDevice: 'cpu',
    speakerCount: 1
  });
});
