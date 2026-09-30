import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AppSettingsV1
} from './app-settings.ts';
import {
  resolveGeneralAppSettingsValue
} from './app-utils.ts';

const options = {
  transcriptionLanguageOptions: [{ value: 'ja' }, { value: 'en' }],
  playbackRateOptions: [0.75, 1, 1.25]
};

test('general app settings normalize every supported persisted section', () => {
  const settings: AppSettingsV1 = {
    transcription: { device: 'CPU', language: 'EN' },
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
    transcriptionLanguage: 'en',
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
    playback: { rate: 3 },
    diarization: { speakerCount: Number.NaN },
    export: { addUtteranceNumber: 'yes' }
  } as unknown as AppSettingsV1;

  assert.deepEqual(resolveGeneralAppSettingsValue(settings, options), {});
});

test('general app settings preserve language fallback and proofread defaults', () => {
  const settings: AppSettingsV1 = {
    transcription: { device: 'cuda', language: 'unknown' },
    proofread: {},
    diarization: { device: 'cuda', speakerCount: -4 }
  };

  assert.deepEqual(resolveGeneralAppSettingsValue(settings, options), {
    transcriptionDevice: 'cuda',
    transcriptionLanguage: 'ja',
    proofread: {
      locationDetectionScope: {
        mode: 'commonOnly',
        area: 'kanto',
        prefectures: [],
        prefecturesByArea: {}
      }
    },
    diarizationDevice: 'cuda',
    speakerCount: 1
  });
});
