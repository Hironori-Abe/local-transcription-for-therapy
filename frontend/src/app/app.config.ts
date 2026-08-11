import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

export const appConfig: ApplicationConfig = {
  providers: [
    // zone.js polyfill を使う zoneful 構成を明示する。
    // 未設定だと NgZone の挙動が Angular の内部デフォルトに依存して不定になり、
    // Tauri invoke 後の ngZone.run() による change detection が走らない（GPU/セットアップ
    // バナーが古いまま残り、ウィンドウ最前面化で初めて消える）ことがある。
    // スクロールやポインター操作などで短時間に連続するイベント／NgZone.run を
    // 1フレームへまとめる。巨大な編集テーブルを不要に何度も変更検知しないため。
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    provideAnimationsAsync()
  ]
};
