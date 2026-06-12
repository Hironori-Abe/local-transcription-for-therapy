import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

export const appConfig: ApplicationConfig = {
  providers: [
    // zone.js polyfill を使う zoneful 構成を明示する。
    // 未設定だと NgZone の挙動が Angular の内部デフォルトに依存して不定になり、
    // Tauri invoke 後の ngZone.run() による change detection が走らない（GPU/セットアップ
    // バナーが古いまま残り、ウィンドウ最前面化で初めて消える）ことがある。
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAnimationsAsync()
  ]
};

