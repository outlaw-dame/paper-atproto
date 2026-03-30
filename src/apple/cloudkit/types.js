// ─── CloudKit Mirror Record Types ────────────────────────────────────────────
// These record types are for Apple-only convenience state only.
// Protocol records, auth, follows, likes, and canonical drafts must NOT be here.
// ─── Record name helpers ──────────────────────────────────────────────────────
export function prefRecordName(did, key) {
    return `pref:${did}:${key}`;
}
export function readposRecordName(did, threadUriHash) {
    return `readpos:${did}:${threadUriHash}`;
}
export function draftRecoveryRecordName(did, draftId) {
    return `draftrecovery:${did}:${draftId}`;
}
export function recentViewRecordName(did, entityType, entityId) {
    return `recent:${did}:${entityType}:${entityId}`;
}
//# sourceMappingURL=types.js.map