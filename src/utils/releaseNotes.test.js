import { describe, expect, it } from "vitest";
import { cleanReleaseNotes } from "./releaseNotes";

describe("release notes cleanup", () => {
  it("keeps concrete Chinese changelog bullets and skips date headings", () => {
    const notes = [
      "## 2026-07-06",
      "",
      "- **日历建议去重与晚上时段**：计划时段里的 `pm` 统一显示为「晚上」。",
      "- **PWA 启动超时修复**：启动时不再因为赛事请求超时而挡在错误页。",
    ].join("\n");

    expect(cleanReleaseNotes(notes)).toBe([
      "- 日历建议去重与晚上时段：计划时段里的 pm 统一显示为「晚上」。",
      "- PWA 启动超时修复：启动时不再因为赛事请求超时而挡在错误页。",
    ].join("\n"));
  });

  it("does not turn old commit-title release bodies into repeated generic notes", () => {
    const notes = [
      "## 2026-07-06",
      "",
      "- Release v0.12.17",
      "- Fix touch overlays and dropdown flicker",
      "- Remove button press animation",
      "- Make PWA boot tolerate slow core data",
      "- Condense July 6 changelog touch response notes",
      "- Speed up coach message actions",
      "- Speed up account and weather settings closes",
      "- Speed up inbox settings switches",
      "- Improve mobile tap responsiveness",
    ].join("\n");

    const cleaned = cleanReleaseNotes(notes);
    expect(cleaned).not.toContain("优化应用细节");
    expect(cleaned).not.toContain("修复应用问题");
    expect(cleaned.split("\n")).toEqual([
      "- 修复触摸覆盖层和下拉列表闪烁",
      "- 移除不必要的按钮下压动画",
      "- PWA 启动时允许慢数据后台补齐，减少卡在加载页",
      "- 提升移动端 tab、按钮和筛选控件的响应速度",
    ]);
  });
});
