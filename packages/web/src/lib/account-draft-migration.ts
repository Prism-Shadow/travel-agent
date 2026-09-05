import type { UserInfo } from "@prismshadow/penguin-server/api";

const LEGACY_USER_ID = "admin";
const TARGET_USER_ID = "traveler";

/** Restore only a server-confirmed administrator upgrade before its draft consumers mount. */
export function migrateAccountDrafts(user: UserInfo, injected?: Storage): void {
  if (!user.isAdmin || user.userId !== TARGET_USER_ID) return;
  if (user.previousUserId !== LEGACY_USER_ID) return;
  try {
    moveDrafts(injected ?? localStorage, LEGACY_USER_ID, TARGET_USER_ID);
  } catch {
    // Storage can be unavailable/full. A failed copy leaves its source intact for a retry.
  }
}

function moveDrafts(storage: Storage, sourceUser: string, targetUser: string): void {
  const marker = `penguin.accountMigration.${sourceUser}.${targetUser}`;
  if (storage.getItem(marker) === "done") return;
  const prefixes = ["penguin.chatDraft.", "penguin.chatDraft.session.", "penguin.chatDrafts."];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (!key) continue;
    const prefix = prefixes.find((value) => key.startsWith(`${value}${sourceUser}.`));
    if (!prefix) continue;
    const target = `${prefix}${targetUser}.${key.slice(`${prefix}${sourceUser}.`.length)}`;
    const value = storage.getItem(key);
    if (value === null) continue;
    // Never overwrite a newer draft. Conflicting source data stays intact in storage.
    if (storage.getItem(target) !== null) continue;
    storage.setItem(target, value);
    storage.removeItem(key);
  }
  storage.setItem(marker, "done");
}
