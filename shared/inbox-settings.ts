import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export type AgentSort = "triage" | "updated" | "title";
export type DefaultView = "attention" | "all";

export type InboxSettings = {
  showSubagents: boolean;
  agentSort: AgentSort;
  showPlacement: boolean;
  defaultView: DefaultView;
};

export const DEFAULT_SETTINGS: InboxSettings = {
  showSubagents: false,
  agentSort: "triage",
  showPlacement: true,
  defaultView: "attention",
};

export const inboxSettingsSchema = z.object({
  showSubagents: z.boolean().default(DEFAULT_SETTINGS.showSubagents),
  agentSort: z.enum(["triage", "updated", "title"]).default(DEFAULT_SETTINGS.agentSort),
  showPlacement: z.boolean().default(DEFAULT_SETTINGS.showPlacement),
  defaultView: z.enum(["attention", "all"]).default(DEFAULT_SETTINGS.defaultView),
});

/** Display preferences. Host-scoped: every client of the plugin's host shares them. */
export const inboxSettings = defineSettings({
  id: "inbox",
  scope: "host",
  version: 1,
  schema: inboxSettingsSchema,
});

export const SORT_OPTIONS: readonly { id: AgentSort; label: string }[] = [
  { id: "triage", label: "Triage" },
  { id: "updated", label: "Recent" },
  { id: "title", label: "Title" },
];

export const DEFAULT_VIEW_OPTIONS: readonly { id: DefaultView; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "all", label: "All" },
];
