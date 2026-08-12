import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppSettingsV1 } from './app-settings.ts';
import {
  buildLlmInferenceParamsKeyValue,
  buildLlmScopedSettingsKeyValue,
  getStoredLlmInferenceParamsValue,
  getStoredLlmPromptTypeValue,
  getStoredLlmStringSettingValue,
  hasStoredLlmStringSettingValue,
  resolveGeneralAppSettingsValue,
  resolveLlmAppSettingsValue,
  resolvePersistedLlmBackendModeValue,
  updateLlmSelectionSettingsValue,
  updateStoredLlmInferenceParamsValue,
  updateStoredLlmPromptTypeValue,
  updateStoredLlmStringSettingValue
} from './app-utils.ts';

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

test('persisted LLM settings apply migrations and current backend policy', () => {
  const settings: AppSettingsV1 = {
    llm: {
      modelPath: '/models/custom.gguf',
      backendMode: 'lmstudio',
      llmGpuMode: 'cpu',
      lemonadeUrl: 'http://localhost:13305',
      lemonadeModel: 'custom-model',
      lmstudioModel: 'studio-model',
      ollamaModel: 'ollama-model',
      lemonadeBackendNotNeeded: true,
      llmHipDeviceIndex: -1,
      llmPromptType: 'original',
      llmParallel: 30,
      proofreadModelTier: '12b'
    }
  };

  assert.deepEqual(resolveLlmAppSettingsValue(settings, {
    localLlmAppsEnabled: false,
    aiProofreadBuild: true
  }), {
    modelPath: '/models/custom.gguf',
    backendMode: 'local_gguf',
    llmGpuMode: 'cpu',
    lemonadeUrl: 'http://localhost:13306',
    lemonadeModel: 'custom-model',
    lmstudioModel: 'studio-model',
    ollamaModel: 'ollama-model',
    lemonadeBackendNotNeeded: true,
    llmHipDeviceIndex: -1,
    llmPromptType: 'original',
    llmParallel: 24,
    proofreadModelTier: '12b'
  });
  assert.equal(resolvePersistedLlmBackendModeValue('ollama', true), 'ollama');
  assert.equal(resolvePersistedLlmBackendModeValue('unknown', true), undefined);
});

test('persisted LLM settings discard stale models and unsupported values', () => {
  const settings = {
    llm: {
      backendMode: 'invalid',
      llmGpuMode: 'cuda_parallel',
      lemonadeModel: 'Gemma-4-E4B-it-GGUF',
      llmHipDeviceIndex: -2,
      llmPromptType: 'invalid',
      llmParallel: -1,
      proofreadModelTier: '12b'
    }
  } as unknown as AppSettingsV1;

  assert.deepEqual(resolveLlmAppSettingsValue(settings, {
    localLlmAppsEnabled: true,
    aiProofreadBuild: false
  }), {
    backendMode: undefined,
    llmGpuMode: 'gpu',
    proofreadModelTier: 'e4b'
  });
  assert.deepEqual(resolveLlmAppSettingsValue({}, {
    localLlmAppsEnabled: true,
    aiProofreadBuild: true
  }), {
    llmGpuMode: 'gpu',
    proofreadModelTier: 'e4b'
  });
});

test('LLM inference parameter helpers preserve keys, normalization, and immutability', () => {
  assert.equal(buildLlmInferenceParamsKeyValue('local_gguf', 'ignored'), 'local_gguf');
  assert.equal(buildLlmInferenceParamsKeyValue('lmstudio', ' model '), 'lmstudio:model');
  assert.equal(buildLlmInferenceParamsKeyValue('ollama', '  '), 'ollama');

  const settings: AppSettingsV1 = {
    llm: {
      llmParallel: 4,
      inferenceParamsByKey: {
        local_gguf: { nCtx: 5000, maxBatch: 200 },
        preserved: { nCtx: 8192, maxBatch: 20 }
      }
    }
  };
  assert.deepEqual(getStoredLlmInferenceParamsValue(settings, 'local_gguf'), {
    nCtx: 5120,
    maxBatch: 100
  });
  assert.deepEqual(getStoredLlmInferenceParamsValue(settings, 'missing'), {
    nCtx: 0,
    maxBatch: 40
  });

  const updated = updateStoredLlmInferenceParamsValue(
    settings,
    'local_gguf',
    { nCtx: 9000, maxBatch: 0 }
  );
  assert.deepEqual(updated.llm?.inferenceParamsByKey?.local_gguf, {
    nCtx: 9216,
    maxBatch: 1
  });
  assert.deepEqual(settings.llm?.inferenceParamsByKey?.local_gguf, {
    nCtx: 5000,
    maxBatch: 200
  });

  const reset = updateStoredLlmInferenceParamsValue(updated, 'local_gguf', null, true);
  assert.equal(reset.llm?.inferenceParamsByKey?.local_gguf, undefined);
  assert.deepEqual(reset.llm?.inferenceParamsByKey?.preserved, { nCtx: 8192, maxBatch: 20 });
  assert.equal(reset.llm?.llmParallel, 0);
});

test('LLM selection updates preserve model-specific saved dictionaries', () => {
  const settings: AppSettingsV1 = {
    export: { addUtteranceNumber: true },
    llm: {
      systemPromptsByBackend: { 'ollama:model': 'prompt' },
      inferenceParamsByKey: { local_gguf: { nCtx: 8192, maxBatch: 40 } }
    }
  };
  const updated = updateLlmSelectionSettingsValue(settings, {
    modelPath: '/models/model.gguf',
    backendMode: 'local_gguf',
    llmGpuMode: 'gpu',
    lemonadeUrl: 'http://localhost:13306',
    lemonadeModel: 'Gemma-4-E4B-it-QAT',
    lmstudioModel: 'studio',
    ollamaModel: 'ollama',
    lemonadeBackendNotNeeded: false,
    llmHipDeviceIndex: 1,
    llmPromptType: 'gemma4',
    llmParallel: 2,
    proofreadModelTier: 'e4b'
  });

  assert.deepEqual(updated.llm?.systemPromptsByBackend, { 'ollama:model': 'prompt' });
  assert.deepEqual(updated.llm?.inferenceParamsByKey, {
    local_gguf: { nCtx: 8192, maxBatch: 40 }
  });
  assert.equal(updated.llm?.modelPath, '/models/model.gguf');
  assert.deepEqual(updated.export, { addUtteranceNumber: true });
  assert.equal(settings.llm?.modelPath, undefined);
});

test('LLM scoped setting keys separate local files from external backend models', () => {
  assert.deepEqual(
    buildLlmScopedSettingsKeyValue('local_gguf', 'ignored', 'C:\\models\\custom.gguf'),
    { scope: 'model', key: 'custom.gguf' }
  );
  assert.deepEqual(
    buildLlmScopedSettingsKeyValue('lmstudio', ' local/model ', '/ignored.gguf'),
    { scope: 'backend', key: 'lmstudio:local/model' }
  );
  assert.equal(buildLlmScopedSettingsKeyValue('ollama', ' ', '/ignored.gguf'), null);
  assert.equal(buildLlmScopedSettingsKeyValue('local_gguf', 'ignored', ''), null);
});

test('LLM string setting helpers read, update, and reset only the selected dictionary entry', () => {
  const settings: AppSettingsV1 = {
    llm: {
      systemPromptsByBackend: { 'ollama:a': 'segment-a' },
      overallSystemPromptsByBackend: {
        'ollama:a': 'overall-a',
        'ollama:b': 'overall-b'
      }
    }
  };
  assert.equal(
    getStoredLlmStringSettingValue(settings, 'overallSystemPromptsByBackend', 'ollama:a'),
    'overall-a'
  );
  assert.equal(
    hasStoredLlmStringSettingValue(settings, 'overallSystemPromptsByBackend', 'missing'),
    false
  );

  const updated = updateStoredLlmStringSettingValue(
    settings,
    'overallSystemPromptsByBackend',
    'ollama:a',
    'changed'
  );
  assert.equal(
    getStoredLlmStringSettingValue(updated, 'overallSystemPromptsByBackend', 'ollama:a'),
    'changed'
  );
  assert.equal(
    getStoredLlmStringSettingValue(updated, 'overallSystemPromptsByBackend', 'ollama:b'),
    'overall-b'
  );
  assert.equal(
    getStoredLlmStringSettingValue(updated, 'systemPromptsByBackend', 'ollama:a'),
    'segment-a'
  );
  assert.equal(
    getStoredLlmStringSettingValue(settings, 'overallSystemPromptsByBackend', 'ollama:a'),
    'overall-a'
  );

  const reset = updateStoredLlmStringSettingValue(
    updated,
    'overallSystemPromptsByBackend',
    'ollama:a',
    null
  );
  assert.equal(
    getStoredLlmStringSettingValue(reset, 'overallSystemPromptsByBackend', 'ollama:a'),
    undefined
  );
  assert.equal(
    getStoredLlmStringSettingValue(reset, 'overallSystemPromptsByBackend', 'ollama:b'),
    'overall-b'
  );
});

test('LLM prompt type helpers validate stored values and update immutably', () => {
  const settings = {
    llm: { promptTypeByBackend: { 'ollama:a': 'original', invalid: 'other' } }
  } as unknown as AppSettingsV1;
  assert.equal(getStoredLlmPromptTypeValue(settings, 'ollama:a'), 'original');
  assert.equal(getStoredLlmPromptTypeValue(settings, 'invalid'), undefined);

  const updated = updateStoredLlmPromptTypeValue(settings, 'ollama:a', 'gemma4');
  assert.equal(getStoredLlmPromptTypeValue(updated, 'ollama:a'), 'gemma4');
  assert.equal(getStoredLlmPromptTypeValue(settings, 'ollama:a'), 'original');
});
