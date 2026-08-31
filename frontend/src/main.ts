import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import {
  APP_SETTINGS_STORAGE_KEY,
  LEGACY_APP_SETTINGS_STORAGE_KEY
} from './app/storage-keys';

/**
 * 保存済みの表示テーマを bootstrap 前に反映する。
 * ngOnInit まで待つと、OS 設定と異なるテーマを選んでいる場合に一瞬ちらつくため。
 */
function applyStoredThemeEarly(): void {
  try {
    const current = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    const raw = current ?? window.localStorage.getItem(LEGACY_APP_SETTINGS_STORAGE_KEY);
    if (current === null && raw !== null) {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, raw);
    }
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
