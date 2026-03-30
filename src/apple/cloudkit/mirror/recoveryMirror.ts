// ─── Draft Recovery Mirror ────────────────────────────────────────────────────
// Optional encrypted draft recovery snapshots mirrored to CloudKit.
//
// SECURITY: Plaintext draft content is NEVER uploaded.
// All payloads are encrypted client-side with AES-GCM-256 before upload.
// Key derivation uses PBKDF2 from a device-scoped secret.
//
// If encryption cannot be set up correctly, the module returns early.
// Keep draft recovery local-only until you are ready to manage
// client-side encryption correctly.
//
// Feature flag: VITE_ENABLE_DRAFT_RECOVERY_MIRROR=true must be set.

import { getCloudKitClient } from '../client.js';
import { draftRecoveryRecordName } from '../types.js';
import type { DraftRecoveryRecord } from '../types.js';

const ENABLED = import.meta.env.VITE_ENABLE_DRAFT_RECOVERY_MIRROR === 'true';
const ALGORITHM = 'AES-GCM';
const KEY_BITS = 256;
const PBKDF2_ITERATIONS = 200_000;
const SALT_STORAGE_KEY = 'glimpse-dk-salt';

// ─── Public API ───────────────────────────────────────────────────────────────

export async function mirrorDraftRecovery(
  userDid: string,
  draftId: string,
  plaintextPayload: string
): Promise<void> {
  if (!ENABLED) return;
  try {
    const { encryptedPayload, iv } = await encrypt(plaintextPayload, userDid);
    const client = await getCloudKitClient();
    const record: DraftRecoveryRecord = {
      recordName: draftRecoveryRecordName(userDid, draftId),
      recordType: 'DraftRecovery',
      userDid,
      draftId,
      encryptedPayload,
      iv,
      algorithm: 'AES-GCM-256',
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    await client.saveRecord(record);
  } catch {
    // Non-fatal — local draft remains the source of truth.
  }
}

export async function restoreDraftRecovery(
  userDid: string,
  draftId: string
): Promise<string | null> {
  if (!ENABLED) return null;
  try {
    const client = await getCloudKitClient();
    const record = await client.fetchRecord(draftRecoveryRecordName(userDid, draftId));
    if (!record) return null;
    const dr = record as DraftRecoveryRecord;
    if (dr.algorithm !== 'AES-GCM-256') return null;
    return await decrypt(dr.encryptedPayload, dr.iv, userDid);
  } catch {
    return null;
  }
}

// ─── Encryption internals ─────────────────────────────────────────────────────

async function deriveKey(userDid: string): Promise<CryptoKey> {
  const salt = getOrCreateSalt();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(userDid),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGORITHM, length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext: string, userDid: string): Promise<{ encryptedPayload: string; iv: string }> {
  const key = await deriveKey(userDid);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    enc.encode(plaintext)
  );
  return {
    encryptedPayload: bufToBase64(ciphertext),
    iv: bufToBase64(iv.buffer),
  };
}

async function decrypt(encryptedPayload: string, iv: string, userDid: string): Promise<string> {
  const key = await deriveKey(userDid);
  const ivBuf = base64ToBuf(iv);
  const ciphertextBuf = base64ToBuf(encryptedPayload);
  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv: ivBuf }, key, ciphertextBuf);
  return new TextDecoder().decode(plaintext);
}

function getOrCreateSalt(): Uint8Array {
  const stored = localStorage.getItem(SALT_STORAGE_KEY);
  if (stored) {
    try {
      return new Uint8Array(base64ToBuf(stored));
    } catch {
      // Fall through to create a new salt.
    }
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(SALT_STORAGE_KEY, bufToBase64(salt.buffer));
  return salt;
}

function bufToBase64(buf: ArrayBuffer): string {
  // Chunk to avoid "Maximum call stack size exceeded" on large buffers.
  const bytes = new Uint8Array(buf);
  const CHUNK = 1024;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr.buffer;
}
