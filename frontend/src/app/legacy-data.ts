export interface LegacyDataItem {
  label: string;
  path: string;
  /** null means measurement failed, rather than an empty item. */
  bytes: number | null;
}

export function formatLegacyDataSize(bytes: number | null): string {
  if (bytes === null) return '容量不明';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function groupLegacyData(items: ReadonlyArray<LegacyDataItem>): Array<{ label: string; bytes: number | null }> {
  const groups = new Map<string, number | null>();
  for (const item of items) {
    const previous = groups.get(item.label) ?? 0;
    groups.set(item.label, item.bytes === null || (groups.has(item.label) && groups.get(item.label) === null)
      ? null : previous + item.bytes);
  }
  return Array.from(groups, ([label, bytes]) => ({ label, bytes }));
}

export function legacyDataTotalLabel(items: ReadonlyArray<LegacyDataItem>): string {
  const known = items.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const unknown = items.some(item => item.bytes === null);
  return unknown ? (known > 0 ? `${formatLegacyDataSize(known)} ＋ 容量不明` : '容量不明')
    : formatLegacyDataSize(known);
}
