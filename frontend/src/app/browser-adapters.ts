/** localStorage のうち、このアプリが使用する最小インターフェース。 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * WebView の保存領域へ安全にアクセスするための境界。
 *
 * localStorage は無効化・容量超過・プライベートモード等で getter 自体や
 * getItem/setItem が例外を投げることがある。画面側へ例外を漏らさず、従来どおり
 * 読み込み失敗は既定値、保存失敗は現在の起動中だけの状態として扱う。
 */
export class BestEffortBrowserStorage {
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = resolveBrowserStorage()) {
    this.storage = storage;
  }

  readText(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  readTextWithLegacy(key: string, legacyKey: string): string | null {
    const current = this.readText(key);
    if (current !== null) {
      return current;
    }
    const legacy = this.readText(legacyKey);
    if (legacy !== null) {
      this.writeText(key, legacy);
    }
    return legacy;
  }

  readObject<T extends object>(key: string): T | null {
    const raw = this.readText(key);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' ? parsed as T : null;
    } catch {
      return null;
    }
  }

  readObjectWithLegacy<T extends object>(key: string, legacyKey: string): T | null {
    const raw = this.readTextWithLegacy(key, legacyKey);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' ? parsed as T : null;
    } catch {
      return null;
    }
  }

  writeText(key: string, value: string): boolean {
    try {
      if (!this.storage) {
        return false;
      }
      this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  writeJson(key: string, value: unknown): boolean {
    try {
      return this.writeText(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  readFlag(key: string): boolean {
    return this.readText(key) === '1';
  }

  readFlagWithLegacy(key: string, legacyKey: string): boolean {
    return this.readTextWithLegacy(key, legacyKey) === '1';
  }

  writeFlag(key: string): boolean {
    return this.writeText(key, '1');
  }
}

function resolveBrowserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface AudioMetadataElement {
  preload: string;
  duration: number;
  src: string;
  onloadedmetadata: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
}

export type AudioMetadataElementFactory = () => AudioMetadataElement;

/**
 * WebView のメディアバックエンドから再生時間を取得するフォールバック。
 * 対応デコーダがない WebKitGTK ではイベントが一切来ない場合があるため、
 * 成功・失敗のどちらでもタイマー、イベントハンドラ、src を必ず解放する。
 */
export function loadAudioMetadataDuration(
  src: string,
  timeoutMs = 12000,
  createAudio: AudioMetadataElementFactory = () => new Audio()
): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = createAudio();
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = '';
      action();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('audio metadata timeout'))),
      timeoutMs
    );
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      finish(() => {
        if (Number.isFinite(duration) && duration > 0) {
          resolve(duration);
        } else {
          reject(new Error('duration unavailable'));
        }
      });
    };
    audio.onerror = () => finish(() => reject(new Error('audio load failed')));
    audio.src = src;
  });
}

export interface SeekableAudioElement {
  currentTime: number;
  addEventListener(type: 'seeked', listener: () => void): void;
  removeEventListener(type: 'seeked', listener: () => void): void;
}

/**
 * WebKitGTKの非同期seek完了を待つ。イベントが来ないバックエンドでもtimeoutで進み、
 * 成功・timeout・currentTime設定失敗のすべてでlistenerとtimerを解放する。
 */
export function waitForAudioSeek(
  audio: SeekableAudioElement,
  targetSeconds: number,
  timeoutMs = 500
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeEventListener('seeked', onSeeked);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const onSeeked = (): void => finish();
    const timer = setTimeout(() => finish(), timeoutMs);
    audio.addEventListener('seeked', onSeeked);
    try {
      audio.currentTime = targetSeconds;
    } catch (error) {
      finish(error);
    }
  });
}
