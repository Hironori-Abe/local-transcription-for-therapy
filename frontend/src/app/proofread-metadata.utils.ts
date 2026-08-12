export interface NormalizedLintIssue {
  ruleId: string;
  message: string;
  line: number;
  column: number;
  severity: number;
}

export interface SensitiveEntityMetadata {
  hasSensitiveEntity: boolean;
  kinds: string[];
  names: string[];
  personNames?: string[];
  organizationNames?: string[];
  locationNames?: string[];
  personDetectionSource?: string;
}

export interface NormalizedSensitiveEntityMetadata extends SensitiveEntityMetadata {
  personNames: string[];
  organizationNames: string[];
  locationNames: string[];
  personDetectionSource: string;
}

export interface ExportProofreadMetadata {
  diff: {
    from: string;
    to: string;
  };
  confidence: number;
  reason: string;
  lintIssues?: NormalizedLintIssue[];
  sensitiveEntity?: SensitiveEntityMetadata;
}

export type ProofreadHighlightLevel = 'none' | 'yellow' | 'red';
export type SensitiveEntityHighlightInput = Partial<SensitiveEntityMetadata> | null | undefined;

export function normalizeLintIssuesValue(raw: unknown): NormalizedLintIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: NormalizedLintIssue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const lineRaw = Number(obj['line']);
    const columnRaw = Number(obj['column']);
    const severityRaw = Number(obj['severity']);
    out.push({
      ruleId: String(obj['ruleId'] ?? '').trim(),
      message: String(obj['message'] ?? '').trim(),
      line: Number.isFinite(lineRaw) ? lineRaw : 0,
      column: Number.isFinite(columnRaw) ? columnRaw : 0,
      severity: Number.isFinite(severityRaw) ? severityRaw : 1
    });
  }
  return out.filter((value) => value.message.length > 0 || value.ruleId.length > 0).slice(0, 8);
}

export function normalizeSensitiveEntityMetadataValue(raw: unknown): NormalizedSensitiveEntityMetadata {
  const allowedPersonDetectionSources = new Set(['honorific', 'dictionary', 'other', 'mixed']);
  const allowedKinds = new Set(['person', 'organization', 'corporation', 'location']);
  const empty: NormalizedSensitiveEntityMetadata = {
    hasSensitiveEntity: false,
    kinds: [],
    names: [],
    personNames: [],
    organizationNames: [],
    locationNames: [],
    personDetectionSource: ''
  };
  const normalizeNameList = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(new Set(
      value
        .map((entry) => String(entry).replace(/\s+/g, ' ').trim())
        .filter((entry) => entry.length > 0)
    )).slice(0, 8);
  };
  if (!raw || typeof raw !== 'object') {
    return empty;
  }

  const obj = raw as Record<string, unknown>;
  const has = obj['hasSensitiveEntity'] === true;
  const rawKinds = Array.isArray(obj['kinds']) ? obj['kinds'] : [];
  const kinds = rawKinds
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => allowedKinds.has(value));
  let names = normalizeNameList(obj['names']);
  let personNames = normalizeNameList(obj['personNames']);
  let organizationNames = normalizeNameList(obj['organizationNames']);
  let locationNames = normalizeNameList(obj['locationNames']);
  const sourceRaw = String(obj['personDetectionSource'] ?? '').trim().toLowerCase();
  const personDetectionSource = allowedPersonDetectionSources.has(sourceRaw) ? sourceRaw : '';

  if (names.length === 0) {
    names = Array.from(new Set([...personNames, ...organizationNames, ...locationNames])).slice(0, 8);
  }
  if (personNames.length === 0 && kinds.includes('person')) {
    const hasOnlyPerson = !kinds.some(
      (kind) => kind === 'organization' || kind === 'corporation' || kind === 'location'
    );
    if (hasOnlyPerson && (personDetectionSource === 'dictionary' || personDetectionSource === 'mixed')) {
      personNames = names;
    }
  }
  if (organizationNames.length === 0 && (kinds.includes('organization') || kinds.includes('corporation'))) {
    const hasOnlyOrganization = !kinds.some((kind) => kind === 'person' || kind === 'location');
    if (hasOnlyOrganization) {
      organizationNames = names;
    }
  }
  if (locationNames.length === 0 && kinds.includes('location')) {
    const hasOnlyLocation = !kinds.some(
      (kind) => kind === 'person' || kind === 'organization' || kind === 'corporation'
    );
    if (hasOnlyLocation) {
      locationNames = names;
    }
  }

  const hasAnyName = names.length > 0
    || personNames.length > 0
    || organizationNames.length > 0
    || locationNames.length > 0;
  return {
    hasSensitiveEntity: has && (kinds.length > 0 || hasAnyName),
    kinds,
    names,
    personNames,
    organizationNames,
    locationNames,
    personDetectionSource
  };
}

export function normalizeProofreadMetadataValue(
  originalTextRaw: string,
  revisedTextRaw: string,
  confidenceRaw: number,
  reasonRaw: string,
  sensitiveEntityRaw?: unknown,
  lintIssuesRaw?: unknown
): ExportProofreadMetadata {
  const originalText = typeof originalTextRaw === 'string' ? originalTextRaw : '';
  const revisedText = typeof revisedTextRaw === 'string' ? revisedTextRaw : originalText;
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';
  return {
    diff: {
      from: originalText,
      to: revisedText
    },
    confidence,
    reason,
    lintIssues: normalizeLintIssuesValue(lintIssuesRaw),
    sensitiveEntity: normalizeSensitiveEntityMetadataValue(sensitiveEntityRaw)
  };
}

export function getSensitiveEntityHighlightLevelValue(
  sensitive?: SensitiveEntityHighlightInput
): ProofreadHighlightLevel {
  if (sensitive?.hasSensitiveEntity !== true) {
    return 'none';
  }
  const personNames = sensitive.personNames ?? [];
  const locationNames = sensitive.locationNames ?? [];
  if (personNames.length > 0 || locationNames.length > 0) {
    return 'red';
  }
  const kinds = sensitive.kinds ?? [];
  const names = sensitive.names ?? [];
  const organizationNames = sensitive.organizationNames ?? [];
  return kinds.length > 0 || names.length > 0 || organizationNames.length > 0 ? 'yellow' : 'none';
}

export function compactProofreadHintTextValue(valueRaw: string, maxLength = 120): string {
  const value = (valueRaw ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

export function isPunctuationOnlyProofreadReasonValue(reasonRaw: string): boolean {
  const reason = (reasonRaw ?? '').trim();
  return reason === '文末句点の補完'
    || reason === '句読点・記号の調整'
    || reason === 'sentence_final_period_added'
    || reason === 'punctuation_adjustment'
    || /^「[、。！？…・]」を追加$/.test(reason);
}

/**
 * LLM の自由記述ではなく実際の差分から、校正理由を生成する。
 * 句読点・空白以外も変化した場合は空文字を返し、呼び出し側の原文比較表示へ委ねる。
 */
export function describeProofreadDiffReasonValue(previous: string, revised: string): string {
  if (previous === revised) {
    return '';
  }
  const punctuationMarks = ['、', '。', '！', '？', '!', '?', '…', '・'];
  const punctuationSet = new Set(punctuationMarks);
  const isStrippedCharacter = (character: string): boolean =>
    punctuationSet.has(character)
    || character === ' '
    || character === '\t'
    || character === '\r'
    || character === '\n'
    || character === '　';
  const strip = (value: string): string =>
    Array.from(value).filter((character) => !isStrippedCharacter(character)).join('');
  if (strip(previous) !== strip(revised)) {
    return '';
  }

  const countMarks = (value: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const character of value) {
      if (punctuationSet.has(character)) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    return counts;
  };
  const before = countMarks(previous);
  const after = countMarks(revised);
  const added: string[] = [];
  let removedAny = false;
  for (const mark of punctuationMarks) {
    const delta = (after.get(mark) ?? 0) - (before.get(mark) ?? 0);
    if (delta > 0) {
      added.push(mark);
    } else if (delta < 0) {
      removedAny = true;
    }
  }
  if (added.length > 0 && !removedAny) {
    return `${added.join('')}を追加`;
  }
  return '句読点・記号の調整';
}

export function buildSensitiveEntityProofreadHintValue(
  sensitive: NormalizedSensitiveEntityMetadata
): string | null {
  if (!sensitive.hasSensitiveEntity) {
    return null;
  }
  const compactNames = (values: string[]): string =>
    compactProofreadHintTextValue(values.length > 0 ? values.join('、') : '名称不明');
  const redNames = [...sensitive.personNames, ...sensitive.locationNames];
  if (sensitive.personNames.length > 0) {
    return `人名・地名混入の可能性: ${compactNames(redNames)}`;
  }
  if (sensitive.locationNames.length > 0) {
    return `地名混入の可能性: ${compactNames(sensitive.locationNames)}`;
  }
  if (sensitive.organizationNames.length > 0) {
    return `組織名など混入の可能性: ${compactNames(sensitive.organizationNames)}`;
  }
  if (sensitive.kinds.includes('person') && sensitive.personDetectionSource === 'honorific') {
    return '人名混入の可能性: さん／君などの検出';
  }
  return `固有名詞混入の可能性: ${compactNames(sensitive.names)}`;
}

export function buildProofreadHintValue(
  originalText: string,
  revisedText: string,
  reasonRaw: string,
  sensitiveEntityRaw?: unknown
): string {
  const sensitive = normalizeSensitiveEntityMetadataValue(sensitiveEntityRaw);
  const sensitiveHint = buildSensitiveEntityProofreadHintValue(sensitive);
  if (sensitiveHint) {
    return sensitiveHint;
  }
  const reason = (reasonRaw ?? '').trim();
  if (isPunctuationOnlyProofreadReasonValue(reason)) {
    return `句読点の調整：（元文） ${compactProofreadHintTextValue(originalText)}`;
  }
  if (reason && reason !== 'llm_correction') {
    return `AI: ${compactProofreadHintTextValue(reason)}`;
  }
  if (!revisedText || revisedText === originalText) {
    return 'AI：（変更無し）';
  }
  return `AI（元文）: 「${compactProofreadHintTextValue(originalText)}」`;
}
