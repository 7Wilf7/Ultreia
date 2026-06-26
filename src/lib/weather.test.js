import { describe, expect, it } from "vitest";
import { cityAbbreviationFromLocation, cityAbbreviationFromLocationName, cityFromLocationName } from "./weather";

describe("weather location display helpers", () => {
  it("extracts the city from compact Chinese location labels", () => {
    expect(cityFromLocationName("广东省广州市白云区")).toBe("广州");
    expect(cityAbbreviationFromLocationName("广东省广州市白云区", "zh")).toBe("GZ");
  });

  it("uses known abbreviations for Chinese city labels", () => {
    expect(cityFromLocationName("白云山, 广州市, 广东省, 中国")).toBe("广州");
    expect(cityAbbreviationFromLocationName("白云山, 广州市, 广东省, 中国", "zh")).toBe("GZ");
  });

  it("falls back to ASCII abbreviations and unset labels", () => {
    expect(cityAbbreviationFromLocationName("Guangzhou, Guangdong, China", "en")).toBe("GZ");
    expect(cityAbbreviationFromLocationName("", "zh")).toBe("未设");
  });

  it("does not abbreviate a street name as if it were a city", () => {
    expect(cityFromLocationName("Yuancun Subdistrict")).toBe("");
    expect(cityAbbreviationFromLocationName("Yuancun Subdistrict", "zh")).toBe("未设");
  });

  it("uses saved coordinates when the label is below city level", () => {
    expect(cityAbbreviationFromLocation({
      name: "Yuancun Subdistrict",
      lng: 113.36,
      lat: 23.12,
    }, "zh")).toBe("GZ");
  });
});
