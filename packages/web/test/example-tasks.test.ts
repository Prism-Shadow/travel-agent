import { describe, expect, it } from "vitest";
import { EXAMPLE_TASKS } from "../src/features/chat/example-tasks";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";

describe("travel starter tasks", () => {
  it("keeps exactly the three real-site starters, in display order", () => {
    expect(EXAMPLE_TASKS.map((task) => task.id)).toEqual(["ctripFlight", "otaCompare", "xhsTrip"]);
  });

  it("submits every starter without an implicit development Skill block", () => {
    for (const task of EXAMPLE_TASKS) {
      expect(task.skills).toEqual([]);
      expect(buildSkillsMessage([...task.skills], zh.chat.exampleTasks[task.id].prompt)).toBe(
        zh.chat.exampleTasks[task.id].prompt,
      );
    }
  });

  it.each([
    { locale: "zh", dictionary: zh },
    { locale: "en", dictionary: en },
  ])(
    "$locale keeps the revised real-site scenarios and their user-choice boundary",
    ({ dictionary }) => {
      const comparison = dictionary.chat.exampleTasks.otaCompare.prompt;
      expect(comparison).toContain("打开携程、飞猪");
      expect(comparison).not.toContain("去哪儿");
      expect(comparison).toContain("先不要进入订票流程");
      expect(comparison).toContain("等我选择后再继续预定");

      const guide = dictionary.chat.exampleTasks.xhsTrip.prompt;
      expect(guide).toContain("成都三日美食及游玩攻略");
      expect(guide).toContain("预算400以内一晚");

      const prompts = EXAMPLE_TASKS.map(
        (task) => dictionary.chat.exampleTasks[task.id].prompt,
      ).join(" ");
      expect(prompts).not.toContain("web-design");
      expect(prompts).not.toContain("run_subagent");
    },
  );
});
