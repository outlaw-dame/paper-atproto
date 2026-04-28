// ─── Reading Position Mirror ──────────────────────────────────────────────────
// Sync reading position for threads across Apple devices.
// Last-write-wins — acceptable for convenience-only state.
// Thread URIs are hashed to keep record names bounded.

import { getCloudKitClient } from '../client';
import { readposRecordName } from '../types';
import type { ReadingPositionRecord } from '../types';

export async function mirrorReadingPosition(
  userDid: string,
  threadUri: string,
  position: string
): Promise<void> {
  try {
    const client = await getCloudKitClient();
    const hash = await hashUri(threadUri);
    const record: ReadingPositionRecord = {
      recordName: readposRecordName(userDid, hash),
      recordType: 'ReadingPosition',
      userDid,
      threadUri,
      position: position.slice(0, 200),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    await client.saveRecord(record);
  } catch {
    // Non-fatal.
  }
}

export async function getMirroredReadingPosition(
  userDid: string,
  threadUri: string
): Promise<string | null> {
  try {
    const client = await getCloudKitClient();
    const hash = await hashUri(threadUri);
    const record = await client.fetchRecord(readposRecordName(userDid, hash));
    if (!record) return null;
    return (record as ReadingPositionRecord).position ?? null;
  } catch {
    return null;
  }
}

async function hashUri(uri: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(uri);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    // Fallback: truncated base64 if SubtleCrypto unavailable.
    return btoa(uri).replace(/[^a-z0-9]/gi, '').slice(0, 32);
  }
}
