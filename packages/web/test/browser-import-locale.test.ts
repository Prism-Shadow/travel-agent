import { afterEach, describe, expect, it } from "vitest";
import { browserImportKindLabel } from "../src/features/chat/browser-import-dialog";
import { en } from "../src/lib/strings-en";
import { setActiveStrings, zh } from "../src/lib/strings";

afterEach(() => setActiveStrings(zh));

describe("browser import locale", () => {
  it("reads every kind label from the current dictionary instead of freezing the startup locale", () => {
    setActiveStrings(zh);
    expect(browserImportKindLabel("passwords")).toBe(zh.chat.browserPane.import.passwords);

    setActiveStrings(en);
    expect(browserImportKindLabel("passwords")).toBe(en.chat.browserPane.import.passwords);
    expect(browserImportKindLabel("cookies")).toBe(en.chat.browserPane.import.cookies);
    expect(browserImportKindLabel("history")).toBe(en.chat.browserPane.import.history);
  });
});
