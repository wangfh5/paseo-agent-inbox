import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * What the agent's attention looked like when the user settled or snoozed it. Every field is a
 * stable marker Paseo itself persists, never `updatedAt`:
 * - `attention`: `<reason>@<attentionTimestamp>`; the daemon stamps a new timestamp each time it
 *   raises attention and never rewrites it while attention stays set.
 * - `permissions`: ids of pending permission requests.
 * - `user`: `lastUserMessageAt`, which moves only when a new prompt starts a new task.
 * - `error`: the error text while `status === "error"`.
 */
export const attentionSignatureSchema = z.object({
  attention: z.string().nullable(),
  permissions: z.array(z.string()),
  user: z.string().nullable(),
  error: z.string().nullable(),
});

export type AttentionSignature = z.infer<typeof attentionSignatureSchema>;

export const triageRecordSchema = z.object({
  kind: z.enum(["settled", "snoozed"]),
  /** ISO time of the user action. */
  at: z.string(),
  /** Absolute ISO wake time for snoozes; null for settles. */
  until: z.string().nullable(),
  sig: attentionSignatureSchema,
});

export type TriageRecord = z.infer<typeof triageRecordSchema>;

/**
 * Inbox-owned triage state, keyed by `<serverId>/<agentId>`. Lives in a settings document of the
 * host the plugin is installed on, so every client of that host shares it. It never touches the
 * agents themselves.
 */
export const triageSettings = defineSettings({
  id: "triage",
  scope: "host",
  version: 1,
  schema: z.object({
    records: z.record(z.string(), triageRecordSchema).default({}),
    /**
     * When the inbox started tracking turns, written once by the first client. Turns that began
     * earlier count as settled, so installing the inbox does not flag every idle agent.
     */
    baselineAt: z.string().nullable().default(null),
  }),
});

export type TriageRecords = Readonly<Record<string, TriageRecord>>;
