// ─── Preference Mirror ────────────────────────────────────────────────────────
// Historical CloudKit preference mirror API.
//
// Product policy now keeps app-owned preferences, personalization, and content
// history browser-local. These functions intentionally remain no-ops so older
// callers fail soft without creating a remote user-data path.

export async function mirrorPreference(
  _userDid: string,
  _key: string,
  _value: string
): Promise<void> {
  return;
}

export async function hydrateMirroredPreferences(
  _userDid: string
): Promise<Record<string, string>> {
  return {};
}
