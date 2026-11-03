import type { TriageRecords } from "../shared/triage-settings";
import {
  type AgentEntry,
  age,
  agentKey,
  type HostScope,
  hostOf,
  matches,
  parentAddress,
} from "./monitor";
import {
  type BaseState,
  baseStateOf,
  effectiveTriage,
  type TriageState,
  wantsAttention,
} from "./triage";

export type InboxItem = {
  /** `<serverId>/<agentId>`: the identity used for React keys and triage records. */
  key: string;
  entry: AgentEntry;
  host: HostScope | null;
  /** Paseo's own state, untouched by triage. */
  base: BaseState;
  triage: TriageState;
  /** True when the agent is in the attention queue: native attention not settled or snoozed. */
  needsAttention: boolean;
  /** The parent's inbox key, or null for a top-level agent. */
  parentKey: string | null;
  /** Direct subagents of this agent across all listed hosts, shown or not. */
  subagents: number;
};

/**
 * Where an agent sits in the inbox. Sections are positions, not filters: every agent is in
 * exactly one, and moves between them as its state changes. A finished turn lifts an agent from
 * Working to Needs attention; Settle drops it to Settled, Snooze to Snoozed.
 */
export type Section = "attention" | "working" | "snoozed" | "settled";

export const SECTIONS: readonly Section[] = ["attention", "working", "snoozed", "settled"];

export const SECTION_TITLES: Record<Section, string> = {
  attention: "Needs attention",
  working: "Working",
  snoozed: "Snoozed",
  settled: "Settled",
};

export function isSubagent(entry: AgentEntry): boolean {
  return parentAddress(entry.agent, hostOf(entry)?.serverId ?? "") !== null;
}

/**
 * Builds the inbox from raw entries in one pass, so the list, the chips, the sidebar badge and
 * the popover all read the same set. Subagents are identified from their own parent metadata,
 * never from whether the parent happens to be listed, so a child of an unlisted, offline or
 * remote parent stays hidden. Agents with no parent metadata are treated as top level.
 */
export function deriveInbox(
  entries: readonly AgentEntry[],
  records: TriageRecords,
  options: { showSubagents: boolean; now: number; baselineAt: number },
): InboxItem[] {
  const subagentCounts = new Map<string, number>();
  const parents = new Map<AgentEntry, string>();
  for (const entry of entries) {
    const parent = parentAddress(entry.agent, hostOf(entry)?.serverId ?? "");
    if (!parent) continue;
    const parentKey = agentKey(parent.serverId, parent.agentId);
    parents.set(entry, parentKey);
    subagentCounts.set(parentKey, (subagentCounts.get(parentKey) ?? 0) + 1);
  }
  const items: InboxItem[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.agent.archivedAt) continue;
    const parentKey = parents.get(entry) ?? null;
    if (parentKey !== null && !options.showSubagents) continue;
    const host = hostOf(entry);
    const key = agentKey(host?.serverId ?? "", entry.agent.id);
    // A reconnect can briefly list a host twice; one row per agent identity.
    if (seen.has(key)) continue;
    seen.add(key);
    const base = baseStateOf(entry.agent);
    const triage = effectiveTriage(records[key], entry.agent, options.now);
    items.push({
      key,
      entry,
      host,
      base,
      triage,
      needsAttention:
        base !== "running" && wantsAttention(entry.agent, options.baselineAt) && triage === null,
      parentKey,
      subagents: subagentCounts.get(key) ?? 0,
    });
  }
  return items;
}

/**
 * Settled holds both agents the user settled and agents that simply have nothing pending (idle
 * or closed and read): either way there is nothing to do.
 */
export function sectionOf(item: InboxItem): Section {
  if (item.needsAttention) return "attention";
  if (item.base === "running") return "working";
  if (item.triage === "snoozed") return "snoozed";
  return "settled";
}

/** When the agent began waiting (for attention) or last changed (otherwise). */
export function activityAt(item: InboxItem): number {
  const { agent } = item.entry;
  const attentionAt =
    item.base === "attention" && agent.attentionTimestamp
      ? Date.parse(agent.attentionTimestamp)
      : NaN;
  return Number.isNaN(attentionAt) ? Date.parse(agent.updatedAt) : attentionAt;
}

export type InboxRow = { item: InboxItem; depth: number };

/**
 * Sorted rows. With subagents shown, each child follows its parent indented one level per
 * generation; a child whose parent is not in `items` (filtered out, on an offline host, or
 * unlisted) is a root row of its own so it never disappears.
 */
export function orderRows(
  items: readonly InboxItem[],
  byOrder: (left: InboxItem, right: InboxItem) => number,
): InboxRow[] {
  const keys = new Set(items.map((item) => item.key));
  const children = new Map<string, InboxItem[]>();
  const roots: InboxItem[] = [];
  for (const item of items) {
    if (item.parentKey !== null && keys.has(item.parentKey) && item.parentKey !== item.key) {
      const siblings = children.get(item.parentKey);
      if (siblings) siblings.push(item);
      else children.set(item.parentKey, [item]);
    } else {
      roots.push(item);
    }
  }
  const rows: InboxRow[] = [];
  const placed = new Set<string>();
  const visit = (item: InboxItem, depth: number) => {
    if (placed.has(item.key)) return;
    placed.add(item.key);
    rows.push({ item, depth });
    for (const child of (children.get(item.key) ?? []).sort(byOrder)) visit(child, depth + 1);
  };
  for (const root of roots.sort(byOrder)) visit(root, 0);
  // A parent cycle has no root; list what is left flat rather than dropping it.
  for (const item of [...items].sort(byOrder)) visit(item, 0);
  return rows;
}

export type InboxSections = Record<Section, InboxRow[]>;

const newestFirst = (left: InboxItem, right: InboxItem) => activityAt(right) - activityAt(left);

/**
 * The search-filtered items split into sections. Attention, Working and Settled list the most
 * recent activity first; Snoozed lists the earliest wake first.
 */
export function buildSections(
  items: readonly InboxItem[],
  records: TriageRecords,
  needle: string,
): InboxSections {
  const search = needle.trim().toLowerCase();
  const grouped: Record<Section, InboxItem[]> = {
    attention: [],
    working: [],
    snoozed: [],
    settled: [],
  };
  for (const item of items) {
    if (matches(item.entry, search)) grouped[sectionOf(item)].push(item);
  }
  const wake = (item: InboxItem) => Date.parse(records[item.key]?.until ?? "") || 0;
  return {
    attention: orderRows(grouped.attention, newestFirst),
    working: orderRows(grouped.working, newestFirst),
    snoozed: orderRows(grouped.snoozed, (left, right) => wake(left) - wake(right)),
    settled: orderRows(grouped.settled, newestFirst),
  };
}

export function stateLabel(item: InboxItem): string {
  const { agent } = item.entry;
  const permissionCount = agent.pendingPermissions.length;
  if (permissionCount > 0) {
    return permissionCount === 1 ? "permission" : `${permissionCount} permissions`;
  }
  if (agent.status === "error") return "error";
  if (agent.status === "running") return "running";
  if (agent.status === "initializing") return "starting";
  if (agent.requiresAttention) return agent.attentionReason ?? "attention";
  return agent.status;
}

/** The badge count, or null when it cannot be trusted yet. A failed or truncated host makes it a lower bound. */
export function attentionSummary(state: {
  items: readonly InboxItem[] | null;
  truncated: boolean;
  failed: boolean;
}): { count: number; lowerBound: boolean } | null {
  if (!state.items) return null;
  const count = state.items.filter((item) => item.needsAttention).length;
  if (count === 0 && state.failed && state.items.length === 0) return null;
  return { count, lowerBound: state.truncated || state.failed };
}

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A wake time in the client's local time zone: "14:05" today, "tomorrow 09:00", "Mon 09:00"
 * within a week, else "11/12 09:00". With `bare`, today and tomorrow show the time alone, for a
 * menu whose label already says which day.
 */
export function formatWake(until: number, now: number, bare = false): string {
  const date = new Date(until);
  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((until - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return time;
  if (days === 1) return bare ? time : `tomorrow ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

/**
 * The time from `from` to `to` as "12s", "5m", "3h" or "2d". With `nowBelowMinute`, anything
 * under a minute reads "now".
 */
export function relativeAge(from: number, to: number, nowBelowMinute: boolean): string {
  if (Number.isNaN(from) || Number.isNaN(to)) return "";
  if (nowBelowMinute && to - from < 60_000) return "now";
  return age(from, to);
}
