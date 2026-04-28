// ─── Preference Mirror ────────────────────────────────────────────────────────
// Mirror Apple-only UI preferences to CloudKit.
// Uses an explicit allowlist — no arbitrary key mirroring.
// Local store writes first; this is async fire-and-forget with retry.
// CloudKit failure never blocks UI.

import { getCloudKitClient } from '../client';
import { prefRecordName } from '../types';
import type { UserPreferenceRecord } from '../types';

// Only these keys may be mirrored. No unbounded set.
const ALLOWED_PREFERENCE_KEYS = new Set([
  'ui.layout.compact',
  'ui.media.autoplay',
  'ui.gesture.haptics',
  'ui.reader.motionReduced',
  'ui.reader.cardDensity',
]);

export async function mirrorPreference(
  userDid: string,
  key: string,
  value: string
): Promise<void> {
  if (!ALLOWED_PREFERENCE_KEYS.has(key)) {
    console.warn('[CloudKit] mirrorPreference: key not in allowlist:', key);
    return;
  }

  try {
    const client = await getCloudKitClient();
    const record: UserPreferenceRecord = {
      recordName: prefRecordName(userDid, key),
      recordType: 'UserPreference',
      userDid,
      key,
      value,
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    await client.saveRecord(record);
  } catch {
    // Fire-and-forget — never propagate errors to UI.
  }
}

export async function hydrateMirroredPreferences(
  userDid: string
): Promise<Record<string, string>> {
  try {
    const client = await getCloudKitClient();
    const records = await client.queryRecords('UserPreference', userDid);
    const result: Record<string, string> = {};
    for (const r of records) {
      const pref = r as UserPreferenceRecord;
      if (pref.key && ALLOWED_PREFERENCE_KEYS.has(pref.key) && typeof pref.value === 'string') {
        result[pref.key] = pref.value;
      }
    }
    return result;
  } catch {
    return {};
  }
}
