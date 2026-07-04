import { describe, expect, it } from "vitest";
import { getMobilePagerRenderWindow } from "../utils/mobilePager";

describe("MobileShell pager render window", () => {
  it("renders only the active tab and immediate neighbors", () => {
    expect(getMobilePagerRenderWindow(0, 5)).toEqual([0, 1]);
    expect(getMobilePagerRenderWindow(2, 5)).toEqual([1, 2, 3]);
    expect(getMobilePagerRenderWindow(4, 5)).toEqual([3, 4]);
  });
});
