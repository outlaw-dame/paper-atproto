// ─── CloudKit Record Validation & Serialization ───────────────────────────────
import { CloudKitSchemaError } from './errors.js';
const VALID_RECORD_TYPES = new Set([
    'UserPreference',
    'ReadingPosition',
    'DraftRecovery',
    'RecentView',
]);
export function validateMirrorRecord(input) {
    if (!input || typeof input !== 'object') {
        throw new CloudKitSchemaError('Invalid record: not an object');
    }
    const r = input;
    if (typeof r.recordName !== 'string' || !r.recordName) {
        throw new CloudKitSchemaError('Invalid record: missing recordName');
    }
    if (!VALID_RECORD_TYPES.has(r.recordType)) {
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
    return r;
}
export function serializeMirrorRecord(record) {
    return { ...record };
}
export function deserializeMirrorRecord(input) {
    try {
        return validateMirrorRecord(input);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=records.js.map