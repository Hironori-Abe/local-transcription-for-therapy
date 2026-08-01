import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

/**
 * 保存済みの表示テーマを bootstrap 前に反映する。
 * ngOnInit まで待つと、OS 設定と異なるテーマを選んでいる場合に一瞬ちらつくため。
 */
function applyStoredThemeEarly(): void {
  try {
    const raw = window.localStorage.getItem('offline_transcriber_app_settings_v1');
    const mode = raw ? (JSON.parse(raw) as { ui?: { themeMode?: string } }).ui?.themeMode : undefined;
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  } catch {
    // 読めなければ既定（システムに合わせる）のまま起動する
  }
}

applyStoredThemeEarly();

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
