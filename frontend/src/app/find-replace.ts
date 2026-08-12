export interface FindReplaceRow {
  id: number;
  text: string;
}

export interface FindReplaceUpdate {
  id: number;
  text: string;
}

export interface FindReplaceResult {
  replacements: number;
  updates: FindReplaceUpdate[];
}

/** 表示順で最初に見つかった1件だけを置換する。 */
export function replaceFirstInRows(
  rows: ReadonlyArray<FindReplaceRow>,
  findText: string,
  replaceText: string
): FindReplaceResult {
  if (!findText) {
    return { replacements: 0, updates: [] };
  }
  for (const row of rows) {
    const index = row.text.indexOf(findText);
    if (index < 0) {
      continue;
    }
    return {
      replacements: 1,
      updates: [{
        id: row.id,
        text: `${row.text.slice(0, index)}${replaceText}${row.text.slice(index + findText.length)}`
      }]
    };
  }
  return { replacements: 0, updates: [] };
}

/** 全行を対象に、重複しない一致をすべて置換する。 */
export function replaceAllInRows(
  rows: ReadonlyArray<FindReplaceRow>,
  findText: string,
  replaceText: string
): FindReplaceResult {
  if (!findText) {
    return { replacements: 0, updates: [] };
  }
  let replacements = 0;
  const updates: FindReplaceUpdate[] = [];
  for (const row of rows) {
    const parts = row.text.split(findText);
    const count = parts.length - 1;
    if (count === 0) {
      continue;
    }
    replacements += count;
    updates.push({ id: row.id, text: parts.join(replaceText) });
  }
  return { replacements, updates };
}
