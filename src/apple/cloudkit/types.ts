// ─── CloudKit Mirror Record Types ────────────────────────────────────────────
// These record types are for Apple-only convenience state only.
// Protocol records, auth, follows, likes, and canonical drafts must NOT be here.

export type CloudKitMirrorRecordType =
  | 'UserPreference'
  | 'ReadingPosition'
  | 'DraftRecovery'
  | 'RecentView';

export interface MirrorRecordBase {
  recordName: string;
  recordType: CloudKitMirrorRecordType;
  /** ATProto DID of the owning user. */
  userDid: string;
  updatedAt: string;
  schemaVersion: number;
  deviceClass?: 'iphone' | 'ipad' | 'mac' | 'unknown';
}

export interface UserPreferenceRecord extends MirrorRecordBase {
  recordType: 'UserPreference';
  /** Allowlisted key only — see preferenceMirror.ts */
  key: string;
  value: string;
}

export interface ReadingPositionRecord extends MirrorRecordBase {
  recordType: 'ReadingPosition';
  threadUri: string;
  position: string;
}

export interface DraftRecoveryRecord extends MirrorRecordBase {
  recordType: 'DraftRecovery';
  draftId: string;
  /** AES-GCM-256 encrypted payload — never plaintext. */
  encryptedPayload: string;
  iv: string;
  algorithm: 'AES-GCM-256';
}

export interface RecentViewRecord extends MirrorRecordBase {
  recordType: 'RecentView';
  entityType: 'profile' | 'post' | 'thread' | 'search';
  entityId: string;
}

export type MirrorRecord =
  | UserPreferenceRecord
  | ReadingPositionRecord
  | DraftRecoveryRecord
  | RecentViewRecord;

// ─── Record name helpers ──────────────────────────────────────────────────────

export function prefRecordName(did: string, key: string): string {
  return `pref:${did}:${key}`;
}

export function readposRecordName(did: string, threadUriHash: string): string {
  return `readpos:${did}:${threadUriHash}`;
}

export function draftRecoveryRecordName(did: string, draftId: string): string {
  return `draftrecovery:${did}:${draftId}`;
}

export function recentViewRecordName(did: string, entityType: string, entityId: string): string {
  return `recent:${did}:${entityType}:${entityId}`;
}
