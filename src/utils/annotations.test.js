import { describe, expect, it } from "vitest";
import { buildAnnotatedDiscussionMessage, normalizeAnnotationText } from "./annotations";

describe("annotation helpers", () => {
  it("normalizes selected text without destroying intentional line breaks", () => {
    expect(normalizeAnnotationText("  A  \n  B\t \n")).toBe("A\n  B");
  });

  it("builds a coach discussion message from multiple annotations", () => {
    const message = buildAnnotatedDiscussionMessage({
      intro: "请基于我的标注继续分析。",
      sourceTitle: "AI 周复盘",
      sourceText: "Full report",
      extraText: "我今天腿有点沉。",
      annotations: [
        { sourceLabel: "风险段落", quote: "ACWR 偏高\n需要收一收", note: "这里是否要降跑量？" },
        { quote: "周日长距离 24km", note: "" },
      ],
    });

    expect(message).toContain("【我的补充】");
    expect(message).toContain("1. 风险段落");
    expect(message).toContain("> ACWR 偏高\n> 需要收一收");
    expect(message).toContain("2. 引用片段");
    expect(message).toContain("【AI 周复盘】");
  });
});
