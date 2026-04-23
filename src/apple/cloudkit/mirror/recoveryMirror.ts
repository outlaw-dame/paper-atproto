// ─── Draft Recovery Mirror ────────────────────────────────────────────────────
// Historical encrypted draft recovery mirror.
//
// Product policy now keeps drafts/content history browser-local. These APIs
// intentionally remain no-ops so older callers fail soft without uploading
// encrypted or plaintext user content to a remote mirror.

// ─── Public API ───────────────────────────────────────────────────────────────

export async function mirrorDraftRecovery(
  _userDid: string,
  _draftId: string,
  _plaintextPayload: string
): Promise<void> {
  return;
}

export async function restoreDraftRecovery(
  _userDid: string,
  _draftId: string
): Promise<string | null> {
  return null;
}
