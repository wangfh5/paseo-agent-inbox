import type { AttentionSignature, TriageRecord, TriageRecords } from "../shared/triage-settings";

/** The snapshot fields triage reads. Everything else (title, updatedAt, labels) is ignored. */
export type AttentionSource = {
  status: string;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: string | null;
  pendingPermissions: readonly { id: string }[];
  lastUserMessageAt: string | null;
  lastError?: string;
  archivedAt?: string | null;
};

export type BaseState = "attention" | "running" | "idle";

/**
 * Paseo's own classification, in the order of the native `deriveAgentStateBucket`: a pending
 * permission or an error wins, then running, then the native attention flag. `closed` means the
 * runtime is unloaded but the agent is resumable, so it is idle, not archived, and still needs
 * attention when it finished unread.
 */
export function baseStateOf(agent: AttentionSource): BaseState {
  if (agent.pendingPermissions.length > 0 || agent.attentionReason === "permission") {
    return "attention";
  }
  if (agent.status === "error" || agent.attentionReason === "error") return "attention";
  if (agent.status === "running" || agent.status === "initializing") return "running";
  if (agent.requiresAttention) return "attention";
  return "idle";
}

export function signatureOf(agent: AttentionSource): AttentionSignature {
  return {
    attention: agent.requiresAttention
      ? `${agent.attentionReason ?? "attention"}@${agent.attentionTimestamp ?? "?"}`
      : null,
    permissions: agent.pendingPermissions.map((permission) => permission.id).sort(),
    user: agent.lastUserMessageAt ?? null,
    error: agent.status === "error" ? agent.lastError?.trim() || "error" : null,
  };
}

export type NewEvent = "permission" | "error" | "finished" | "task";

/**
 * The most important event in `current` that `stored` did not contain, or null when `current`
 * is the same attention the user already handled (a repeated sync, reconnect, title change or
 * other metadata update). Permission and error outrank a finished turn.
 */
export function newEventSince(
  stored: AttentionSignature,
  current: AttentionSignature,
): NewEvent | null {
  if (current.permissions.some((id) => !stored.permissions.includes(id))) return "permission";
  const newAttention = current.attention !== null && current.attention !== stored.attention;
  if (newAttention && current.attention?.startsWith("permission@")) return "permission";
  if (newAttention && current.attention?.startsWith("error@")) return "error";
  if (current.error !== null && current.error !== stored.error) return "error";
  if (newAttention) return "finished";
  if (current.user !== null && current.user !== stored.user) return "task";
  return null;
}

/** Events that end a snooze early. Every new event qualifies; plain status refreshes never do. */
export function wakesSnooze(event: NewEvent | null): boolean {
  return event !== null;
}

export type TriageState = "settled" | "snoozed" | null;

/**
 * Whether the user's record still hides this agent from the attention queue. A record stops
 * applying once the agent shows a new event, once a snooze reaches its wake time, or once the
 * agent leaves attention (it was read natively, resumed, or started a new turn).
 */
export function effectiveTriage(
  record: TriageRecord | undefined,
  agent: AttentionSource,
  now: number,
): TriageState {
  if (!record) return null;
  if (baseStateOf(agent) !== "attention") return null;
  if (record.kind === "snoozed") {
    const until = record.until ? Date.parse(record.until) : Number.NaN;
    if (!(until > now)) return null;
    return wakesSnooze(newEventSince(record.sig, signatureOf(agent))) ? null : "snoozed";
  }
  return newEventSince(record.sig, signatureOf(agent)) === null ? "settled" : null;
}

export function settleRecord(agent: AttentionSource, now: number): TriageRecord {
  return { kind: "settled", at: new Date(now).toISOString(), until: null, sig: signatureOf(agent) };
}

export function snoozeRecord(agent: AttentionSource, now: number, until: number): TriageRecord {
  return {
    kind: "snoozed",
    at: new Date(now).toISOString(),
    until: new Date(until).toISOString(),
    sig: signatureOf(agent),
  };
}

export type SnoozePreset = "1h" | "3h" | "evening" | "tomorrow" | "nextWeek";

const HOUR_MS = 60 * 60 * 1000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

function atLocal(now: number, addDays: number, hour: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + addDays);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

/**
 * Absolute wake time for a preset, in the client's local time: "evening" is 18:00 today,
 * "tomorrow" 09:00 on the next day, "nextWeek" 09:00 on the coming Monday (a week out on Mondays).
 */
export function snoozeUntil(preset: SnoozePreset, now: number): number {
  switch (preset) {
    case "1h":
      return now + HOUR_MS;
    case "3h":
      return now + 3 * HOUR_MS;
    case "evening":
      return atLocal(now, 0, EVENING_HOUR);
    case "tomorrow":
      return atLocal(now, 1, MORNING_HOUR);
    case "nextWeek": {
      const daysToMonday = (8 - new Date(now).getDay()) % 7 || 7;
      return atLocal(now, daysToMonday, MORNING_HOUR);
    }
  }
}

const PRESET_LABELS: Record<SnoozePreset, string> = {
  "1h": "In 1 hour",
  "3h": "In 3 hours",
  evening: "This evening",
  tomorrow: "Tomorrow",
  nextWeek: "Next week",
};

/** The menu's presets with their wake times. "This evening" is offered only before 18:00. */
export function snoozeOptions(now: number): { id: SnoozePreset; label: string; until: number }[] {
  const presets: SnoozePreset[] = ["1h", "3h", "evening", "tomorrow", "nextWeek"];
  return presets
    .map((id) => ({ id, label: PRESET_LABELS[id], until: snoozeUntil(id, now) }))
    .filter((option) => option.until > now);
}

export type DurationUnit = "minutes" | "hours" | "days";

const UNIT_MS: Record<DurationUnit, number> = {
  minutes: 60 * 1000,
  hours: HOUR_MS,
  days: 24 * HOUR_MS,
};

export type CustomSnooze =
  | { mode: "datetime"; date: string; time: string }
  | { mode: "duration"; amount: string; unit: DurationUnit };

/**
 * The wake time a custom snooze form describes, or the reason it cannot be used. Dates are
 * `YYYY-MM-DD` and times `HH:MM` (24h) in local time; the result must be in the future.
 */
export function parseCustomSnooze(
  input: CustomSnooze,
  now: number,
): { until: number } | { error: string } {
  let until: number;
  if (input.mode === "duration") {
    const amount = Number(input.amount.trim());
    if (!input.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      return { error: "Enter a positive number" };
    }
    until = now + Math.round(amount * UNIT_MS[input.unit]);
  } else {
    const date = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.date.trim());
    if (!date) return { error: "Date must look like 2026-11-04" };
    const time = /^(\d{1,2}):(\d{2})$/.exec(input.time.trim());
    if (!time) return { error: "Time must look like 14:30" };
    const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
    const [hours, minutes] = [Number(time[1]), Number(time[2])];
    if (hours > 23 || minutes > 59) return { error: "Time must look like 14:30" };
    const local = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (local.getMonth() !== month - 1 || local.getDate() !== day) {
      return { error: "That date does not exist" };
    }
    until = local.getTime();
  }
  if (until <= now) return { error: "Pick a time in the future" };
  return { until };
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Form defaults: one hour from now, as local `YYYY-MM-DD` and `HH:MM`. */
export function customSnoozeDefaults(now: number): { date: string; time: string } {
  const date = new Date(now + HOUR_MS);
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/** The earliest future snooze wake time, so a view can re-render exactly when one expires. */
export function nextWakeAt(records: TriageRecords, now: number): number | null {
  let next: number | null = null;
  for (const record of Object.values(records)) {
    if (record.kind !== "snoozed" || !record.until) continue;
    const until = Date.parse(record.until);
    if (until > now && (next === null || until < next)) next = until;
  }
  return next;
}

export type TriageOp =
  | { type: "set"; key: string; record: TriageRecord }
  | { type: "delete"; key: string };

export function applyOps(records: TriageRecords, ops: readonly TriageOp[]): TriageRecords {
  if (ops.length === 0) return records;
  const next: Record<string, TriageRecord> = { ...records };
  for (const op of ops) {
    if (op.type === "set") next[op.key] = op.record;
    else delete next[op.key];
  }
  return next;
}

/** What the client currently sees: agents by inbox key, and hosts whose full list loaded. */
export type Observation = {
  agents: ReadonlyMap<string, AttentionSource>;
  completeHosts: ReadonlySet<string>;
};

/** Records for agents nobody can observe (host offline for a long time) expire after this. */
export const UNOBSERVED_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Keys whose record can never apply again. Dropping them is what makes "a new event ends the
 * settle" permanent: without it, a permission that appeared and resolved would let an old settle
 * hide the next turn. An agent that is missing from a fully listed host was archived or deleted.
 * Agents on offline, failed or truncated hosts keep their records until the TTL.
 */
export function obsoleteKeys(
  records: TriageRecords,
  observation: Observation,
  now: number,
): string[] {
  const obsolete: string[] = [];
  for (const [key, record] of Object.entries(records)) {
    const agent = observation.agents.get(key);
    if (agent) {
      if (agent.archivedAt || effectiveTriage(record, agent, now) === null) obsolete.push(key);
      continue;
    }
    const serverId = key.slice(0, key.indexOf("/"));
    if (observation.completeHosts.has(serverId)) obsolete.push(key);
    else if (now - Date.parse(record.at) > UNOBSERVED_RECORD_TTL_MS) obsolete.push(key);
  }
  return obsolete;
}

function sameRecords(left: TriageRecords, right: TriageRecords): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

/**
 * The document to save: the user's pending ops applied in order, then records that can never
 * apply again removed. Null when the saved document is already correct, so idle clients write
 * nothing. Ops are re-applied to the freshest saved document on every attempt, which makes a
 * revision conflict with another client safe to retry.
 */
export function planTriageWrite(
  saved: TriageRecords,
  ops: readonly TriageOp[],
  observation: Observation | null,
  now: number,
): TriageRecords | null {
  let next = applyOps(saved, ops);
  if (observation) {
    const stale = obsoleteKeys(next, observation, now);
    if (stale.length > 0)
      next = applyOps(
        next,
        stale.map((key) => ({ type: "delete", key })),
      );
  }
  return sameRecords(next, saved) ? null : next;
}
