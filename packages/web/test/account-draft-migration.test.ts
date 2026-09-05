import { describe, expect, it } from "vitest";
import { migrateAccountDrafts } from "../src/lib/account-draft-migration";

function storage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

const migrated = {
  userId: "traveler",
  previousUserId: "admin",
  isAdmin: true,
  passwordIsInitial: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("administrator draft migration", () => {
  it("moves active, session and parked drafts once without changing other accounts", () => {
    const s = storage({
      "penguin.chatDraft.admin.default_project": "active",
      "penguin.chatDraft.session.admin.session-a": "session",
      "penguin.chatDrafts.admin.default_project": "parked",
      "penguin.chatDraft.admin2.default_project": "other",
    });
    migrateAccountDrafts(migrated, s);
    expect(s.getItem("penguin.chatDraft.traveler.default_project")).toBe("active");
    expect(s.getItem("penguin.chatDraft.session.traveler.session-a")).toBe("session");
    expect(s.getItem("penguin.chatDrafts.traveler.default_project")).toBe("parked");
    expect(s.getItem("penguin.chatDraft.admin.default_project")).toBeNull();
    expect(s.getItem("penguin.chatDraft.admin2.default_project")).toBe("other");
    s.removeItem("penguin.chatDraft.traveler.default_project");
    s.setItem("penguin.chatDraft.admin.default_project", "stale tab");
    migrateAccountDrafts(migrated, s);
    expect(s.getItem("penguin.chatDraft.traveler.default_project")).toBeNull();
  });

  it("does not give legacy drafts to a fresh administrator or an ordinary user", () => {
    for (const user of [
      { ...migrated, previousUserId: undefined },
      { ...migrated, isAdmin: false },
    ]) {
      const s = storage({ "penguin.chatDraft.admin.p": "private draft" });
      migrateAccountDrafts(user, s);
      expect(s.getItem("penguin.chatDraft.traveler.p")).toBeNull();
      expect(s.getItem("penguin.chatDraft.admin.p")).toBe("private draft");
    }
  });

  it("ignores an unknown previous identity rather than guessing a namespace", () => {
    const s = storage({ "penguin.chatDraft.someone.p": "other account" });
    migrateAccountDrafts({ ...migrated, previousUserId: "someone" }, s);
    expect(s.getItem("penguin.chatDraft.traveler.p")).toBeNull();
    expect(s.getItem("penguin.chatDraft.someone.p")).toBe("other account");
  });

  it("preserves both sides of a collision and retains the source when storage is full", () => {
    const s = storage({
      "penguin.chatDraft.admin.p": "old",
      "penguin.chatDraft.traveler.p": "new",
    });
    migrateAccountDrafts(migrated, s);
    expect(s.getItem("penguin.chatDraft.traveler.p")).toBe("new");
    expect(s.getItem("penguin.chatDraft.admin.p")).toBe("old");
    const full = storage({ "penguin.chatDraft.admin.p": "only copy" });
    full.setItem = () => {
      throw new Error("Storage full");
    };
    migrateAccountDrafts(migrated, full);
    expect(full.getItem("penguin.chatDraft.admin.p")).toBe("only copy");
  });
});
