export type TranscriptionExportKind = 'json' | 'docx' | 'xlsx' | 'srt' | 'runtime-csv';

export interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

export interface TranscriptionSavePlan {
  title: string;
  defaultPath: string;
  extension: string;
  filters: SaveDialogFilter[];
}

export function buildDefaultExportFileName(kind: TranscriptionExportKind, now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  const stamp = `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
  switch (kind) {
    case 'docx': return `lott_${stamp}.docx`;
    case 'xlsx': return `lott_${stamp}_${milliseconds}.xlsx`;
    case 'srt': return `lott_${stamp}.srt`;
    case 'json': return `lott_${stamp}.json`;
    case 'runtime-csv': return `lott_runtime_log_${stamp}.csv`;
  }
}

export function buildTranscriptionSavePlan(
  kind: TranscriptionExportKind,
  hasPassword: boolean,
  now = new Date()
): TranscriptionSavePlan {
  if (kind === 'json' || kind === 'srt') {
    const zipped = hasPassword;
    const extension = zipped ? '.zip' : `.${kind}`;
    const defaultPath = zipped
      ? buildDefaultExportFileName(kind, now).replace(new RegExp(`\\.${kind}$`), '.zip')
      : buildDefaultExportFileName(kind, now);
    return {
      title: kind === 'json' ? '文字起こし結果を保存' : '文字起こし結果（SRT字幕）を保存',
      defaultPath,
      extension,
      filters: [{
        name: zipped ? (kind === 'json' ? 'ZIP' : 'パスワード付きZIP') : (kind === 'json' ? 'JSON' : 'SRT字幕'),
        extensions: [extension.slice(1)]
      }]
    };
  }
  if (kind === 'docx') {
    return {
      title: '文字起こし結果（Word）を保存',
      defaultPath: buildDefaultExportFileName(kind, now),
      extension: '.docx',
      filters: [{ name: 'Word', extensions: ['docx'] }]
    };
  }
  if (kind === 'xlsx') {
    return {
      title: '文字起こし結果（Excel）を保存',
      defaultPath: buildDefaultExportFileName(kind, now),
      extension: '.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    };
  }
  return {
    title: '文字起こし・AI句読点付与 所要時間ログを保存',
    defaultPath: buildDefaultExportFileName(kind, now),
    extension: '.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  };
}

export function ensureExportPathExtension(path: string, extension: string): string {
  return path.toLowerCase().endsWith(extension.toLowerCase()) ? path : `${path}${extension}`;
}
