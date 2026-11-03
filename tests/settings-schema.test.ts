import { describe, expect, test } from "vitest";
import { settleRecord, snoozeRecord } from "../client/triage";
import { DEFAULT_SETTINGS, inboxSettingsSchema } from "../shared/inbox-settings";
import { triageSettings } from "../shared/triage-settings";
import { entry, finished } from "./fixtures";

describe("settings documents", () => {
  test("an empty preferences document parses to defaults, with subagents hidden", () => {
    expect(inboxSettingsSchema.parse({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.showSubagents).toBe(false);
  });

  test("triage records written by the client round-trip through the stored schema", () => {
    const agent = entry(finished("2026-11-03T09:00:00Z")).agent;
    const now = Date.parse("2026-11-03T10:00:00Z");
    const records = {
      "srv-alpha/a": settleRecord(agent, now),
      "srv-beta/a": snoozeRecord(agent, now, now + 3_600_000),
    };
    const stored = JSON.parse(JSON.stringify({ records }));
    expect(triageSettings.schema.parse(stored)).toEqual({ records });
    expect(triageSettings.schema.parse({})).toEqual({ records: {} });
  });
});
