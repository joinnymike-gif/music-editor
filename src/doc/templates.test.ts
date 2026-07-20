import { describe, expect, it } from "vitest";
import { validateProjectDocument } from "./schema";
import { createProject, type ProjectTemplate } from "./templates";

const templates: ProjectTemplate[] = [
  "blank",
  "lofi",
  "electronic",
  "popInstrumental",
];

describe("createProject", () => {
  it.each(templates)("创建有效、版本化的 %s 工程", (template) => {
    let count = 0;
    const document = createProject(template, {
      now: new Date("2026-07-18T00:00:00.000Z"),
      createId: () =>
        `80000000-0000-4000-8000-${String(++count).padStart(12, "0")}`,
    });

    const validation = validateProjectDocument(document);

    expect(validation.valid).toBe(true);
    expect(document.schemaVersion).toBe("1.0");
    expect(document.createdAt).toBe("2026-07-18T00:00:00.000Z");
    expect(document.sections.length).toBeGreaterThan(0);
    expect(document.tracks.length).toBeGreaterThan(0);
  });

  it("每次创建都生成独立的可编辑文档", () => {
    let count = 0;
    const createId = () =>
      `80000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
    const first = createProject("blank", { createId });
    const second = createProject("blank", { createId });

    first.sections[0]!.name = "Changed";

    expect(second.sections[0]!.name).toBe("Idea");
    expect(first.id).not.toBe(second.id);
  });
});
