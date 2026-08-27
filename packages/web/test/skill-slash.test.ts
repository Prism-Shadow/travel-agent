/**
 * Skill UI-language text selection (pure functions shared by the agent settings Skills tab
 * and the starter-card path):
 * - localizedText: uses the Chinese value when locale is zh and it's non-empty, otherwise
 *   falls back to English (an empty-string Chinese value counts as missing);
 * - localizedShortText: prefers the short description (language takes priority over
 *   length), falling back to the full description when missing;
 * - skillsAutoMessage: auto-invoke text (zh/en dictionaries).
 *
 * The dropdown filter and the `/<skill_name>` command items are gone with the picker itself:
 * every skill here is built in, so there was nothing left for a person to choose.
 */
import { describe, expect, it } from "vitest";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import { localizedShortText, localizedText } from "../src/features/chat/skill-use";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("localizedText (copy selection by UI language)", () => {
  it("zh prefers the Chinese field", () => {
    expect(localizedText("zh", "Create agents", "创建 Agent")).toBe("创建 Agent");
  });

  it("zh with the Chinese value missing (undefined / empty string) falls back to English", () => {
    expect(localizedText("zh", "Create agents")).toBe("Create agents");
    expect(localizedText("zh", "Create agents", "")).toBe("Create agents");
  });

  it("en always uses English (even with a Chinese field present)", () => {
    expect(localizedText("en", "Create agents", "创建 Agent")).toBe("Create agents");
  });
});

describe("localizedShortText (short description first, falling back to the full description)", () => {
  const full = {
    description: "Create agents from requirements",
    shortDescription: "Create agents",
    shortDescriptionZh: "创建 Agent",
  };

  it("both short descriptions present: picks the short description by UI language", () => {
    expect(localizedShortText("zh", full)).toBe("创建 Agent");
    expect(localizedShortText("en", full)).toBe("Create agents");
  });

  it("zh falls back to the short English when the short Chinese is missing, then to the full English (the full description is English-only)", () => {
    expect(localizedShortText("zh", { ...full, shortDescriptionZh: undefined })).toBe(
      "Create agents",
    );
    expect(
      localizedShortText("zh", {
        description: "Create agents from requirements",
      }),
    ).toBe("Create agents from requirements");
  });

  it("en: a missing short description (including empty string) falls back to the full description", () => {
    expect(localizedShortText("en", { ...full, shortDescription: undefined })).toBe(
      "Create agents from requirements",
    );
    expect(localizedShortText("en", { ...full, shortDescription: "" })).toBe(
      "Create agents from requirements",
    );
  });
});

describe("skillsAutoMessage (auto-invoke text for empty-body sends, zh/en dictionaries)", () => {
  it("zh: skill names joined with 、, same wording for singular and plural", () => {
    expect(zh.chat.skillsAutoMessage(["agent-creation"])).toBe("使用 agent-creation 技能");
    expect(zh.chat.skillsAutoMessage(["a", "b"])).toBe("使用 a、b 技能");
  });

  it("en: singular use the <name> skill, plural comma-joined + skills", () => {
    expect(en.chat.skillsAutoMessage(["agent-creation"])).toBe("use the agent-creation skill");
    expect(en.chat.skillsAutoMessage(["a", "b"])).toBe("use the a, b skills");
  });
});
