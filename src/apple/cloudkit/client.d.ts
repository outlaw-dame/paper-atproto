import type { MirrorRecordBase, CloudKitMirrorRecordType } from './types.js';
export interface CloudKitClient {
    saveRecord(record: MirrorRecordBase): Promise<void>;
    fetchRecord(recordName: string): Promise<MirrorRecordBase | null>;
    deleteRecord(recordName: string): Promise<void>;
    queryRecords(recordType: CloudKitMirrorRecordType, userDid: string): Promise<MirrorRecordBase[]>;
}
export declare function getCloudKitClient(): Promise<CloudKitClient>;
//# sourceMappingURL=client.d.ts.map