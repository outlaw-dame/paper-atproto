type RawLabel = {
  val?: unknown;
  src?: unknown;
  neg?: unknown;
};

export interface LabelChip {
  key: string;
  text: string;
  tone: 'neutral' | 'warning' | 'danger' | 'info';
}

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:_-]/g, '')
    .slice(0, 64);
}

function normalizeDid(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function compactLabelText(value: string): string {
  const normalized = normalizeToken(value);
  if (!normalized) return 'Labeled';

  if (/porn|sexual|sex|adult|nudity|nsfw/.test(normalized)) return 'Adult';
  if (/graphic|gore|violence|blood/.test(normalized)) return 'Graphic';
  if (/spam|scam|phishing/.test(normalized)) return 'Spam';
  if (/impersonat|identity/.test(normalized)) return 'Impersonation';
  if (/mislead|false|fake/.test(normalized)) return 'Misleading';
  if (/hate|harass|abuse/.test(normalized)) return 'Abusive';

  const title = normalized
    .replace(/[:_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return title.slice(0, 24);
}

function labelTone(value: string): LabelChip['tone'] {
  const normalized = normalizeToken(value);
  if (/graphic|gore|violence|blood|hate|harass|abuse|impersonat|scam|spam/.test(normalized)) {
    return 'danger';
  }
  if (/porn|sexual|sex|adult|nudity|nsfw/.test(normalized)) {
    return 'warning';
  }
  return 'neutral';
}

function parseRawLabels(raw: unknown): Array<{ val: string; src: string; neg: boolean }> {
  if (!Array.isArray(raw)) return [];

  const parsed: Array<{ val: string; src: string; neg: boolean }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = item as RawLabel;
    if (typeof label.val !== 'string') continue;
    const val = normalizeToken(label.val);
    if (!val) continue;
    parsed.push({
      val,
      src: normalizeDid(label.src),
      neg: Boolean(label.neg),
    });
    if (parsed.length >= 12) break;
  }

  return parsed;
}

function buildLabelChips(params: {
  labels: Array<{ val: string; src: string; neg: boolean }>;
  actorDid?: string;
  maxChips: number;
  includeLabellerProvenance?: boolean;
}): LabelChip[] {
  const actorDid = normalizeDid(params.actorDid);
  const labels = params.labels.filter((entry) => !entry.neg);
  if (labels.length === 0) return [];

  const includeLabellerProvenance = params.includeLabellerProvenance !== false;
  const hasExternalLabeller = labels.some((label) => label.src && label.src !== actorDid);
  const hasSelfLabel = labels.some((label) => label.src && label.src === actorDid);
  const reserveForProvenance = includeLabellerProvenance && (hasExternalLabeller || hasSelfLabel) ? 1 : 0;
  const labelChipLimit = Math.max(0, params.maxChips - reserveForProvenance);

  const chips: LabelChip[] = [];
  const seen = new Set<string>();

  for (const label of labels) {
    const text = compactLabelText(label.val);
    const key = `label:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({
      key,
      text,
      tone: labelTone(label.val),
    });
    if (chips.length >= labelChipLimit) break;
  }

  if (reserveForProvenance > 0) {
    if (hasExternalLabeller) {
      chips.push({ key: 'labeller:external', text: 'External labeller', tone: 'info' });
    } else if (hasSelfLabel) {
      chips.push({ key: 'labeller:self', text: 'Self-label', tone: 'info' });
    }
  }

  return chips.slice(0, Math.max(0, params.maxChips));
}

export function actorLabelChips(params: {
  labels: unknown;
  actorDid?: string;
  maxChips?: number;
}): LabelChip[] {
  return buildLabelChips({
    labels: parseRawLabels(params.labels),
    ...(params.actorDid ? { actorDid: params.actorDid } : {}),
    maxChips: Math.max(0, params.maxChips ?? 3),
    includeLabellerProvenance: true,
  });
}

export function postLabelChips(params: {
  contentLabels?: string[] | undefined;
  labelDetails?: Array<{ val: string; src?: string; neg: boolean }> | undefined;
  authorDid?: string | undefined;
  maxChips?: number | undefined;
  includeLabellerProvenance?: boolean | undefined;
}): LabelChip[] {
  const details = Array.isArray(params.labelDetails)
    ? params.labelDetails
      .map((label) => ({
        val: normalizeToken(label.val),
        src: normalizeDid(label.src),
        neg: Boolean(label.neg),
      }))
      .filter((label) => label.val.length > 0)
    : [];

  const labels = details.length > 0
    ? details
    : (params.contentLabels ?? []).map((val) => ({
      val: normalizeToken(val),
      src: '',
      neg: false,
    })).filter((label) => label.val.length > 0);

  return buildLabelChips({
    labels,
    ...(params.authorDid ? { actorDid: params.authorDid } : {}),
    maxChips: Math.max(0, params.maxChips ?? 2),
    includeLabellerProvenance: params.includeLabellerProvenance !== false,
  });
}
