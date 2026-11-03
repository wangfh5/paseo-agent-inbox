import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export type InboxSettings = {
  showSubagents: boolean;
  showPlacement: boolean;
};

export const DEFAULT_SETTINGS: InboxSettings = {
  showSubagents: false,
  showPlacement: true,
};

// Unknown keys from older versions (agentSort, defaultView) are stripped on read.
export const inboxSettingsSchema = z.object({
  showSubagents: z.boolean().default(DEFAULT_SETTINGS.showSubagents),
  showPlacement: z.boolean().default(DEFAULT_SETTINGS.showPlacement),
});

/** Display preferences. Host-scoped: every client of the plugin's host shares them. */
export const inboxSettings = defineSettings({
  id: "inbox",
  scope: "host",
  version: 1,
  schema: inboxSettingsSchema,
});
