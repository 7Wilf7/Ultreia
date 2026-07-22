import { describe, expect, it } from "vitest";
import {
  createUltreiaAevumExport,
  serializeUltreiaAevumExport,
  ultreiaAevumExportFilename,
} from "./aevumMigrationExport.js";

function storageFrom(entries) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    getItem: key => values.has(key) ? values.get(key) : null,
    key: index => [...values.keys()][index] ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const cryptoObject = globalThis.crypto;
const NOW = new Date("2026-07-22T08:00:00.000Z");

describe("Ultreia Aevum migration export", () => {
  it("exports only reviewed preferences and unmigrated owner weekly reports", async () => {
    const storage = storageFrom({
      "ultreia.lang": "zh",
      "ultreia.chartPeriod": JSON.stringify({ type: "week", count: 4 }),
      "ultreia.weather.autoUpdate.v1": "true",
      "ultreia.weather.updateIntervalHours.v1": "6",
      "ultreia.weeklyReports.v1.user-1": JSON.stringify([{
        id: "report-1",
        userId: "user-1",
        start: "2026-07-13",
        end: "2026-07-19",
        text: "Weekly report",
        generatedAt: "2026-07-20T00:00:00.000Z",
      }]),
      "ultreia.weather.cache.v1": "secret-adjacent-cache-value",
      "sb-project-auth-token": "must-not-leak",
    });
    const artifact = await createUltreiaAevumExport({
      storage,
      userId: "user-1",
      now: NOW,
      origin: "https://ultreia.run",
      sourceCommit: "a".repeat(40),
      cryptoObject,
    });

    expect(artifact.payload.preferences).toEqual({
      "ultreia.lang": "zh",
      "ultreia.chartPeriod": { type: "week", count: 4 },
      "ultreia.weather.autoUpdate.v1": true,
      "ultreia.weather.updateIntervalHours.v1": 6,
    });
    expect(artifact.payload.weekly_reports.reports).toHaveLength(1);
    expect(artifact.payload.weekly_reports.reports[0]).not.toHaveProperty("userId");
    expect(artifact.payload.weekly_reports.scope).toBe("current_owner");
    expect(serializeUltreiaAevumExport(artifact)).not.toContain("user-1");
    expect(artifact.denied_keys).toEqual(["sb-project-auth-token", "ultreia.weather.cache.v1"]);
    expect(serializeUltreiaAevumExport(artifact)).not.toContain("must-not-leak");
    expect(artifact.owner).not.toHaveProperty("id");
    expect(artifact.owner.kind).toBe("account");
    expect(ultreiaAevumExportFilename(artifact)).toMatch(/^ultreia-aevum-export-2026-07-22-[a-f0-9]{8}\.json$/);
  });

  it("does not export weekly reports after cloud reconciliation", async () => {
    const storage = storageFrom({
      "ultreia.weeklyReports.v1.user-1": JSON.stringify([{ start: "2026-07-13", end: "2026-07-19", text: "old" }]),
      "ultreia.weeklyReportsMigrated.v1.user-1": "1",
    });
    const artifact = await createUltreiaAevumExport({
      storage,
      userId: "user-1",
      now: NOW,
      origin: "https://ultreia.run",
      sourceCommit: "a".repeat(40),
      cryptoObject,
    });
    expect(artifact.payload.weekly_reports).toBeNull();
    expect(artifact.denied_keys).toContain("ultreia.weeklyReports.v1.<owner-scope>");
  });

  it("fails closed for unknown report fields and owner changes", async () => {
    const storage = storageFrom({
      "ultreia.weeklyReports.v1.user-1": JSON.stringify([{ start: "2026-07-13", end: "2026-07-19", text: "old", accessToken: "x" }]),
    });
    await expect(createUltreiaAevumExport({
      storage,
      userId: "user-1",
      now: NOW,
      origin: "https://ultreia.run",
      sourceCommit: "a".repeat(40),
      cryptoObject,
    })).rejects.toMatchObject({ code: "sensitive_field" });

    let checks = 0;
    await expect(createUltreiaAevumExport({
      storage: storageFrom({ "ultreia.lang": "en" }),
      userId: "user-1",
      verifyOwner: async () => ++checks < 2,
      now: NOW,
      origin: "https://ultreia.run",
      sourceCommit: "a".repeat(40),
      cryptoObject,
    })).rejects.toMatchObject({ code: "owner_changed" });
  });
});
