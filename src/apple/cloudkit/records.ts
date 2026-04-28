// ─── CloudKit Record Validation & Serialization ───────────────────────────────

import { CloudKitSchemaError } from './errors';
import type { MirrorRecordBase, CloudKitMirrorRecordType } from './types';

const VALID_RECORD_TYPES = new Set<CloudKitMirrorRecordType>([
  'UserPreference',
  'ReadingPosition',
  'DraftRecovery',
  'RecentView',
]);

export function validateMirrorRecord(input: unknown): MirrorRecordBase {
  if (!input || typeof input !== 'object') {
    throw new CloudKitSchemaError('Invalid record: not an object');
  }
  const r = input as Record<string, unknown>;

  if (typeof r.recordName !== 'string' || !r.recordName) {
    throw new CloudKitSchemaError('Invalid record: missing recordName');
  }
  if (!VALID_RECORD_TYPES.has(r.recordType as CloudKitMirrorRecordType)) {
    throw new CloudKitSchemaError(`Invalid record type: ${String(r.recordType)}`);
  }
  if (typeof r.userDid !== 'string' || !r.userDid.startsWith('did:')) {
    throw new CloudKitSchemaError('Invalid record: invalid userDid');
  }
  if (typeof r.updatedAt !== 'string') {
    throw new CloudKitSchemaError('Invalid record: missing updatedAt');
  }
  if (typeof r.schemaVersion !== 'number') {
    throw new CloudKitSchemaError('Invalid record: missing schemaVersion');
  }

  return r as unknown as MirrorRecordBase;
}

export function serializeMirrorRecord(record: MirrorRecordBase): Record<string, unknown> {
  return { ...record };
}

export function deserializeMirrorRecord(input: unknown): MirrorRecordBase | null {
  try {
    return validateMirrorRecord(input);
  } catch {
    return null;
  }
}
