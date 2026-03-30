// ─── CloudKit Client ──────────────────────────────────────────────────────────
// Transport wrapper around CloudKit JS.
// All CloudKit operations go through here.
// Maps transport/auth/schema failures to typed errors.
// Validates all record shapes before sending and after receiving.
import { CloudKitConfigError, CloudKitAuthError, CloudKitTransportError, CloudKitSchemaError } from './errors.js';
import { validateMirrorRecord, serializeMirrorRecord, deserializeMirrorRecord } from './records.js';
import { retryWithFullJitter } from './retry.js';
function getDatabase() {
    const CK = window.CloudKit;
    if (!CK)
        throw new CloudKitConfigError('CloudKit JS not loaded');
    return CK.getDefaultContainer().privateCloudDatabase;
}
export async function getCloudKitClient() {
    // Verify CloudKit is loaded before returning the client object.
    getDatabase();
    return {
        saveRecord: saveRecord,
        fetchRecord: fetchRecord,
        deleteRecord: deleteRecord,
        queryRecords: queryRecords,
    };
}
async function saveRecord(record) {
    validateMirrorRecord(record);
    await retryWithFullJitter(async () => {
        try {
            const db = getDatabase();
            const serialized = serializeMirrorRecord(record);
            const result = await db.saveRecords([{ recordName: record.recordName, fields: serialized }]);
            if (!result?.records?.length)
                throw new CloudKitTransportError('saveRecord returned empty result');
        }
        catch (err) {
            if (err instanceof CloudKitConfigError || err instanceof CloudKitSchemaError)
                throw err;
            if (err instanceof CloudKitAuthError)
                throw err;
            throw new CloudKitTransportError('saveRecord failed', err);
        }
    });
}
async function fetchRecord(recordName) {
    return retryWithFullJitter(async () => {
        try {
            const db = getDatabase();
            const result = await db.fetchRecords([{ recordName }]);
            const raw = result?.records?.[0];
            if (!raw)
                return null;
            return deserializeMirrorRecord(raw.fields ?? raw);
        }
        catch (err) {
            if (err instanceof CloudKitConfigError || err instanceof CloudKitSchemaError)
                throw err;
            if (err instanceof CloudKitAuthError)
                throw err;
            throw new CloudKitTransportError('fetchRecord failed', err);
        }
    });
}
async function deleteRecord(recordName) {
    await retryWithFullJitter(async () => {
        try {
            const db = getDatabase();
            await db.deleteRecords([{ recordName }]);
        }
        catch (err) {
            if (err instanceof CloudKitConfigError || err instanceof CloudKitSchemaError)
                throw err;
            throw new CloudKitTransportError('deleteRecord failed', err);
        }
    });
}
async function queryRecords(recordType, userDid) {
    return retryWithFullJitter(async () => {
        try {
            const db = getDatabase();
            const result = await db.performQuery({
                recordType,
                filterBy: [{ fieldName: 'userDid', comparator: 'EQUALS', fieldValue: { value: userDid } }],
            });
            return (result?.records ?? [])
                .map((r) => deserializeMirrorRecord(r.fields ?? r))
                .filter((r) => r !== null);
        }
        catch (err) {
            if (err instanceof CloudKitConfigError || err instanceof CloudKitSchemaError)
                throw err;
            throw new CloudKitTransportError('queryRecords failed', err);
        }
    });
}
//# sourceMappingURL=client.js.map