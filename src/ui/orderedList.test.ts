import { describe, expect, it } from "vitest";
import { orderedListSnippet } from "./orderedList";

describe("ordered list insertion", () => {
  it.each([
    ["", "1. 列表项"], ["1. 概念", "\n2. 列表项"],
    ["1. 概念\n2. 主张\n", "3. 列表项"], ["9. 九\n", "10. 列表项"],
    ["1. 前文\n\n", "1. 列表项"], ["说明\n", "1. 列表项"],
    ["1. 父\n  1. 子", "\n  2. 列表项"],
    ["1. 父\n  1. 子\n", "  2. 列表项"],
  ])("continues or starts %j", (value, expected) => {
    expect(orderedListSnippet(value, value.length, value.length).text).toBe(expected);
  });
  it("uses only the preceding text and keeps selection on inserted content", () => {
    const value = "1. 首项\n替换\n8. 后文";
    const start = value.indexOf("替换");
    const result = orderedListSnippet(value, start, start + 2);
    expect(result.text).toBe("2. 替换");
    expect(result.text.slice(result.cur, result.curEnd)).toBe("替换");
  });
});
