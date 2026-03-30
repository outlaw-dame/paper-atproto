export type CloudKitMirrorRecordType = 'UserPreference' | 'ReadingPosition' | 'DraftRecovery' | 'RecentView';
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
export type MirrorRecord = UserPreferenceRecord | ReadingPositionRecord | DraftRecoveryRecord | RecentViewRecord;
export declare function prefRecordName(did: string, key: string): string;
export declare function readposRecordName(did: string, threadUriHash: string): string;
export declare function draftRecoveryRecordName(did: string, draftId: string): string;
export declare function recentViewRecordName(did: string, entityType: string, entityId: string): string;
//# sourceMappingURL=types.d.ts.map