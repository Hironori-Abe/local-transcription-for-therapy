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
