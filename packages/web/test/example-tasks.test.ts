import { describe, expect, it } from "vitest";
import { EXAMPLE_FOLDERS, EXAMPLE_TASKS } from "../src/features/chat/example-tasks";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";

describe("travel starter tasks", () => {
  it("keeps two balanced groups with six distinct starters", () => {
    expect(EXAMPLE_FOLDERS.map((folder) => folder.tasks.length)).toEqual([3, 3]);
    expect(new Set(EXAMPLE_TASKS.map((task) => task.id)).size).toBe(6);
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
    {
      locale: "zh",
      dictionary: zh,
      markers: ["代表选项", "入选理由", "支付页", "不可逆操作", "右侧浏览器"],
    },
    {
      locale: "en",
      dictionary: en,
      markers: [
        "representative options",
        "made the cut",
        "payment page",
        "irreversible action",
        "browser on the right",
      ],
    },
  ])(
    "$locale starters preserve the travel-agent decision and safety contract",
    ({ dictionary, markers }) => {
      const prompts = EXAMPLE_TASKS.map(
        (task) => dictionary.chat.exampleTasks[task.id].prompt,
      ).join(" ");
      for (const marker of markers) expect(prompts).toContain(marker);
      expect(prompts).not.toContain("web-design");
      expect(prompts).not.toContain("run_subagent");
    },
  );
});
